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
  getFieldOffsetsForDevice,
} from './protocol';
import { parseResult, peekFirmwareVersion, MeterResult } from './parseResult';

// See MeterConnection.ts's LogFn for what the `verbose` flag means -- same
// type, duplicated here rather than imported since this file already takes
// its own `log` parameter independent of any MeterConnection instance.
export type LogFn = (msg: string, verbose?: boolean) => void;

// See the fallback-completion comment inside takeMeasurement() for what
// these gate. MIN_SETTLE is a small buffer against acting on a single
// coincidentally-repeated 8C 05 value before it's genuinely locked in;
// SAFETY_MARGIN is added on top of the meter's own reported exposure
// duration since real hardware timing is never exact.
const FALLBACK_MIN_SETTLE_MS = 300;
const FALLBACK_SAFETY_MARGIN_MS = 400;

// Confirmed 2026-09-28 (log 68afc475): even after 8C 03 genuinely confirms
// "test end", the follow-up 8C 13 31 (read result) request occasionally gets
// ZERO reply on the BLE link -- not slow, not partial, just nothing -- for
// no apparent reason, while an immediate resend (same connection, nothing
// else changed) reliably works. Rather than let that eat the full 20s
// MEASUREMENT_TIMEOUT_MS every time it happens, resend 8C 13 31 a few times
// on a much shorter interval before ever letting it get that far.
const RESULT_RETRY_INTERVAL_MS = 3000;
const RESULT_MAX_RETRIES = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Renders bytes as space-separated hex pairs, with a running byte-offset marker every 16 bytes so you can quickly count into the dump to find a given field offset. */
function hexDump(bytes: Uint8Array): string {
  const lines: string[] = [];
  for (let i = 0; i < bytes.length; i += 16) {
    const chunk = Array.from(bytes.slice(i, i + 16))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join(' ');
    lines.push(`[${i.toString().padStart(4, '0')}] ${chunk}`);
  }
  return '\n' + lines.join('\n');
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
  // When integ time first stabilized, and at what value -- used by the
  // elapsed-time fallback below, since 8C 03 has been confirmed (via
  // wire-level logging on a real HPCS-330P, 2026-09-27) to never get a
  // reply at all on this firmware, on ANY of its exposed characteristics.
  let stableIntegTimeUs: number | null = null;
  let stableDetectedAt: number | null = null;
  const testStartedAt = Date.now();

  // Two separate states, deliberately kept apart:
  //   - pollingDone:  the completion check succeeded and we've sent the
  //     "read result" command. Stop polling 8C 05/8C 03, but KEEP the
  //     message listener alive -- the actual 8C 13 result hasn't arrived
  //     yet, and it's the only thing still using that listener.
  //   - settled: the promise has actually resolved or rejected. ONLY at
  //     this point is it safe to unsubscribe/clear the timeout.
  //
  // The previous version conflated these into one "resolved" flag and
  // unsubscribed as soon as the completion check passed -- which tore down
  // the listener before the real result notification ever arrived, so the
  // measurement hung forever waiting for a message nothing was listening
  // for anymore (and the timeout had already been cleared too, so it never
  // even timed out).
  let pollingDone = false;
  let settled = false;
  // How many times CMD_READ_RESULT has been (re)sent for this measurement.
  // Guards RESULT_MAX_RETRIES and also makes the retry timer idempotent --
  // see requestResult() below.
  let resultRequestCount = 0;
  let resultRetryTimer: ReturnType<typeof setTimeout> | null = null;

  return new Promise<MeterResult>((resolve, reject) => {
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        cleanup();
        reject(
          new Error(`Measurement timed out (${MEASUREMENT_TIMEOUT_MS / 1000}s) -- check lighting / connection`)
        );
      }
    }, MEASUREMENT_TIMEOUT_MS);

    const unsubscribe = conn.onMessage(handleMessage);

    function cleanup() {
      clearTimeout(timeout);
      if (resultRetryTimer) {
        clearTimeout(resultRetryTimer);
        resultRetryTimer = null;
      }
      unsubscribe();
    }

    // Sends CMD_READ_RESULT and arms a short retry timer. If the 0x13 handler
    // below hasn't settled the promise by the time the timer fires, the link
    // silently ate the request (or its reply) -- resend rather than sit out
    // the full 20s MEASUREMENT_TIMEOUT_MS waiting on a reply that, per the
    // 2026-09-28 log, sometimes just never comes. Calling this again from the
    // 0x13 handler's retry path re-arms the same timer, so a second dropped
    // reply gets a second retry, up to RESULT_MAX_RETRIES total sends.
    function requestResult() {
      resultRequestCount += 1;
      if (resultRetryTimer) {
        clearTimeout(resultRetryTimer);
        resultRetryTimer = null;
      }
      // Confirmed 2026-10-02 (a debug-report capture from a "no chart"
      // report): a retry here used to leave MeterConnection's reassembly
      // state exactly as the dead previous attempt left it. If that
      // previous attempt's 8C 13 reply never fully arrived (collecting
      // still true, buffer sitting at some partial length < the declared
      // total -- which is WHY it never resolved and this retry is firing
      // at all), the resend's brand-new reply then got appended onto that
      // stale partial buffer instead of starting fresh, since
      // handleNotification's "is this the start of a new response"
      // branch only runs when `collecting` is false. Once the combined
      // length happened to reach the declared total, it got emitted as
      // if it were one genuine reply -- a splice of the old attempt's
      // leftover bytes followed by the new attempt's reply (including
      // that reply's own 4-byte echo+length header, never stripped,
      // misread as body data). Every field offset past the splice point
      // is garbage. Clearing reassembly state before EVERY request
      // (first send and every retry alike), not just once at the top of
      // takeMeasurement(), means a resend always starts a clean
      // collection and can never be glued onto a dead one.
      conn.resetReassemblyState();
      conn.sendCommand(CMD_READ_RESULT).catch((e) => {
        if (!settled) {
          settled = true;
          cleanup();
          reject(e);
        }
      });
      if (resultRequestCount < RESULT_MAX_RETRIES) {
        resultRetryTimer = setTimeout(() => {
          if (settled) return;
          log(
            `No reply to 8C 13 31 after ${RESULT_RETRY_INTERVAL_MS}ms (attempt ${resultRequestCount}/${RESULT_MAX_RETRIES}) -- resending`
          );
          requestResult();
        }, RESULT_RETRY_INTERVAL_MS);
      }
    }

    function handleMessage(msg: MeterMessage) {
      if (settled) return;

      if (msg.subCommand === 0x05 && !pollingDone) {
        // 7-byte reply: 8C 05 <4-byte LE µs> <mode byte>. Body here still
        // includes the 8C 05 prefix since short replies aren't header-
        // stripped by MeterConnection.
        //
        // Crash seen 2026-09-28: "DataView.prototype.getUint32(): Cannot
        // read that many bytes" -- msg.body arrived shorter than the 6
        // bytes getUint32(2, ...) needs (offset 2 + 4 bytes), so this was
        // reading past the end of a truncated/malformed notification and
        // taking the whole app down with an uncaught error. Whatever wire-
        // level hiccup produced a too-short "0x05" body (a genuine radio
        // glitch, a corrupted single notification, something else entirely
        // arriving on this characteristic) shouldn't be able to crash the
        // app -- log it and ignore that one notification instead; the poll
        // loop will just try again on the next 150ms tick like normal.
        if (msg.body.byteLength < 6) {
          log(
            `Ignoring malformed 8C 05 reply: only ${msg.body.byteLength} byte(s), needed at least 6 -- ${Array.from(
              msg.body
            )
              .map((b) => b.toString(16).padStart(2, '0'))
              .join(' ')}`
          );
          return;
        }
        const view = new DataView(msg.body.buffer, msg.body.byteOffset, msg.body.byteLength);
        const integTimeUs = view.getUint32(2, true);

        if (lastIntegTime !== null && lastIntegTime === integTimeUs) {
          if (!stableCandidateSeen) {
            stableIntegTimeUs = integTimeUs;
            stableDetectedAt = Date.now();
          }
          stableCandidateSeen = true;
          log(`Integration time stable at ${integTimeUs}us -- confirming with state check`);
          // Still worth sending -- if a future firmware/model DOES answer
          // this, the 0x03 handler below wins the race harmlessly (both
          // paths are guarded by !pollingDone). It's just no longer the
          // ONLY path to completion.
          conn.sendCommand(CMD_READ_STATE).catch((e) => log(`state check failed: ${e}`));
        } else {
          stableCandidateSeen = false;
          stableIntegTimeUs = null;
          stableDetectedAt = null;
        }
        lastIntegTime = integTimeUs;

        // Fallback completion signal, kept as a safety net even though the
        // 2026-09-27 claim that prompted it ("this firmware never replies to
        // 8C 03 at all") turned out to be wrong -- see STATE_REPLY_TESTSTATE_OFFSET's
        // comment in protocol.ts: that investigation was almost certainly
        // looking at the right reply at the wrong byte offset, not an
        // absent reply. With the offset fixed, a genuine 8C 03 confirmation
        // should arrive and resolve things via the 0x03 branch below well
        // before this fallback's own wait is up. Left in place regardless,
        // in case some unit/firmware revision really does drop 8C 03: once
        // integ time looks stable, require BOTH a small settle buffer since
        // stability was first seen AND that enough real wall-clock time has
        // passed since the test started to cover one full exposure at the
        // settled integration time, plus a safety margin -- then read the
        // result directly rather than waiting out the full
        // MEASUREMENT_TIMEOUT_MS on a confirmation that may not come.
        if (!pollingDone && stableCandidateSeen && stableIntegTimeUs !== null && stableDetectedAt !== null) {
          const now = Date.now();
          const requiredSinceStart = stableIntegTimeUs / 1000 + FALLBACK_SAFETY_MARGIN_MS;
          const settledLongEnough = now - stableDetectedAt >= FALLBACK_MIN_SETTLE_MS;
          const exposureLikelyComplete = now - testStartedAt >= requiredSinceStart;
          if (settledLongEnough && exposureLikelyComplete) {
            log(
              `No 8C 03 reply after ${now - testStartedAt}ms (needed >= ${Math.round(
                requiredSinceStart
              )}ms for a ${stableIntegTimeUs}us exposure) -- reading result directly instead of waiting on a confirmation that isn't coming`
            );
            pollingDone = true; // stop polling, but keep listening for 8C 13
            requestResult();
          }
        }
      }

      if (msg.subCommand === 0x03 && stableCandidateSeen && !pollingDone) {
        // Same class of issue as the 0x05 guard above -- a plain array
        // index on a too-short Uint8Array doesn't throw (it's just
        // `undefined`), so this wouldn't have crashed, but it *would* have
        // silently fallen into "still testing, resuming poll" below with no
        // indication anything was actually wrong with the reply itself.
        // Logging it explicitly here instead makes a malformed 8C 03 reply
        // show up clearly in the Logs tab rather than looking like an
        // ordinary "not done yet" state.
        //
        // NOTE on STATE_REPLY_TESTSTATE_OFFSET itself: a 2026-10-04 debug
        // capture was briefly misread as proof this needed a +2 (echo
        // length) adjustment -- a single 8C 03 reply showed 0x01 at that
        // adjusted offset where STATE_TEST_END was expected. Don't trust
        // that: the SAME capture showed all 16 polled 8C 03 replies as
        // byte-for-byte IDENTICAL over 3 seconds, including that 0x01 --
        // the measurement never actually completed in that capture (it hit
        // the overall timeout), so there's no confirmed example of what a
        // genuine completion reply looks like at either offset, and that
        // 0x01 is just as likely a static/mode byte as a real flag. Left
        // as originally authored (offset 3, unstripped) until a capture
        // that spans an ACTUAL test-end transition settles this for real.
        if (msg.body.byteLength <= STATE_REPLY_TESTSTATE_OFFSET) {
          log(
            `Ignoring malformed 8C 03 reply: only ${msg.body.byteLength} byte(s), needed at least ${
              STATE_REPLY_TESTSTATE_OFFSET + 1
            }`
          );
          return;
        }
        const testState = msg.body[STATE_REPLY_TESTSTATE_OFFSET];
        if (testState === STATE_TEST_END) {
          log('Confirmed test end -- reading result');
          pollingDone = true; // stop polling, but keep listening for 8C 13
          requestResult();
        } else {
          // Confirmed 2026-10-04: this used to also reset stableCandidateSeen
          // to false here, which looked harmless (just "go back to polling")
          // but actually broke the elapsed-time fallback below completely.
          // Clearing it makes the NEXT 8C 05 poll treat an integ time that
          // was already stable as newly stabilizing again, re-stamping
          // stableDetectedAt to "now" -- and since a full 8C 05-then-8C 03
          // round trip (~150-215ms, per that capture) is faster than
          // FALLBACK_MIN_SETTLE_MS (300ms), stableDetectedAt never gets the
          // chance to age past that threshold. Every "still testing" reply
          // perpetually deferred the fallback instead of just leaving it
          // alone to keep accumulating settled time -- so as long as 8C 03
          // kept replying at all (even with a perfectly accurate "still
          // testing"), the fallback could never fire either, and the only
          // way out was the full MEASUREMENT_TIMEOUT_MS. Just log and keep
          // polling -- stableCandidateSeen (and stableDetectedAt with it)
          // should only change when the INTEG TIME ITSELF changes (see the
          // 0x05 handler above), not in response to a state check's answer.
          log('State check says still testing despite stable integ time -- resuming poll');
        }
      }

      if (msg.subCommand === 0x13) {
        if (pollingDone && msg.body.length > 0) {
          conn.sendCommand(CMD_STOP_SAMPLING).catch(() => {});
          settled = true;
          cleanup();

          // Temporary diagnostic: dump the raw result body as hex whenever
          // logging is enabled. This is how the original HPCS-330P protocol
          // was reverse-engineered in the first place, and it's the fastest
          // way to find correct field offsets for a new model that turns
          // out to have a different layout -- print the bytes, then compare
          // against what CCT/Lux/etc. SHOULD read for a known light source
          // to spot where the real values actually live. Safe to remove
          // once a model's offsets are confirmed and stable.
          //
          // Verbose-only: this is the full raw body, which includes every
          // wavelength's raw bytes (the "full wavelength list" the standard
          // log deliberately leaves out) alongside the header/metrics
          // fields -- long and rarely needed unless you're hunting a field
          // offset or a corrupted reply.
          log(`Raw result body (${msg.body.length} bytes): ${hexDump(msg.body)}`, true);

          try {
            // Peeking firmwareVersion straight from the raw body (rather
            // than waiting until after an offset map is already chosen)
            // is what lets the bare-310/330 firmware split below even be
            // possible -- see peekFirmwareVersion's own comment for why
            // reading it this way, before picking a map, is safe.
            const firmwareVersion = peekFirmwareVersion(msg.body);
            const offsets = getFieldOffsetsForDevice(conn.getDeviceName(), firmwareVersion);
            const result = parseResult(msg.body, offsets);
            resolve(result);
          } catch (e) {
            reject(e);
          }
        }
      }
    }

    (async () => {
      try {
        // Per-test re-arm attempts, tried and ruled out (2026-09-27) --
        // recorded here so this isn't tried again blind:
        //
        // Round 1: resend CMD_SET_INTEGRAL_MODE_AUTO (8C 02 01) before each
        // test (the only thing that had run just once, at connect). A
        // wire-level log confirmed it WAS being sent -- no difference:
        // session's first reading stayed genuine, every reading after it
        // stayed a byte-for-byte repeat of that first one.
        //
        // Round 2: resend the FULL connect handshake -- CMD_IDENTIFY then
        // CMD_SET_INTEGRAL_MODE_AUTO -- before each test, on the theory that
        // IDENTIFY (not just the auto-mode flag) was what actually arms a
        // fresh acquisition. This made things WORSE, not neutral: with
        // initializeMeter() already having run that same handshake once at
        // connect, doing it again with no real gap turned even the FIRST
        // reading of the session into near-all-zero data with a placeholder
        // timestamp (2000-01-01 17:05:12) -- not the genuine-then-stale
        // pattern every prior log showed, an empty/uninitialized-looking
        // result on every single reading including the first. Reverted back
        // out for that reason, not just because it didn't help.
        //
        // Round 3: a real disconnect + reconnect (same device, via its BLE
        // id) before every test, redoing the full connect handshake on a
        // genuinely fresh connection instead of an open one. Also ruled
        // out, and for a worse reason than rounds 1/2: on Android,
        // cancelling a BLE connection and immediately reconnecting isn't
        // reliable at the OS level -- the previous connection isn't always
        // fully released before the next connect attempt starts. In
        // practice this broke the FIRST reading of a session too (not just
        // the later ones), leaving the meter disconnected and the reading
        // never happening at all. Reverted back out.
        //
        // Net effect: nothing this app can do to the connection or the
        // handshake, before a test, has moved the needle -- every variant
        // either no-ops or actively breaks things that were working. Manual
        // reconnects between readings, or a genuinely different next
        // theory, are the paths left; touching this per-test sequence
        // further is not.
        await conn.sendCommand(CMD_START_SINGLE_TEST);
        while (!pollingDone && !settled) {
          await conn.sendCommand(CMD_READ_INTEG_TIME);
          await sleep(POLL_INTERVAL_MS);
        }
      } catch (e) {
        if (!settled) {
          settled = true;
          cleanup();
          reject(e);
        }
      }
    })();
  });
}
