// src/ble/parseResult.ts
//
// Turns a fully-reassembled 8C 13 response body into a typed result object.
// Pure function, no BLE knowledge -- easy to unit test against a captured
// buffer without needing real hardware.

import { Buffer } from 'buffer';
import { FIELD_OFFSETS_330P, ASSUMED_START_WAVELENGTH_NM, FieldOffsetMap } from './protocol';

export interface MeterResult {
  deviceName: string;
  firmwareVersion: number;
  cct: number;
  ra: number;
  /** Null on models that don't report illuminance in this scheme (the HPCS-310, so far) -- not a parsing failure, the field genuinely isn't there. */
  lux: number | null;
  par: number;
  peakSignal: number;
  darkSignal: number;
  integrationTimeMs: number;
  compensateLevel: number;
  x: number;
  y: number;
  duv: number;
  rIndices: number[]; // R1..R15, in order
  /** TM-30 fidelity/gamut indices. Null on models that don't report them (330P, 310 -- so far only the 330Pro does). */
  tm30Rf: number | null;
  tm30Rg: number | null;
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
 * @param offsets Which model's field map to read against -- defaults to
 *   the 330P's, but pass FIELD_OFFSETS_310 (or whatever
 *   getFieldOffsetsForDevice(deviceName) returns) for other models, since
 *   the byte layout genuinely differs between them.
 */
export function parseResult(body: Uint8Array, offsets: FieldOffsetMap = FIELD_OFFSETS_330P): MeterResult {
  const o = offsets;

  const rIndices: number[] = [];
  for (let i = 1; i <= 15; i++) {
    rIndices.push(f32(body, (o as any)[`r${i}`]));
  }

  // The result body reserves a fixed number of spectrum slots regardless of
  // how much of that range the sensor actually captured -- on every model
  // seen so far, whatever's left over past the real data is just trailing
  // 0.0 padding (not noise, not garbage -- exact zero). Reading pointCount
  // straight from the remaining body length was labeling ALL of that
  // padding with sequential (correct) wavelengths too, which is why the
  // chart/CSV kept showing a far wider range (e.g. up to ~1000nm) than the
  // device itself ever reported having real data for. Fix: read the FULL
  // reserved range first, then trim padding off the *end* only, so a
  // legitimate zero reading in the middle of real data (a deep notch in the
  // spectrum) is never mistaken for the start of padding.
  const spectrumBytes = body.length - o.spectrumStart;
  let rawPointCount = Math.floor(spectrumBytes / 4);
  const rawValues: number[] = [];
  for (let i = 0; i < rawPointCount; i++) {
    rawValues.push(f32(body, o.spectrumStart + i * 4));
  }

  // Found by decoding real debug logs (2026-09-27): the very last two float
  // slots in the body are NOT spectrum data at all -- they're a fixed
  // "visible range" footer describing the device's own start/end nm
  // convention, not a measurement. This is what was defeating the padding
  // trim below: it scans backward from the end looking for the first
  // non-near-zero value, and it was hitting that literal footer value
  // immediately -- stopping right there and treating every zero-padded slot
  // before it as "real" too, which is exactly the "still goes to 1000"
  // symptom.
  //
  // Originally this checked for an exact 380.0/780.0 pair (what one HPCS-330
  // dump showed), but a second device (HPCS-330P, same physical unit, after
  // its hard reset) showed 350.0/800.0 instead -- a different model/state
  // uses a different visible-range convention. Rather than hardcode every
  // pair that turns up, detect the *shape*: two whole numbers, the first in
  // a plausible violet/near-UV start band, the second in a plausible
  // red/near-IR end band, second greater than first. Real spectral data
  // essentially never lands on an exact integer by coincidence, so this is
  // a safe general signature for "this is a range marker, not a sample."
  function looksLikeRangeFooter(v1: number, v2: number): boolean {
    return Number.isInteger(v1) && Number.isInteger(v2) && v1 >= 300 && v1 <= 500 && v2 >= 700 && v2 <= 1100 && v2 > v1;
  }
  // The footer wasn't just noise to strip -- it's the device telling us,
  // for THIS reading, on THIS model/firmware state, exactly what
  // wavelength its first spectrum sample actually starts at. Discarding it
  // after detecting it (as this used to do) and falling back to one
  // hardcoded ASSUMED_START_WAVELENGTH_NM for every model was the actual
  // root cause of a much bigger bug than a mislabeled x-axis: an
  // HPCS330Pro's own footer reports 380/780, but every spectrum point was
  // still being labeled starting from 350 (the value independently derived
  // -- see ASSUMED_START_WAVELENGTH_NM's own comment -- for a completely
  // different model/state). That 30nm-wide mislabeling silently shifted
  // every point fed into analyzeSpectrum(), which is exactly what was
  // producing CCT/Ra/R9 numbers well off from the vendor app's own reading
  // of the identical spectrum (a wavelength-vs-value pairing that's off by
  // 30nm hits the red end -- and R9 specifically -- hardest, matching what
  // was actually observed: R9 29 here vs. the vendor app's 97 for the same
  // reading). Trust the footer's own start value whenever one was found;
  // only fall back to the guessed constant on a model/state that doesn't
  // report this footer at all.
  let startNm = ASSUMED_START_WAVELENGTH_NM;
  if (rawPointCount >= 2 && looksLikeRangeFooter(rawValues[rawPointCount - 2], rawValues[rawPointCount - 1])) {
    startNm = rawValues[rawPointCount - 2];
    rawValues.length -= 2;
    rawPointCount -= 2;
  }

  // Originally this checked for exact 0.0, on the theory that padding slots
  // are literally zero bits. That held for the one HPCS-330P dump it was
  // verified against, but evidently not universally -- if a model's padding
  // is a noise-floor value that's small but not bit-exact zero (or if a
  // single stray non-zero sample sits out in the padding region), an exact
  // equality check either never trims, or stops one sample too early. Use a
  // magnitude threshold instead: anything at or below ~0.1% of this
  // reading's own peak value is treated as noise/padding, not real signal.
  const peakAbs = rawValues.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  const epsilon = Math.max(peakAbs * 0.001, 1e-6);
  let lastRealIndex = rawValues.length - 1;
  while (lastRealIndex >= 0 && Math.abs(rawValues[lastRealIndex]) <= epsilon) {
    lastRealIndex--;
  }
  // If literally everything came back zero (a failed/empty exposure), don't
  // truncate it away to nothing -- keep the full raw array so there's still
  // something to look at and debug, rather than an empty chart.
  const pointCount = lastRealIndex >= 0 ? lastRealIndex + 1 : rawValues.length;

  const spectrum: { nm: number; value: number }[] = [];
  for (let i = 0; i < pointCount; i++) {
    spectrum.push({
      nm: startNm + i,
      value: rawValues[i],
    });
  }

  return {
    deviceName: asciiString(body, o.deviceName, 9),
    firmwareVersion: u32(body, o.firmwareVersion),
    cct: f32(body, o.cct),
    ra: f32(body, o.ra),
    lux: o.illuminanceE !== undefined ? f32(body, o.illuminanceE) : null,
    par: o.par !== undefined ? f32(body, o.par) : NaN,
    peakSignal: f32(body, o.peakSignal),
    darkSignal: f32(body, o.darkSignal),
    integrationTimeMs: f32(body, o.integrationTimeMs),
    compensateLevel: f32(body, o.compensateLevel),
    x: f32(body, o.x),
    y: f32(body, o.y),
    duv: f32(body, o.duv),
    rIndices,
    tm30Rf: o.tm30Rf !== undefined ? f32(body, o.tm30Rf) : null,
    tm30Rg: o.tm30Rg !== undefined ? f32(body, o.tm30Rg) : null,
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
