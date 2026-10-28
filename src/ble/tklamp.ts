// src/ble/tklamp.ts
//
// TKLamp TK2303D integrating-sphere tester, reached through the hCRI ESP32 bridge (kind 2). The bridge listens to the
// tester's own serial stream and forwards each reading as result packet 06, about every 220 ms:
//   06 | ms u32 | raw u32      (little-endian; ms = bridge uptime, raw = the tester's sensor count)
// Lumens = raw / rawPerLumen. 313.2 was measured on a calibrated unit against its 2150 lm calibration lamp (and 675 lm
// on the screen); it is a setting because a recalibrated tester has a different scale. The tester subtracts its own
// dark level, so there is no offset.
//
// A run is recorded as (seconds, lumens) points, resampled to a fixed interval and uploaded as one Runtime curve.

export const TK_RAW_PER_LM_DEFAULT = 313.2;

// The scale in force right now. Settings and the live panel both change it (and save it); the live panel follows.
let currentRawPerLm = TK_RAW_PER_LM_DEFAULT;
const scaleListeners = new Set<(v: number) => void>();
export function getTkRawPerLm(): number { return currentRawPerLm; }
export function setTkRawPerLm(v: number): void {
  if (!(v > 0) || v === currentRawPerLm) return;
  currentRawPerLm = v;
  scaleListeners.forEach((cb) => cb(v));
}
export function onTkRawPerLm(cb: (v: number) => void): () => void {
  scaleListeners.add(cb);
  return () => { scaleListeners.delete(cb); };
}
/** The scale that makes a steady `rawAvgLm` reading (taken at `scale`) come out as `knownLm`. */
export function scaleFromLamp(rawAvgLm: number, scale: number, knownLm: number): number | null {
  if (!(rawAvgLm > 0) || !(knownLm > 0) || !(scale > 0)) return null;
  return Math.round((scale * rawAvgLm / knownLm) * 10) / 10;
}
/** Longest curve hCRI.io accepts (24 hours at one reading a second is 86,400). */
export const TK_MAX_POINTS = 100000;

export interface TkSample {
  /** Bridge uptime in ms when the reading arrived. */
  ms: number;
  raw: number;
}

export function parseTkSample(p: Uint8Array): TkSample | null {
  if (p.length < 9 || p[0] !== 0x06) return null;
  const dv = new DataView(p.buffer, p.byteOffset, p.byteLength);
  return { ms: dv.getUint32(1, true), raw: dv.getUint32(5, true) };
}

export function tkLumens(raw: number, rawPerLm: number): number {
  return rawPerLm > 0 ? raw / rawPerLm : 0;
}

/** Moving average over the last n readings (n = 5 is about one second). */
export class TkSmoother {
  private buf: number[] = [];
  constructor(private n = 5) {}
  push(v: number): number {
    this.buf.push(v);
    if (this.buf.length > this.n) this.buf.shift();
    return this.value();
  }
  value(): number {
    return this.buf.length ? this.buf.reduce((a, b) => a + b, 0) / this.buf.length : 0;
  }
  reset(): void {
    this.buf = [];
  }
}

export interface TkPoint {
  /** Seconds since the first reading of the run. */
  t: number;
  lm: number;
}

/** Records a run. Times come from the bridge's clock, so Bluetooth delays do not bend the curve. */
export class TkRecorder {
  private t0: number | null = null;
  private pts: TkPoint[] = [];
  add(s: TkSample, rawPerLm: number): void {
    if (this.t0 == null) this.t0 = s.ms;
    // The bridge clock is 32-bit milliseconds; it only wraps after 49 days, but never let a wrap go backwards.
    const t = Math.max(0, (s.ms - this.t0) / 1000);
    this.pts.push({ t, lm: tkLumens(s.raw, rawPerLm) });
  }
  get count(): number {
    return this.pts.length;
  }
  get seconds(): number {
    return this.pts.length ? this.pts[this.pts.length - 1].t : 0;
  }
  points(): TkPoint[] {
    return this.pts;
  }
  reset(): void {
    this.t0 = null;
    this.pts = [];
  }
}

/**
 * Averages a run into fixed-width time bins (1 s, or wider when the run is longer than TK_MAX_POINTS seconds).
 * A bin with no readings (a Bluetooth gap) repeats the previous value rather than inventing a drop.
 * Returns null when there are fewer than two bins.
 */
export function resampleRun(points: TkPoint[]): { intervalSeconds: number; values: number[] } | null {
  if (points.length < 2) return null;
  const dur = points[points.length - 1].t;
  const step = dur <= TK_MAX_POINTS - 1 ? 1 : Math.ceil(dur / (TK_MAX_POINTS - 1));
  const bins = Math.floor(dur / step) + 1;
  if (bins < 2) return null;
  const sum = new Array<number>(bins).fill(0);
  const cnt = new Array<number>(bins).fill(0);
  for (const p of points) {
    const b = Math.min(bins - 1, Math.floor(p.t / step));
    sum[b] += p.lm;
    cnt[b]++;
  }
  const values: number[] = [];
  let last = 0;
  for (let i = 0; i < bins; i++) {
    if (cnt[i]) last = sum[i] / cnt[i];
    values.push(Math.round(last * 10) / 10);
  }
  return { intervalSeconds: step, values };
}

/** Default label for a recorded run, e.g. "TKLamp run 2026-10-27 10:41". */
export function defaultRunLabel(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `TKLamp run ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// How many seconds the live chart shows across the screen before you have to swipe back (Settings > TKLamp tester).
export const TK_WINDOW_DEFAULT_S = 120;
let currentWindowS = TK_WINDOW_DEFAULT_S;
const windowListeners = new Set<(v: number) => void>();
export function getTkWindowS(): number { return currentWindowS; }
export function setTkWindowS(v: number): void {
  if (!(v >= 10) || v === currentWindowS) return;
  currentWindowS = v;
  windowListeners.forEach((cb) => cb(v));
}
export function onTkWindowS(cb: (v: number) => void): () => void {
  windowListeners.add(cb);
  return () => { windowListeners.delete(cb); };
}

// The bottom-bar main button starts and stops a run; the live panel does the recording and reports its state back here.
export interface TkRunState { recording: boolean; /** Waiting for the light to reach the start level. */ armed: boolean; canRecord: boolean; /** A stopped run is waiting to be uploaded. */ canUpload: boolean; uploading: boolean; /** The last stopped run has been uploaded. */ uploaded: boolean }
let runState: TkRunState = { recording: false, armed: false, canRecord: false, canUpload: false, uploading: false, uploaded: false };
const runStateListeners = new Set<(s: TkRunState) => void>();
const runCommandListeners = new Set<() => void>();
export function getTkRunState(): TkRunState { return runState; }
export function setTkRunState(s: TkRunState): void {
  if (s.recording === runState.recording && s.armed === runState.armed && s.canRecord === runState.canRecord && s.canUpload === runState.canUpload && s.uploading === runState.uploading && s.uploaded === runState.uploaded) return;
  runState = s;
  runStateListeners.forEach((cb) => cb(s));
}
export function onTkRunState(cb: (s: TkRunState) => void): () => void {
  runStateListeners.add(cb);
  return () => { runStateListeners.delete(cb); };
}
/** Start a run, or stop the one in progress. */
export function toggleTkRun(): void { runCommandListeners.forEach((cb) => cb()); }
export function onTkRunToggle(cb: () => void): () => void {
  runCommandListeners.add(cb);
  return () => { runCommandListeners.delete(cb); };
}

/**
 * Drops the near-dark readings at the start of a run (before the light came on): everything before the output first reaches
 * `fraction` of the run's peak, keeping `keepS` seconds of lead-in. Times are shifted so the run starts at 0. Returns the
 * points unchanged if nothing would be dropped or the run never gets above the threshold.
 */
export function trimLeading(points: TkPoint[], fraction = 0.02, keepS = 1): TkPoint[] {
  if (points.length < 2) return points;
  const peak = points.reduce((m, p) => (p.lm > m ? p.lm : m), 0);
  if (!(peak > 0)) return points;
  const i = points.findIndex((p) => p.lm >= peak * fraction);
  if (i <= 0) return points;
  const start = points[i].t - keepS;
  const kept = points.filter((p) => p.t >= start);
  if (kept.length < 2 || kept.length === points.length) return points;
  const t0 = kept[0].t;
  return kept.map((p) => ({ t: p.t - t0, lm: p.lm }));
}

// Settings > TKLamp tester > "Trim the dark start of a run" (on by default).
let trimOn = true;
export function getTkTrim(): boolean { return trimOn; }
export function setTkTrim(v: boolean): void { trimOn = v; }

// Run limits (shown on the TKLamp panel, kept between runs and app restarts): start the recording when the light reaches a
// level, stop it when the output falls below a level, after a set time, or when readings stop arriving.
export interface TkLimits {
  /** Start recording when the 1 s average reaches this many lumens (null: Start run begins at once). */
  startAtLm: number | null;
  /** Stop when the output falls below this many lumens (null: off). */
  stopBelowLm: number | null;
  /** Stop after this many minutes of recording (null: off). */
  durationMin: number | null;
  /** Stop when no reading has arrived for this many minutes (0: off). */
  idleMin: number;
}
export const TK_LIMITS_DEFAULT: TkLimits = { startAtLm: null, stopBelowLm: null, durationMin: null, idleMin: 5 };
/** The output must stay below the stop level for this long, so a flicker or a noisy reading does not end the run. */
export const TK_STOP_BELOW_HOLD_S = 3;
let currentLimits: TkLimits = { ...TK_LIMITS_DEFAULT };
const limitListeners = new Set<(v: TkLimits) => void>();
export function getTkLimits(): TkLimits { return currentLimits; }
export function setTkLimits(v: TkLimits): void {
  currentLimits = { ...v };
  limitListeners.forEach((cb) => cb(currentLimits));
}
export function onTkLimits(cb: (v: TkLimits) => void): () => void {
  limitListeners.add(cb);
  return () => { limitListeners.delete(cb); };
}
/** Text from a limit box to a number: blank is "off" (null); anything that is not a number of at least 0 is undefined. */
export function parseTkLimit(text: string): number | null | undefined {
  const t = text.trim().replace(',', '.');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/**
 * Decides when a run should start and stop by itself. The stop level only counts once the output has been above it, so a
 * run started before the light is on does not end at once; it must then stay below it for TK_STOP_BELOW_HOLD_S seconds.
 */
export class TkRunGuard {
  private seenAbove = false;
  private belowSince: number | null = null;
  constructor(private limits: TkLimits = TK_LIMITS_DEFAULT) {}
  setLimits(l: TkLimits): void { this.limits = l; }
  reset(): void { this.seenAbove = false; this.belowSince = null; }
  /** True when the reading has reached the level that starts the recording (or no level is set). */
  shouldStart(avgLm: number): boolean {
    const a = this.limits.startAtLm;
    return a == null || avgLm >= a;
  }
  /** Called with each smoothed reading while recording; ms is the reading's own clock. Returns why to stop, or null. */
  onReading(avgLm: number, ms: number): string | null {
    const b = this.limits.stopBelowLm;
    if (b == null || b <= 0) return null;
    if (avgLm >= b) {
      this.seenAbove = true;
      this.belowSince = null;
      return null;
    }
    if (!this.seenAbove) return null;
    if (this.belowSince == null) this.belowSince = ms;
    if ((ms - this.belowSince) / 1000 >= TK_STOP_BELOW_HOLD_S) return `The output fell below ${b} lm.`;
    return null;
  }
  /** Called about once a second while recording. recSeconds: length so far; silentMs: time since the last reading. */
  onTimer(recSeconds: number, silentMs: number): string | null {
    const d = this.limits.durationMin;
    if (d != null && d > 0 && recSeconds >= d * 60) return `The ${d} minute time limit was reached.`;
    const i = this.limits.idleMin;
    if (i > 0 && silentMs >= i * 60000) return `No readings for ${i} minute${i === 1 ? '' : 's'}.`;
    return null;
  }
}

/** The bottom bar's Upload button asks the live panel to upload the run that was just stopped. */
const uploadListeners = new Set<() => void>();
export function requestTkUpload(): void { uploadListeners.forEach((cb) => cb()); }
export function onTkUploadRequest(cb: () => void): () => void {
  uploadListeners.add(cb);
  return () => { uploadListeners.delete(cb); };
}
