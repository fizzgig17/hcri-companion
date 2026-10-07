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
    try {
      while (!stopped) {
        try {
          const r = await takeMeasurement(conn, log, {
            startCommand: first ? CMD_START_CONTINUOUS_TEST : null,
            sendStop: false,
            shouldAbort,
          });
          first = false;
          failures = 0;
          if (!stopped) onResult(r);
          // Small breather so a still-"test end" state from the previous cycle isn't re-read instantly.
          await sleep(120);
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
      await sendStopReliably(conn, log);
    },
  };
}

/** Sends 8C 25 now and once more shortly after (a single write can be lost or land mid-reply), and clears any half-reassembled reply. */
async function sendStopReliably(conn: MeterConnection, log: LogFn): Promise<void> {
  try {
    await conn.sendCommand(CMD_STOP_SAMPLING);
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
    const waiting = waitForMessage(conn, sub, timeoutMs, accept, isStopped);
    await conn.sendCommand(cmd);
    const m = await waiting;
    if (m) return m;
    if (!isStopped()) log(`No reply to ${cmd.map((b) => b.toString(16).padStart(2, '0')).join(' ')} (try ${i + 1}/${tries})`);
  }
  return null;
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
  const end = (err?: Error) => {
    if (ended) return;
    ended = true;
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
        const stats = await request(conn, CMD_FLICKER_STATS, 0x3c, 2500, 2, (m) => m.body.length >= 18, isStopped, log);
        const tStats = Date.now();
        if (stopped) break;
        const wave = stats
          ? await request(conn, CMD_FLICKER_WAVE, 0x3a, 4000, 2, (m) => m.body.length >= FLICKER_WAVE_SAMPLES * 2, isStopped, log)
          : null;
        if (stopped) break;
        if (!stats || !wave) {
          failures += 1;
          log(
            `Flicker: incomplete cycle after ${cycle} good cycles ${since()} (stats ${stats ? 'ok' : 'missing'} in ${tStats - tCycle}ms, waveform ${wave ? 'ok' : 'missing'}; link ${conn.isConnected() ? 'still up' : 'DOWN'})`
          );
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
          waveform,
        };
        if (!stopped) onReading(reading);
        // Brief gap so the meter isn't hit with the next request the instant a 800-byte reply finishes.
        await sleep(80);
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
      await sendStopReliably(conn, log);
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
