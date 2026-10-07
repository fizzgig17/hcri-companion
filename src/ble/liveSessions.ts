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
      onEnd();
    } catch (e: any) {
      stopped = true;
      conn.sendCommand(CMD_STOP_SAMPLING).catch(() => {});
      onEnd(e instanceof Error ? e : new Error(String(e)));
    }
  })();

  return {
    done,
    stop: async () => {
      if (stopped) return;
      stopped = true;
      try {
        await conn.sendCommand(CMD_STOP_SAMPLING);
      } catch (e: any) {
        log(`Stop failed: ${e?.message ?? e}`);
      }
      await done.catch(() => {});
    },
  };
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
  const isStopped = () => stopped;

  const done = (async () => {
    try {
      conn.resetReassemblyState();
      await conn.sendCommand(CMD_START_FLICKER_CONTINUOUS);

      // 1. Wait until the meter says a capture is ready (8C 3B 01).
      const readyDeadline = Date.now() + 20000;
      let ready = false;
      while (!stopped && !ready) {
        if (Date.now() > readyDeadline) throw new Error('The meter never reported a flicker capture ready.');
        const m = await request(conn, CMD_FLICKER_READY, 0x3b, 600, 1, () => true, isStopped, log);
        if (m && m.body[2] === 0x01) ready = true;
        else await sleep(150);
      }

      // 2. Loop: stats then waveform, as fast as the meter answers.
      let failures = 0;
      while (!stopped) {
        const stats = await request(conn, CMD_FLICKER_STATS, 0x3c, 2500, 2, (m) => m.body.length >= 18, isStopped, log);
        if (stopped) break;
        const wave = stats
          ? await request(conn, CMD_FLICKER_WAVE, 0x3a, 4000, 2, (m) => m.body.length >= FLICKER_WAVE_SAMPLES * 2, isStopped, log)
          : null;
        if (stopped) break;
        if (!stats || !wave) {
          failures += 1;
          conn.resetReassemblyState();
          if (failures >= 3) throw new Error('The meter stopped answering flicker requests.');
          continue;
        }
        failures = 0;
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
      }
      onEnd();
    } catch (e: any) {
      stopped = true;
      conn.sendCommand(CMD_STOP_SAMPLING).catch(() => {});
      onEnd(e instanceof Error ? e : new Error(String(e)));
    }
  })();

  return {
    done,
    stop: async () => {
      if (stopped) return;
      stopped = true;
      try {
        await conn.sendCommand(CMD_STOP_SAMPLING);
      } catch (e: any) {
        log(`Stop failed: ${e?.message ?? e}`);
      }
      await done.catch(() => {});
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
