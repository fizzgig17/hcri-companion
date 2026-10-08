// src/ble/liveSessions.ts
//
// Long-running meter modes: Live (continuous spectrum) and Flicker.
// Both are started once, keep delivering updates until stop() is called, and
// are modelled on the vendor mini-program's protocol (reverse-engineered
// 2026-10-07). NOT yet verified on real hardware -- everything is logged so a
// debug capture can settle any wrong assumption.
//
//  Live:    8C 0E 02 once, then repeat the normal "wait for test end, read
//           8C 13 31" cycle (takeMeasurement with no start/stop commands).
//  Flicker: 8C 0E 04, poll 8C 3B until it answers 01, then loop
//           8C 3C (4 x float32 LE: Hz, %, index, cycle ms) -> 8C 3A (400 x
//           uint16 LE waveform). Stop with 8C 25.

import { MeterConnection, MeterMessage } from './MeterConnection';
import {
  CMD_START_CONTINUOUS_TEST,
  CMD_START_FLICKER_CONTINUOUS,
  CMD_FLICKER_READY,
  CMD_FLICKER_STATS,
  CMD_FLICKER_WAVE,
  CMD_FLICKER_SAMPLE_RATE,
  FLICKER_SPAN_MS,
  CMD_STOP_SAMPLING,
  FLICKER_WAVE_SAMPLES,
} from './protocol';
import { takeMeasurement, ABORTED_ERROR, EMPTY_READING_ERROR, LogFn } from './takeMeasurement';
import type { MeterResult } from './parseResult';

export interface LiveSession {
  /** Stops the run (sends 8C 25). Resolves once the meter has been told. Safe to call twice. */
  stop: () => Promise<void>;
  /** Resolves when the loop has fully ended (after stop(), or on error). */
  done: Promise<void>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

const MAX_CONSECUTIVE_FAILURES = 3;
// Pause between flicker refreshes, and how long to wait for a reply before resending a request.
const FLICKER_CYCLE_GAP_MS = 1000;
const FLICKER_STATS_TIMEOUT_MS = 6000;
const FLICKER_WAVE_TIMEOUT_MS = 8000;

/** Continuous spectrum. onResult fires once per refresh; onEnd fires exactly once, with an Error if it stopped by itself. */
export function startLiveSpectrum(
  conn: MeterConnection,
  log: LogFn,
  onResult: (r: MeterResult) => void,
  onEnd: (err?: Error) => void
): LiveSession {
  let stopped = false;
  let ended = false;
  // onEnd exactly once -- and immediately on Stop, so the UI never waits on the BLE round trips.
  const end = (err?: Error) => {
    if (ended) return;
    ended = true;
    onEnd(err);
  };
  const shouldAbort = () => stopped;

  const done = (async () => {
    let failures = 0;
    let first = true;
    let cycles = 0;
    let lastSig = '';
    let dupes = 0;
    const t0 = Date.now();
    try {
      while (!stopped) {
        try {
          const tCycle = Date.now();
          const r = await takeMeasurement(conn, log, {
            startCommand: first ? CMD_START_CONTINUOUS_TEST : null,
            sendStop: false,
            shouldAbort,
            pollIntervalMs: 100,
          });
          first = false;
          failures = 0;
          cycles += 1;
          const took = Date.now() - tCycle;
          log(`Live cycle ${cycles}: ${took}ms (integration ${r.integrationTimeMs ?? '?'}ms)`, true);
          if (cycles % 10 === 0) log(`Live: ${cycles} refreshes, ${((Date.now() - t0) / cycles).toFixed(0)}ms average`);
          // The meter can hand back the previous exposure again (stale "test end" state);
          // only show genuinely new spectra, and pace to one integration time per refresh.
          const sig = r.spectrum.map((p) => p.value).join(',');
          const duplicate = sig === lastSig;
          lastSig = sig;
          if (duplicate) {
            dupes += 1;
            log(`Live: duplicate result skipped (${dupes} so far)`, true);
          } else if (!stopped) {
            onResult(r);
          }
          const wait = Math.max(150, Math.min(1500, r.integrationTimeMs ?? 0)) - took;
          if (wait > 0 && !stopped) await sleep(wait);
        } catch (e: any) {
          if (stopped || e?.name === ABORTED_ERROR) break;
          failures += 1;
          log(`Live read failed (${failures}/${MAX_CONSECUTIVE_FAILURES}): ${e?.message ?? e}`);
          if (e?.name !== EMPTY_READING_ERROR && /Not connected/i.test(String(e?.message))) throw e;
          if (failures >= MAX_CONSECUTIVE_FAILURES) throw e;
          await sleep(300);
        }
      }
      end();
    } catch (e: any) {
      stopped = true;
      sendStopReliably(conn, log);
      end(e instanceof Error ? e : new Error(String(e)));
    }
  })();

  return {
    done,
    stop: async () => {
      if (stopped) return;
      stopped = true;
      end();
      // Fire and forget: the UI must never wait on a Bluetooth write (a stuck write used to hold up Disconnect).
      sendStopReliably(conn, log).catch(() => {});
    },
  };
}

/** Sends 8C 25 now and once more shortly after (a single write can be lost or land mid-reply), and clears any half-reassembled reply. */
async function sendStopReliably(conn: MeterConnection, log: LogFn): Promise<void> {
  try {
    await conn.sendCommand(CMD_STOP_SAMPLING);
    log('Stop (8C 25) handed to the Bluetooth stack', true);
  } catch (e: any) {
    log(`Stop failed: ${e?.message ?? e}`);
    return;
  }
  setTimeout(() => {
    conn.resetReassemblyState();
    conn.sendCommand(CMD_STOP_SAMPLING).catch(() => {});
  }, 250);
}

// ---------------------------------------------------------------------------

export interface FlickerReading {
  frequencyHz: number;
  percentFlicker: number;
  flickerIndex: number;
  cycleMs: number;
  /** Total time the 400 samples span, in ms, if the meter's sample-rate setting could be read. */
  spanMs?: number;
  /** The meter's sample-rate index (0-10) and range/gear index (0-3) when the run started, if it answered. */
  sampleIdx?: number;
  gear?: number;
  /** 400 raw waveform samples. */
  waveform: number[];
}

function readFloat32LE(b: Uint8Array, offset: number): number {
  return new DataView(b.buffer, b.byteOffset, b.byteLength).getFloat32(offset, true);
}

/** Waits for the next message with this sub-command (optionally passing `accept`), or null on timeout/abort. */
function waitForMessage(
  conn: MeterConnection,
  sub: number,
  timeoutMs: number,
  accept: (m: MeterMessage) => boolean,
  isStopped: () => boolean
): Promise<MeterMessage | null> {
  return new Promise((resolve) => {
    let finished = false;
    const finish = (m: MeterMessage | null) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      clearInterval(watch);
      unsub();
      resolve(m);
    };
    const unsub = conn.onMessage((m) => {
      if (m.subCommand === sub && accept(m)) finish(m);
    });
    const timer = setTimeout(() => finish(null), timeoutMs);
    const watch = setInterval(() => isStopped() && finish(null), 100);
  });
}

/** Sends `cmd` and waits for its reply, resending a few times on silence. */
async function request(
  conn: MeterConnection,
  cmd: number[],
  sub: number,
  timeoutMs: number,
  tries: number,
  accept: (m: MeterMessage) => boolean,
  isStopped: () => boolean,
  log: LogFn
): Promise<MeterMessage | null> {
  for (let i = 0; i < tries && !isStopped(); i++) {
    const tSend = Date.now();
    const waiting = waitForMessage(conn, sub, timeoutMs, accept, isStopped);
    await conn.sendCommand(cmd);
    const m = await waiting;
    const name = cmd.map((b) => b.toString(16).padStart(2, '0')).join(' ');
    if (m) {
      log(`reply to ${name} in ${Date.now() - tSend}ms (${m.body.length}B)`, true);
      return m;
    }
    if (!isStopped()) log(`No reply to ${name} (try ${i + 1}/${tries}, waited ${Date.now() - tSend}ms; last notification of any kind ${conn.msSinceLastNotify()} ago)`);
  }
  return null;
}

/** The meter stores some settings as BCD: index 10 is the byte 0x10. */
const fromBcd = (b: number) => ((b >> 4) & 0xf) * 10 + (b & 0xf);
const toBcd = (n: number) => ((Math.floor(n / 10) & 0xf) << 4) | (n % 10);

export interface FlickerSettings {
  autoGear?: boolean;
  /** 0-3 = x1, x10, x100, x1k. */
  gear?: number;
  /** 0-10 into FLICKER_SPAN_MS / the sample-rate list. */
  sampleIdx?: number;
  autoRate?: boolean;
}

/** Reads the meter's flicker range/sample-rate settings (stock app: 8C 38, 36, 3D, 3F). Missing replies stay undefined. */
export async function readFlickerSettings(conn: MeterConnection, log: LogFn): Promise<FlickerSettings> {
  const never = () => false;
  const ask = async (cmd: number[]) => {
    const m = await request(conn, cmd, cmd[1], 1500, 2, () => true, never, log);
    return m && m.body.length >= 3 ? m.body[2] : undefined;
  };
  const out: FlickerSettings = {};
  const a = await ask([0x8c, 0x38]);
  if (a !== undefined) out.autoGear = a === 1;
  const g = await ask([0x8c, 0x36]);
  if (g !== undefined) out.gear = fromBcd(g);
  const r = await ask([0x8c, 0x3d]);
  if (r !== undefined) out.sampleIdx = fromBcd(r);
  const ar = await ask([0x8c, 0x3f]);
  if (ar !== undefined) out.autoRate = ar === 1;
  log(`Flicker settings read: ${JSON.stringify(out)}`);
  return out;
}

export type FlickerSettingKey = 'autoGear' | 'gear' | 'sampleIdx' | 'autoRate';

/** Writes one setting (stock app: 8C 37 / 35 / 3E / 41) and waits for the meter's echo. Returns whether it acknowledged. */
export async function writeFlickerSetting(
  conn: MeterConnection,
  key: FlickerSettingKey,
  value: number | boolean,
  log: LogFn
): Promise<boolean> {
  const n = typeof value === 'boolean' ? (value ? 1 : 0) : value;
  const [sub, arg] =
    key === 'autoGear' ? [0x37, n] : key === 'gear' ? [0x35, n] : key === 'sampleIdx' ? [0x3e, toBcd(n)] : [0x41, n];
  const m = await request(conn, [0x8c, sub, arg], sub, 1500, 2, () => true, () => false, log);
  log(`Flicker setting ${key}=${n}: ${m ? 'acknowledged' : 'NO REPLY'}`);
  return !!m;
}

/**
 * Diagnostics: logs (verbose) whenever the app's own JavaScript thread was stalled for a while, by watching how
 * late a 250ms timer fires. Tells "the app froze" apart from "the meter went quiet". Returns a stop function.
 */
function startLagMonitor(log: LogFn): () => void {
  let last = Date.now();
  const timer = setInterval(() => {
    const now = Date.now();
    const late = now - last - 250;
    last = now;
    if (late > 400) log(`App JS thread stalled ~${late}ms`, true);
  }, 250);
  return () => clearInterval(timer);
}

/**
 * One flicker snapshot, for "capture flicker with each reading". Starts the meter's flicker mode, waits for a
 * capture, reads the statistics and the waveform once, then stops. Never throws and is bounded to a few
 * seconds: on any problem it logs and returns null so the normal reading is unaffected.
 */
export async function captureFlickerOnce(conn: MeterConnection, log: LogFn): Promise<FlickerReading | null> {
  const never = () => false;
  const t0 = Date.now();
  let started = false;
  try {
    conn.resetReassemblyState();
    let spanMs: number | undefined;
    let sampleIdx: number | undefined;
    let gear: number | undefined;
    const rate = await request(conn, CMD_FLICKER_SAMPLE_RATE, 0x3d, 1000, 1, () => true, never, log);
    const rateIdx = rate && rate.body.length >= 3 ? fromBcd(rate.body[2]) : -1;
    if (rateIdx >= 0 && rateIdx < FLICKER_SPAN_MS.length) {
      spanMs = FLICKER_SPAN_MS[rateIdx];
      sampleIdx = rateIdx;
    }
    const gearReply = await request(conn, [0x8c, 0x36], 0x36, 800, 1, () => true, never, log);
    if (gearReply && gearReply.body.length >= 3) gear = fromBcd(gearReply.body[2]);

    started = true;
    await conn.sendCommand(CMD_START_FLICKER_CONTINUOUS);
    await sleep(200);
    const readyDeadline = Date.now() + 6000;
    let ready = false;
    while (!ready && Date.now() < readyDeadline) {
      const m = await request(conn, CMD_FLICKER_READY, 0x3b, 600, 1, () => true, never, log);
      if (m && m.body[2] === 0x01) ready = true;
      else await sleep(150);
    }
    if (!ready) {
      log('Flicker capture: the meter never reported a capture ready -- skipped');
      return null;
    }
    const stats = await request(conn, CMD_FLICKER_STATS, 0x3c, 1500, 2, (m) => m.body.length >= 18, never, log);
    const wave = stats
      ? await request(conn, CMD_FLICKER_WAVE, 0x3a, 2000, 2, (m) => m.body.length >= FLICKER_WAVE_SAMPLES * 2, never, log)
      : null;
    if (!stats || !wave) {
      log(`Flicker capture: incomplete (stats ${stats ? 'ok' : 'missing'}, waveform ${wave ? 'ok' : 'missing'}) -- skipped`);
      return null;
    }
    const waveform: number[] = [];
    for (let i = 0; i < FLICKER_WAVE_SAMPLES; i++) waveform.push(wave.body[2 * i] | (wave.body[2 * i + 1] << 8));
    const reading: FlickerReading = {
      frequencyHz: readFloat32LE(stats.body, 2),
      percentFlicker: readFloat32LE(stats.body, 6),
      flickerIndex: readFloat32LE(stats.body, 10),
      cycleMs: readFloat32LE(stats.body, 14),
      spanMs,
      sampleIdx,
      gear,
      waveform,
    };
    log(`Flicker capture OK in ${((Date.now() - t0) / 1000).toFixed(1)}s: ${reading.frequencyHz.toFixed(1)} Hz, ${reading.percentFlicker.toFixed(1)} %`);
    return reading;
  } catch (e: any) {
    log(`Flicker capture failed: ${e?.message ?? e}`);
    return null;
  } finally {
    if (started) {
      // Leave the meter out of flicker mode, and let the stop settle before the next command.
      await sendStopReliably(conn, log).catch(() => {});
      await sleep(350);
    }
  }
}

/** Continuous flicker. onReading fires per refresh; onEnd fires exactly once. */
export function startFlicker(
  conn: MeterConnection,
  log: LogFn,
  onReading: (r: FlickerReading) => void,
  onEnd: (err?: Error) => void
): LiveSession {
  let stopped = false;
  let ended = false;
  const stopLagMonitor = startLagMonitor(log);
  conn.setCompactNotifyLog(true);
  const end = (err?: Error) => {
    if (ended) return;
    ended = true;
    stopLagMonitor();
    conn.setCompactNotifyLog(false);
    onEnd(err);
  };
  const isStopped = () => stopped;

  const done = (async () => {
    try {
      conn.resetReassemblyState();
      const t0 = Date.now();
      const since = () => `+${((Date.now() - t0) / 1000).toFixed(1)}s`;
      const hex = (b: Uint8Array, n = 24) =>
        Array.from(b.slice(0, n)).map((x) => x.toString(16).padStart(2, '0')).join(' ') + (b.length > n ? ` ...(${b.length}B)` : '');
      try {
        const bat = await conn.readBattery(1200);
        log(`Flicker: battery before start: ${bat ? JSON.stringify(bat) : 'no reply'}`);
      } catch {
        // diagnostic only
      }
      // Sample-rate setting -> how much time the plotted waveform covers (lets the chart label its time axis).
      let gearIdx: number | undefined;
      let spanMs: number | undefined;
      const rate = await request(conn, CMD_FLICKER_SAMPLE_RATE, 0x3d, 1500, 2, () => true, isStopped, log);
      const rateIdx = rate && rate.body.length >= 3 ? fromBcd(rate.body[2]) : -1;
      if (rateIdx >= 0 && rateIdx < FLICKER_SPAN_MS.length) {
        spanMs = FLICKER_SPAN_MS[rateIdx];
        log(`Flicker: sample-rate index ${rateIdx} (byte 0x${rate!.body[2].toString(16)}) -> waveform spans ${spanMs} ms`);
      } else {
        log('Flicker: could not read the sample rate; time axis will use sample numbers');
      }
      // Range (gear) too, for the chart header. One quick try: it's display-only.
      const gearReply = await request(conn, [0x8c, 0x36], 0x36, 800, 1, () => true, isStopped, log);
      if (gearReply && gearReply.body.length >= 3) gearIdx = fromBcd(gearReply.body[2]);
      if (stopped) {
        end();
        return;
      }
      log('Flicker: starting (8C 0E 04)');
      await conn.sendCommand(CMD_START_FLICKER_CONTINUOUS);
      await sleep(200);

      // 1. Wait until the meter says a capture is ready (8C 3B 01).
      const readyDeadline = Date.now() + 20000;
      let ready = false;
      while (!stopped && !ready) {
        if (Date.now() > readyDeadline) throw new Error('The meter never reported a flicker capture ready.');
        const m = await request(conn, CMD_FLICKER_READY, 0x3b, 600, 1, () => true, isStopped, log);
        if (m && m.body[2] === 0x01) {
          ready = true;
          log(`Flicker: capture ready ${since()}`);
        }
        else await sleep(150);
      }

      // 2. Loop: stats then waveform, as fast as the meter answers.
      let failures = 0;
      let cycle = 0;
      while (!stopped) {
        const tCycle = Date.now();
        const stats = await request(conn, CMD_FLICKER_STATS, 0x3c, FLICKER_STATS_TIMEOUT_MS, 2, (m) => m.body.length >= 18, isStopped, log);
        const tStats = Date.now();
        if (stopped) break;
        const wave = stats
          ? await request(conn, CMD_FLICKER_WAVE, 0x3a, FLICKER_WAVE_TIMEOUT_MS, 2, (m) => m.body.length >= FLICKER_WAVE_SAMPLES * 2, isStopped, log)
          : null;
        if (stopped) break;
        if (!stats || !wave) {
          failures += 1;
          log(
            `Flicker: incomplete cycle after ${cycle} good cycles ${since()} (stats ${stats ? 'ok' : 'missing'} in ${tStats - tCycle}ms, waveform ${wave ? 'ok' : 'missing'}; link ${conn.isConnected() ? 'still up' : 'DOWN'})`
          );
          log(`Flicker: link check after failure: ${await conn.diagnoseLink()}`, true);
          conn.resetReassemblyState();
          if (failures >= 3) throw new Error('The meter stopped answering flicker requests.');
          continue;
        }
        failures = 0;
        cycle += 1;
        const tWave = Date.now();
        // Verbose: every cycle, with latencies. Standard log: one line per 10 cycles so a stall shows when the last good one was.
        log(
          `Flicker cycle ${cycle} ${since()}: stats ${tStats - tCycle}ms, waveform ${tWave - tStats}ms, stats bytes [${hex(stats.body, 18)}], wave ${wave.body.length}B [${hex(wave.body, 8)}]`,
          true
        );
        if (cycle % 10 === 0) log(`Flicker: ${cycle} cycles OK ${since()}`);
        const waveform: number[] = [];
        for (let i = 0; i < FLICKER_WAVE_SAMPLES; i++) waveform.push(wave.body[2 * i] | (wave.body[2 * i + 1] << 8));
        const reading: FlickerReading = {
          frequencyHz: readFloat32LE(stats.body, 2),
          percentFlicker: readFloat32LE(stats.body, 6),
          flickerIndex: readFloat32LE(stats.body, 10),
          cycleMs: readFloat32LE(stats.body, 14),
          spanMs,
          sampleIdx: rateIdx >= 0 && rateIdx < FLICKER_SPAN_MS.length ? rateIdx : undefined,
          gear: gearIdx,
          waveform,
        };
        if (!stopped) onReading(reading);
        // Slow, steady pace: the meter locked up (and powered off) when hammered with back-to-back requests.
        await sleep(FLICKER_CYCLE_GAP_MS);
      }
      log(`Flicker: loop ended (stopped by user) after ${cycle} cycles ${since()}`);
      end();
    } catch (e: any) {
      stopped = true;
      log(`Flicker: ended with error: ${e?.message ?? e}`);
      sendStopReliably(conn, log);
      end(e instanceof Error ? e : new Error(String(e)));
    }
  })();

  return {
    done,
    stop: async () => {
      if (stopped) return;
      stopped = true;
      log('Flicker: Stop tapped');
      end();
      // Fire and forget: the UI must never wait on a Bluetooth write (a stuck write used to hold up Disconnect).
      sendStopReliably(conn, log).catch(() => {});
    },
  };
}

/** Stock-app risk bands (FlickGrid): "No Risk" / "Low Risk" / "High Risk" from frequency and percent flicker. */
export function flickerRisk(freqHz: number, percent: number): 'none' | 'low' | 'high' {
  let high: number;
  let low: number;
  if (freqHz <= 8) {
    high = 0.2;
    low = 0.1;
  } else if (freqHz <= 90) {
    high = 0.025 * freqHz;
    low = high / 2.5;
  } else {
    high = 0.08 * freqHz;
    low = 0.0333 * freqHz;
  }
  return percent <= low ? 'none' : percent <= high ? 'low' : 'high';
}
