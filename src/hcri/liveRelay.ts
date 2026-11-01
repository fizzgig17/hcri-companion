// src/hcri/liveRelay.ts
//
// The pure part of the live station relay (no network or storage of its own, so it can be tested): per-second averaging of
// readings and the batching/resend logic. liveStation.ts wires it to hCRI.io.

const FLUSH_MS = 5000;
const FIRST_FLUSH_MS = 3000;
const BATCH = 1000;

/** Turns timed readings into one mean value per second, repeating the last value across a gap so the time axis stays true. */
export class SecondBinner {
  values: number[] = [];
  private origin: number | null = null;
  private idx = 0;
  private sum = 0;
  private n = 0;

  add(ms: number, v: number): void {
    if (!Number.isFinite(v)) return;
    if (this.origin == null) this.origin = ms;
    const i = Math.max(0, Math.floor((ms - this.origin) / 1000));
    if (i > this.idx) this.close(i);
    this.sum += v;
    this.n += 1;
  }

  /** Closes the second in progress (for the final partial second). */
  flushPartial(): void {
    if (this.n > 0) { this.values.push(this.sum / this.n); this.sum = 0; this.n = 0; this.idx += 1; }
  }

  private close(next: number): void {
    const mean = this.n > 0 ? this.sum / this.n : (this.values.length ? this.values[this.values.length - 1] : 0);
    this.values.push(mean);
    for (let k = this.idx + 1; k < next; k += 1) this.values.push(mean);
    this.idx = next;
    this.sum = 0;
    this.n = 0;
  }
}

export type LiveSend = (body: object) => Promise<{ count: number; resend?: boolean; enabled?: boolean }>;

/** Keeps track of what the server has and sends the rest. Safe to call flush() at any time; sends never overlap. */
export class LiveRelay {
  readonly bins = new SecondBinner();
  private sent = 0;
  private busy = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private first: ReturnType<typeof setTimeout> | null = null;
  off = false;   // the owner switched the station off on the server: stop sending

  constructor(private runId: string, private getLabel: () => string, private send: LiveSend, private kind: 'run' | 'monitor' = 'run') {}

  start(): void {
    this.first = setTimeout(() => { this.flush().catch(() => {}); }, FIRST_FLUSH_MS);
    this.timer = setInterval(() => { this.flush().catch(() => {}); }, FLUSH_MS);
  }
  add(ms: number, v: number): void { this.bins.add(ms, v); }

  stopTimers(): void {
    if (this.first) clearTimeout(this.first);
    if (this.timer) clearInterval(this.timer);
    this.first = null;
    this.timer = null;
  }

  /** Sends everything the server does not have yet. Returns false if a send failed (it will be retried). */
  async flush(status: 'running' | 'finished' | 'error' = 'running', message = ''): Promise<boolean> {
    if (this.off) return true;
    if (this.busy) return false;
    this.busy = true;
    try {
      for (let guard = 0; guard < 50; guard += 1) {
        const vals = this.bins.values;
        const chunk = vals.slice(this.sent, this.sent + BATCH);
        const lastChunk = this.sent + chunk.length >= vals.length;
        if (chunk.length === 0 && status === 'running') return true;   // nothing new: stay quiet so the server can notice a silent run
        const r = await this.send({
          runId: this.runId, kind: this.kind, label: this.getLabel(), unit: 'lm', intervalSeconds: 1, startIndex: this.sent, values: chunk,
          status: lastChunk ? status : 'running', ...(lastChunk && message ? { message } : {}),
        });
        if (r.enabled === false) { this.off = true; return true; }
        if (r.resend) { this.sent = Math.min(r.count, vals.length); continue; }
        this.sent = r.count;
        if (lastChunk) return true;
      }
      return true;
    } catch {
      return false;
    } finally {
      this.busy = false;
    }
  }

  /** The run is over: send the rest with its final status (a couple of tries if the phone is briefly offline). */
  async finish(status: 'finished' | 'error', message = ''): Promise<void> {
    this.stopTimers();
    this.bins.flushPartial();
    for (let i = 0; i < 4; i += 1) {
      if (this.busy) { await new Promise<void>((r) => setTimeout(r, 1500)); continue; }
      if (await this.flush(status, message)) return;
      await new Promise<void>((r) => setTimeout(r, 3000));
    }
  }
}

