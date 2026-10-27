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
//     state: 0 ready, 1 scanning, 2 done, 3 error (no USB / timeout), 4 done but not locked,
//            5 not done (ColorMunki: the reason is in the 'try' byte, see colorMunkiFailMessage)
//     bytes 6-7 (newer firmware): meter kind (0 Torch Bearer, 1 ColorMunki, 2 TKLamp tester) and ColorMunki flags:
//       bit7 dial known, bits0-1 dial position (0 projector, 1 surface, 2 calibration, 3 ambient), bit2 dark calibration done,
//       bit3 high-gain dark references taken (very dim light)
//       bit5 readings are high resolution (3.33 nm); one flagged low light (summary status 2) is the standard 10 nm
//       bit6: the firmware already applies the HPCS-fitted spectral correction (Torch Bearer; ColorMunki with newer
//       firmware, its own curve), so the app must not apply one; the reading is marked corrected.
// Result packets (all little-endian):
//   01 | status u8 | peak_nm u16 | exposure_ms f32 | peak_val f32 | sum f32 | npts u16 | start_nm u16
//   02 | npts u16 | start_nm u16 | step_nm u8 | total_bytes u16      (header; float32 values follow)
//   03 | seq u8 | bytes...                                           (data chunks, seq from 0)
//   04 | chunks u8                                                   (end marker)
//   06 | ms u32 | raw u32                                             (TKLamp tester: one live reading, see tklamp.ts)
//   05 | id u8 | seq u8 | last u8 | bytes...                         (ColorMunki diagnostics after the end marker:
//        id 1 = the reading's raw sensor data, id 2 = the calibration block; logged for offline work, see onDiag)

import { analyzeSpectrum } from '../utils/spectralAnalysis';
import { cieColorMatch } from '../utils/cieChromaticity';
import type { MeterResult } from './parseResult';
import { applyTbCorrection, isTbCorrectionEnabled } from './tbCorrection';

export const TB_NAME_PREFIX = 'Torch Bearer';
/** Newer bridge firmware advertises this generic name (it can carry a Torch Bearer or a ColorMunki); older firmware says "Torch Bearer". */
export const BRIDGE_NAME = 'hCRI Bridge';
export const TB_SERVICE_UUID = '7a1c0001-5b2e-4f0a-9c3d-2e8f6b4a1d00';
export const TB_CMD_UUID = '7a1c0002-5b2e-4f0a-9c3d-2e8f6b4a1d00';
export const TB_RESULT_UUID = '7a1c0003-5b2e-4f0a-9c3d-2e8f6b4a1d00';
export const TB_STATUS_UUID = '7a1c0004-5b2e-4f0a-9c3d-2e8f6b4a1d00';

/** Base64 of the single byte 0x01 -- the "scan now" command. */
export const TB_CMD_SCAN_B64 = 'AQ==';

/** Base64 of the single byte 0x02 -- "send the last reading again". */
export const TB_CMD_RESEND_B64 = 'Ag==';
/** 05: cancel the reading in progress. Newer bridge firmware stops a ColorMunki reading or calibration at its next
 * step and sends no result; older firmware ignores it (the app then drops the result itself). */
export const TB_CMD_CANCEL_B64 = 'BQ==';
/** `name` of the error a cancelled bridge reading rejects with. */
export const TB_CANCELLED_ERROR = 'TbCancelledError';

/** Base64 of 0x03 0x00 / 0x03 0x01 -- "set the display orientation" (1 = turned 180 degrees). Needs bridge firmware that knows 0x03; older firmware ignores it. */
export const TB_CMD_FLIP_OFF_B64 = 'AwA=';
export const TB_CMD_FLIP_ON_B64 = 'AwE=';

/** Bridge status states (status characteristic, byte 0). */
export const TB_STATE_SCANNING = 1;
export const TB_STATE_ERROR = 3;
export const TB_STATE_FAILED = 5;

export const TB_KIND_TORCH_BEARER = 0;
export const TB_KIND_COLORMUNKI = 1;
/** TKLamp TK2303D integrating-sphere tester behind the bridge: no spectrum, live lumen readings (result packet 06, see tklamp.ts). */
export const TB_KIND_TKLAMP = 2;
export const MUNKI_DIAL_PROJECTOR = 0;
export const MUNKI_DIAL_SURFACE = 1;
export const MUNKI_DIAL_CALIBRATION = 2;
export const MUNKI_DIAL_AMBIENT = 3;

/** The bridge's status characteristic, decoded. Older firmware sends only 6 bytes, so kind is 0 and the dial is unknown. */
export interface TbMeterStatus {
  state: number;
  /** The 'try' byte: for state 5 on a ColorMunki, why it did not finish. */
  reason: number;
  exposureMs: number;
  kind: number;
  dialKnown: boolean;
  dial: number;
  calibrated: boolean;
  /** ColorMunki (newer firmware, flags bit 3): the dark calibration also took the high-gain references used in very dim light. */
  highGainReady: boolean;
  /** ColorMunki (newer firmware, flags bit 5): readings are high resolution (3.33 nm), except one flagged low light (10 nm). */
  highRes: boolean;
  /** The bridge already applied the HPCS-fitted spectral correction to the spectrum it sends (Torch Bearer, or a ColorMunki with newer firmware). */
  fwCorrected: boolean;
  /** ColorMunki: minutes since the dark calibration, as of the moment this status was sent (null = unknown or none). */
  calAgeMin: number | null;
  /** When the app received this status (Date.now()), so the age can be carried forward. Set by MeterConnection. */
  receivedAt?: number;
}

export function parseTbStatus(p: Uint8Array): TbMeterStatus {
  const dv = new DataView(p.buffer, p.byteOffset, p.byteLength);
  const flags = p.length > 7 ? p[7] : 0;
  return {
    state: p[0] ?? 0,
    reason: p[1] ?? 0,
    exposureMs: p.length >= 6 ? dv.getFloat32(2, true) : 0,
    kind: p.length > 6 ? p[6] : TB_KIND_TORCH_BEARER,
    dialKnown: (flags & 0x80) !== 0,
    dial: flags & 0x03,
    calibrated: (flags & 0x04) !== 0,
    highGainReady: (flags & 0x08) !== 0,
    highRes: (flags & 0x20) !== 0,
    fwCorrected: (flags & 0x40) !== 0,
    calAgeMin: p.length > 9 && (p[8] | (p[9] << 8)) !== 0xffff ? p[8] | (p[9] << 8) : null,
  };
}

/** Why a ColorMunki did not finish (the 'try' byte of a state 5 status). */
export function colorMunkiFailMessage(reason: number): string {
  switch (reason) {
    case 1: return 'The light is too bright for the ColorMunki. Move it further away or dim it, then try again.';
    case 2: return 'The ColorMunki did not answer. Check it is still plugged in, then try again.';
    case 3: return 'Calibrate first: turn the ColorMunki dial to the calibration position and press Calibrate.';
    case 6: return 'Calibration failed. Check the ColorMunki is still plugged in and the dial is on the calibration position, then try again.';
    case 5: return 'Turn the ColorMunki dial to Ambient to take a reading (or to Calibration to calibrate).';
    default: return 'The ColorMunki could not finish. Try again.';
  }
}

/** What the main button should do for the current ColorMunki dial position. */
export type MunkiButtonMode =
  | { kind: 'calibrate' }
  | { kind: 'measure' }
  | { kind: 'blocked'; caption: string; note: string };

let munkiCalHours = 1;
/** Settings > ColorMunki calibration limit in hours (0 = never expires). */
export function setMunkiCalHours(h: number): void { munkiCalHours = h; }
export function getMunkiCalHours(): number { return munkiCalHours; }

/** Minutes since the ColorMunki's dark calibration right now, carried forward from when the status arrived. */
export function munkiCalAgeNowMin(s: TbMeterStatus, now: number = Date.now()): number | null {
  if (s.calAgeMin == null) return null;
  return s.calAgeMin + (s.receivedAt != null ? Math.max(0, now - s.receivedAt) / 60000 : 0);
}

/** maxAgeHours 0 (or omitted) = never expires. */
export function munkiButtonMode(s: TbMeterStatus, maxAgeHours = 0, now: number = Date.now()): MunkiButtonMode {
  if (!s.dialKnown) return { kind: 'blocked', caption: 'Please wait', note: 'Reading the ColorMunki dial…' };
  if (s.dial === MUNKI_DIAL_CALIBRATION) return { kind: 'calibrate' };
  if (s.dial === MUNKI_DIAL_AMBIENT) {
    if (!s.calibrated) {
      return { kind: 'blocked', caption: 'Calibrate first', note: 'Not calibrated yet: turn the dial to the calibration position and press Calibrate.' };
    }
    const age = munkiCalAgeNowMin(s, now);
    if (maxAgeHours > 0 && age != null && age > maxAgeHours * 60) {
      const h = age / 60;
      const ageText = h < 1 ? `${Math.round(age)} min` : `${h.toFixed(1)} h`;
      return { kind: 'blocked', caption: 'Recalibrate', note: `Calibration is ${ageText} old (limit ${maxAgeHours} h): turn the dial to the calibration position and press Calibrate.` };
    }
    return { kind: 'measure' };
  }
  return { kind: 'blocked', caption: 'Turn dial', note: 'Turn the ColorMunki dial to Ambient to take a reading, or to Calibration to calibrate.' };
}

/** Matched by advertised name (the service UUID sits in the scan response, which not every phone stack merges in reliably). */
export function isTorchBearerName(name: string | null | undefined): boolean {
  return !!name && (name.startsWith(TB_NAME_PREFIX) || name.startsWith(BRIDGE_NAME));
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

/** Identifies one scan (the same values the bridge sends in its summary packet), so the same reading is never taken twice. */
export function tbSummarySignature(s: TbSummary): string {
  return `${s.status}|${s.peakNm}|${s.exposureMs}|${s.peakValue}|${s.sum}|${s.npts}|${s.startNm}`;
}

/** Parses a bridge summary packet (type 0x01), or null if it is not one. */
export function parseTbSummary(p: Uint8Array): TbSummary | null {
  if (p.length < 20 || p[0] !== 0x01) return null;
  const dv = new DataView(p.buffer, p.byteOffset, p.byteLength);
  return {
    status: p[1],
    peakNm: dv.getUint16(2, true),
    exposureMs: dv.getFloat32(4, true),
    peakValue: dv.getFloat32(8, true),
    sum: dv.getFloat32(12, true),
    npts: dv.getUint16(16, true),
    startNm: dv.getUint16(18, true),
  };
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
  /** Called with each complete diagnostics blob (packet type 05). Separate from the reading itself. */
  onDiag: ((id: number, bytes: Uint8Array) => void) | null = null;
  private diag = new Map<number, { next: number; parts: Uint8Array[] }>();
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
      case 0x05: {
        // Diagnostics never affect the reading, so a gap just drops that blob instead of throwing.
        if (p.length < 4) return null;
        const id = p[1];
        const seq = p[2];
        let d = this.diag.get(id);
        if (seq === 0) {
          d = { next: 0, parts: [] };
          this.diag.set(id, d);
        }
        if (!d || seq !== (d.next & 0xff)) {
          this.diag.delete(id);
          return null;
        }
        d.parts.push(p.slice(4));
        d.next++;
        if (p[3] & 1) {
          this.diag.delete(id);
          const n = d.parts.reduce((s, x) => s + x.length, 0);
          const all = new Uint8Array(n);
          let o = 0;
          for (const x of d.parts) { all.set(x, o); o += x.length; }
          this.onDiag?.(id, all);
        }
        return null;
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
export function tbToMeterResult(scan: TbScan, deviceName: string, kind: number = TB_KIND_TORCH_BEARER, fwCorrected = false, highRes = false): MeterResult {
  const { summary } = scan;
  const isMunki = kind === TB_KIND_COLORMUNKI;
  // The bridge sends the raw spectrum; the app applies the HPCS-matching
  // correction (tbCorrection.ts) unless it's switched off in Settings.
  // The correction is fitted to the Torch Bearer against an HPCS; it must never be applied to a ColorMunki spectrum.
  // Newer firmware corrects on the board (status bit 6); then the app must not apply the curve a second time.
  const appCorrects = !isMunki && !fwCorrected && isTbCorrectionEnabled();
  // ColorMunki: newer bridge firmware applies its own HPCS-fitted curve (munki_corr.h) and says so with the same bit.
  const corrected = fwCorrected || appCorrects;
  const spectrum = appCorrects ? applyTbCorrection(scan.spectrum) : scan.spectrum;
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
    deviceName: isMunki ? 'ColorMunki' : isTorchBearerName(deviceName) ? 'Torch Bearer' : deviceName,
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
    meterModel: isMunki ? 'colormunki' : undefined,
    ...(isMunki ? { munkiResolutionNm: highRes && summary.status !== 2 ? 3.3 : 10 } : {}),
  };
}
