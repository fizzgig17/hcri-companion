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
/** Longest curve hCRI.io accepts. */
export const TK_MAX_POINTS = 5000;

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
