// src/ble/takeMeasurement.ts
//
// The measurement completion-detection algorithm (protocol spec §4), ported
// from the ESP32 firmware. This is the least obvious part of the whole
// protocol -- a naive fixed-delay-then-read approach produces structurally
// valid but garbage data (near-zero signal regardless of lighting).
//
// Correct approach: after starting a test, poll integration time (8C 05)
// until it's stable across two consecutive polls AND the sampling state
// (8C 03) confirms teststate == 0x01. Only then read the result (8C 13 31).

import { MeterConnection, MeterMessage } from './MeterConnection';
import {
  CMD_IDENTIFY,
  CMD_SET_INTEGRAL_MODE_AUTO,
  CMD_READ_STATE,
  CMD_READ_INTEG_TIME,
  CMD_START_SINGLE_TEST,
  CMD_READ_RESULT,
  CMD_STOP_SAMPLING,
  POLL_INTERVAL_MS,
  MEASUREMENT_TIMEOUT_MS,
  STATE_REPLY_TESTSTATE_OFFSET,
  STATE_TEST_END,
} from './protocol';
import { parseResult, MeterResult } from './parseResult';

export type LogFn = (msg: string) => void;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Call once, right after connecting, before the first measurement. */
export async function initializeMeter(conn: MeterConnection): Promise<void> {
  await conn.sendCommand(CMD_IDENTIFY);
  await sleep(100);
  await conn.sendCommand(CMD_SET_INTEGRAL_MODE_AUTO);
}

/**
 * Triggers a single measurement and resolves with the parsed result once the
 * meter has genuinely finished (not just looked stable for one poll).
 */
export async function takeMeasurement(
  conn: MeterConnection,
  log: LogFn = () => {}
): Promise<MeterResult> {
  // Defensive: clear any stray in-flight reassembly state from previous
  // churn before starting. A late-arriving response from earlier polling
  // should never bleed into this measurement.
  conn.resetReassemblyState();

  let lastIntegTime: number | null = null;
  let stableCandidateSeen = false;
  let resolved = false;

  return new Promise<MeterResult>((resolve, reject) => {
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        cleanup();
        reject(new Error('Measurement timed out (20s) -- check lighting / connection'));
      }
    }, MEASUREMENT_TIMEOUT_MS);

    const unsubscribe = conn.onMessage(handleMessage);

    function cleanup() {
      clearTimeout(timeout);
      unsubscribe();
    }

    function handleMessage(msg: MeterMessage) {
      if (resolved) return;

      if (msg.subCommand === 0x05) {
        // 7-byte reply: 8C 05 <4-byte LE µs> <mode byte>. Body here still
        // includes the 8C 05 prefix since short replies aren't header-
        // stripped by MeterConnection.
        const view = new DataView(msg.body.buffer, msg.body.byteOffset, msg.body.byteLength);
        const integTimeUs = view.getUint32(2, true);

        if (lastIntegTime !== null && lastIntegTime === integTimeUs) {
          stableCandidateSeen = true;
          log(`Integration time stable at ${integTimeUs}us -- confirming with state check`);
          conn.sendCommand(CMD_READ_STATE).catch((e) => log(`state check failed: ${e}`));
        } else {
          stableCandidateSeen = false;
        }
        lastIntegTime = integTimeUs;
      }

      if (msg.subCommand === 0x03 && stableCandidateSeen) {
        const testState = msg.body[STATE_REPLY_TESTSTATE_OFFSET];
        if (testState === STATE_TEST_END) {
          log('Confirmed test end -- reading result');
          resolved = true;
          cleanup();
          conn
            .sendCommand(CMD_READ_RESULT)
            .catch((e) => {
              resolved = false;
              reject(e);
            });
        } else {
          log('State check says still testing despite stable integ time -- resuming poll');
          stableCandidateSeen = false;
        }
      }

      if (msg.subCommand === 0x13) {
        if (resolved && msg.body.length > 0) {
          conn.sendCommand(CMD_STOP_SAMPLING).catch(() => {});
          try {
            const result = parseResult(msg.body);
            resolve(result);
          } catch (e) {
            reject(e);
          }
        }
      }
    }

    (async () => {
      try {
        await conn.sendCommand(CMD_START_SINGLE_TEST);
        while (!resolved) {
          await conn.sendCommand(CMD_READ_INTEG_TIME);
          await sleep(POLL_INTERVAL_MS);
        }
      } catch (e) {
        if (!resolved) {
          resolved = true;
          cleanup();
          reject(e);
        }
      }
    })();
  });
}
