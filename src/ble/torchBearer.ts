// src/ble/torchBearer.ts
//
// Support for the Torch Bearer spectrometer, reached through the
// "Torch Bearer" ESP32 (T-Display S3) bridge firmware over BLE -- NOT the
// spectrometer's own USB serial protocol. All the decoding of the
// spectrometer's frames happens on the ESP32; this file only reads the
// bridge's simple packet format and turns it into the same MeterResult the
// HPCS meters produce. No GPL code from tobes-ui/Torch-Bearer-Tools lives in
// the app -- only the bridge's own packet layout is described here.
//
// GATT service 7a1c0001-5b2e-4f0a-9c3d-2e8f6b4a1d00:
//   ...0002 command (write): 01 = scan, 02 = resend last result
//   ...0003 result  (notify): summary packet, then the full spectrum in chunks
//   ...0004 status  (notify/read): [state u8][try u8][exposure_ms f32]
//     state: 0 ready, 1 scanning, 2 done, 3 error (no USB / timeout), 4 done but not locked
// Result packets (all little-endian):
//   01 | status u8 | peak_nm u16 | exposure_ms f32 | peak_val f32 | sum f32 | npts u16 | start_nm u16
//   02 | npts u16 | start_nm u16 | step_nm u8 | total_bytes u16      (header; float32 values follow)
//   03 | seq u8 | bytes...                                           (data chunks, seq from 0)
//   04 | chunks u8                                                   (end marker)

import { analyzeSpectrum } from '../utils/spectralAnalysis';
import { cieColorMatch } from '../utils/cieChromaticity';
import type { MeterResult } from './parseResult';
import { applyTbCorrection, isTbCorrectionEnabled } from './tbCorrection';

export const TB_NAME_PREFIX = 'Torch Bearer';
export const TB_SERVICE_UUID = '7a1c0001-5b2e-4f0a-9c3d-2e8f6b4a1d00';
export const TB_CMD_UUID = '7a1c0002-5b2e-4f0a-9c3d-2e8f6b4a1d00';
export const TB_RESULT_UUID = '7a1c0003-5b2e-4f0a-9c3d-2e8f6b4a1d00';
export const TB_STATUS_UUID = '7a1c0004-5b2e-4f0a-9c3d-2e8f6b4a1d00';

/** Base64 of the single byte 0x01 -- the "scan now" command. */
export const TB_CMD_SCAN_B64 = 'AQ==';

/** Bridge status states (status characteristic, byte 0). */
export const TB_STATE_SCANNING = 1;
export const TB_STATE_ERROR = 3;

/** Matched by advertised name (the service UUID sits in the scan response, which not every phone stack merges in reliably). */
export function isTorchBearerName(name: string | null | undefined): boolean {
  return !!name && name.startsWith(TB_NAME_PREFIX);
}

export interface TbSummary {
  /** 0 normal, 1 over-exposed, 2 under-exposed (the spectrometer's own status on the final frame). */
  status: number;
  peakNm: number;
  exposureMs: number;
  peakValue: number;
  sum: number;
  npts: number;
  startNm: number;
}

export interface TbScan {
  summary: TbSummary;
  spectrum: { nm: number; value: number }[];
}

/**
 * Pure reassembler for the result characteristic's notifications. Feed it
 * every packet in order; push() returns the finished scan when the end
 * marker arrives (and throws on a gap or a size mismatch), null otherwise.
 */
export class TbReassembler {
  private summary: TbSummary | null = null;
  private total = 0;
  private npts = 0;
  private startNm = 0;
  private step = 1;
  private data: Uint8Array | null = null;
  private got = 0;
  private nextSeq = 0;

  reset(): void {
    this.summary = null;
    this.total = 0;
    this.data = null;
    this.got = 0;
    this.nextSeq = 0;
  }

  push(p: Uint8Array): TbScan | null {
    if (p.length === 0) return null;
    const dv = new DataView(p.buffer, p.byteOffset, p.byteLength);
    switch (p[0]) {
      case 0x01: {
        if (p.length < 20) throw new Error('Torch Bearer summary packet too short');
        this.reset();
        this.summary = {
          status: p[1],
          peakNm: dv.getUint16(2, true),
          exposureMs: dv.getFloat32(4, true),
          peakValue: dv.getFloat32(8, true),
          sum: dv.getFloat32(12, true),
          npts: dv.getUint16(16, true),
          startNm: dv.getUint16(18, true),
        };
        return null;
      }
      case 0x02: {
        if (p.length < 8) throw new Error('Torch Bearer header packet too short');
        this.npts = dv.getUint16(1, true);
        this.startNm = dv.getUint16(3, true);
        this.step = p[5] || 1;
        this.total = dv.getUint16(6, true);
        this.data = new Uint8Array(this.total);
        this.got = 0;
        this.nextSeq = 0;
        return null;
      }
      case 0x03: {
        if (!this.data) throw new Error('Torch Bearer data packet before header');
        const seq = p[1];
        if (seq !== (this.nextSeq & 0xff)) {
          throw new Error(`Torch Bearer data packet out of order (got ${seq}, expected ${this.nextSeq & 0xff})`);
        }
        this.nextSeq++;
        const chunk = p.subarray(2);
        this.data.set(chunk.subarray(0, Math.max(0, this.total - this.got)), this.got);
        this.got += chunk.length;
        return null;
      }
      case 0x04: {
        if (!this.data || !this.summary) throw new Error('Torch Bearer end marker without a complete header');
        if (this.got !== this.total) {
          throw new Error(`Torch Bearer spectrum incomplete (${this.got}/${this.total} bytes)`);
        }
        const view = new DataView(this.data.buffer, this.data.byteOffset, this.data.byteLength);
        const spectrum: { nm: number; value: number }[] = [];
        for (let i = 0; i < this.npts; i++) {
          spectrum.push({ nm: this.startNm + i * this.step, value: view.getFloat32(i * 4, true) });
        }
        const out: TbScan = { summary: this.summary, spectrum };
        this.reset();
        return out;
      }
      default:
        return null; // unknown packet type -- ignore (forward compatibility)
    }
  }
}

/**
 * Turns a Torch Bearer scan into the same MeterResult the HPCS meters
 * produce. x/y/CCT/Duv/CRI/TM-30 all come from analyzeSpectrum() -- the
 * app's own spectrum math -- since this device only ever reports a
 * spectrum. lux and PAR are computed straight from that spectrum and are
 * only as good as the device's own units (W/m^2/nm, per the upstream
 * tobes-ui project); they have NOT been calibrated against a reference meter.
 */
export function tbToMeterResult(scan: TbScan, deviceName: string): MeterResult {
  const { summary } = scan;
  // The bridge sends the raw spectrum; the app applies the HPCS-matching
  // correction (tbCorrection.ts) unless it's switched off in Settings.
  const corrected = isTbCorrectionEnabled();
  const spectrum = corrected ? applyTbCorrection(scan.spectrum) : scan.spectrum;
  const a = analyzeSpectrum(spectrum);

  // Photopic illuminance: 683 lm/W * sum(ybar * E(lambda) * dlambda). Step is 1 nm.
  let lux = 0;
  let par = 0;
  for (let i = 0; i < spectrum.length; i++) {
    const nm = spectrum[i].nm;
    const dl = i + 1 < spectrum.length ? spectrum[i + 1].nm - nm : 1;
    lux += cieColorMatch(nm).y * spectrum[i].value * dl;
    if (nm >= 400 && nm <= 700) par += spectrum[i].value * nm * dl;
  }
  lux *= 683;
  par *= 8.359e-3; // W/m^2/nm * nm -> umol/m^2/s (h*c*N_A = 0.11963 J*m/mol)

  return {
    deviceName,
    firmwareVersion: 0,
    cct: a.cct,
    ra: a.ra,
    lux,
    par,
    peakSignal: summary.peakValue,
    darkSignal: 0,
    integrationTimeMs: summary.exposureMs,
    compensateLevel: 0,
    x: a.x,
    y: a.y,
    duv: a.duv,
    rIndices: a.ri,
    tm30Rf: a.rf,
    tm30Rg: a.rg,
    timestampOnDevice: new Date().toISOString(),
    spectrum,
    source: 'torchbearer',
    tbStatus: summary.status,
    tbCorrected: corrected,
  };
}
