// src/ble/parseResult.ts
//
// Turns a fully-reassembled 8C 13 response body into a typed result object.
// Pure function, no BLE knowledge -- easy to unit test against a captured
// buffer without needing real hardware.

import { FIELD_OFFSETS, ASSUMED_START_WAVELENGTH_NM } from './protocol';

export interface MeterResult {
  deviceName: string;
  firmwareVersion: number;
  cct: number;
  ra: number;
  lux: number;
  par: number;
  peakSignal: number;
  darkSignal: number;
  integrationTimeMs: number;
  compensateLevel: number;
  x: number;
  y: number;
  duv: number;
  rIndices: number[]; // R1..R15, in order
  timestampOnDevice: string;
  spectrum: { nm: number; value: number }[];
}

/** Reads a little-endian float32 at the given byte offset. */
function f32(buf: Uint8Array, offset: number): number {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  return view.getFloat32(offset, /* littleEndian */ true);
}

function u32(buf: Uint8Array, offset: number): number {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  return view.getUint32(offset, true);
}

function asciiString(buf: Uint8Array, offset: number, maxLen: number): string {
  let end = offset;
  const limit = Math.min(offset + maxLen, buf.length);
  while (end < limit && buf[end] !== 0) end++;
  return Buffer.from(buf.slice(offset, end)).toString('ascii');
}

/**
 * @param body The response with the 4-byte echo+length header ALREADY
 *   stripped (see MeterConnection.ts's reassembly logic, which strips it
 *   before calling this). This was the single biggest bug during the
 *   original ESP32 reverse-engineering effort -- every field was read 4
 *   bytes too early for a long time because the header wasn't stripped
 *   first. Don't repeat that mistake here: this function assumes offset 0
 *   of `body` IS offset 0 of the field map, not offset 0 of the raw
 *   notification stream.
 */
export function parseResult(body: Uint8Array): MeterResult {
  const o = FIELD_OFFSETS;

  const rIndices: number[] = [];
  for (let i = 1; i <= 15; i++) {
    rIndices.push(f32(body, (o as any)[`r${i}`]));
  }

  const spectrum: { nm: number; value: number }[] = [];
  const spectrumBytes = body.length - o.spectrumStart;
  const pointCount = Math.floor(spectrumBytes / 4);
  for (let i = 0; i < pointCount; i++) {
    spectrum.push({
      nm: ASSUMED_START_WAVELENGTH_NM + i,
      value: f32(body, o.spectrumStart + i * 4),
    });
  }

  return {
    deviceName: asciiString(body, o.deviceName, 9),
    firmwareVersion: u32(body, o.firmwareVersion),
    cct: f32(body, o.cct),
    ra: f32(body, o.ra),
    lux: f32(body, o.illuminanceE),
    par: f32(body, o.par),
    peakSignal: f32(body, o.peakSignal),
    darkSignal: f32(body, o.darkSignal),
    integrationTimeMs: f32(body, o.integrationTimeMs),
    compensateLevel: f32(body, o.compensateLevel),
    x: f32(body, o.x),
    y: f32(body, o.y),
    duv: f32(body, o.duv),
    rIndices,
    timestampOnDevice: asciiString(body, o.timestamp, o.timestampLength),
    spectrum,
  };
}

/**
 * Sanity check for a healthy reading, per the protocol spec: peak signal
 * should be dramatically larger than dark signal in any real light. If
 * they're close together or inverted, the exposure genuinely failed
 * (insufficient light) -- it's not a parsing bug.
 */
export function looksHealthy(result: MeterResult): boolean {
  return result.peakSignal > result.darkSignal * 2;
}
