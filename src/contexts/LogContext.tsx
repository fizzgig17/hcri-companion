// src/contexts/LogContext.tsx
//
// The in-memory debug log (Logs tab, Share Debug Log) used to live as
// local state inside HomeScreen -- fine while every screen that could add
// to it (Main's connect/measure, Data's upload, History's upload) was a
// panel inside Home. Now that History is its own top-level tab (sibling
// of Home, not nested inside it -- see App.tsx), its uploads need to be
// able to append to the SAME log Home's Logs tab shows, which means the
// log itself has to live somewhere both screens can reach: here, same
// spirit as ThemeContext.

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { loadVerboseLoggingPreference } from '../storage/preferences';

interface LogContextValue {
  /** Capped at the last 100 lines (3000 with Verbose logging on) -- see appendLog below. */
  log: string[];
  /** `verbose` lines (BLE hex dumps, raw result bodies) are dropped unless the Settings "Verbose logging" toggle is on -- see refreshVerboseLogging. */
  appendLog: (msg: string, verbose?: boolean) => void;
  /** Empties the in-memory log shown on the Logs tab -- never persisted, so this just clears what's currently on screen. */
  clearLog: () => void;
  /** Re-reads the Verbose Logging preference from storage -- call this on screen focus (same reasoning as cachedUsername/statIds elsewhere) so a toggle flipped in Settings takes effect without an app restart. */
  refreshVerboseLogging: () => void;
}

// Standard log keeps the last 100 lines; Verbose logging (BLE traffic, per-cycle timings) keeps far more,
// since a freeze has to be seen together with the minutes of traffic leading up to it.
const STANDARD_LOG_LINES = 100;
const VERBOSE_LOG_LINES = 3000;

const LogContext = createContext<LogContextValue | null>(null);

/**
 * Same shape as adb logcat's own timestamp (MM-DD HH:mm:ss.SSS), not just
 * "a" timestamp -- deliberately, so a line in this log can be matched
 * straight across to a logcat capture covering the same moment (exactly
 * what the "flash open then crash" investigation needed, lining up this
 * log against a crash-buffer dump) without translating between two
 * different formats first. Uses `Date`'s own local getters, same as
 * logcat does, so this reads in the phone's own timezone -- not
 * toISOString()'s UTC.
 */
function timestampPrefix(): string {
  const d = new Date();
  const pad = (n: number, len = 2) => String(n).padStart(len, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(
    d.getSeconds()
  )}.${pad(d.getMilliseconds(), 3)}`;
}

export function LogProvider({ children }: { children: React.ReactNode }) {
  const [log, setLog] = useState<string[]>([]);
  // A ref, not state: appendLog is called at BLE wire-traffic frequency and
  // is deliberately kept at a stable identity (empty useCallback deps)
  // so it never forces callers' own getConnection/MeterConnection to be
  // recreated; reading a ref lets this setting apply live without
  // appendLog needing to depend on it.
  const verboseLoggingRef = useRef(false);
  const pendingRef = useRef<{ ts: string; msg: string }[]>([]);
  // The authoritative log lines (state below is a copy handed to the UI), plus the last line for collapsing repeats.
  const logRef = useRef<string[]>([]);
  const lastRef = useRef<{ msg: string; ts: string; count: number } | null>(null);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refreshVerboseLogging = useCallback(() => {
    loadVerboseLoggingPreference()
      .then((enabled) => {
        verboseLoggingRef.current = enabled;
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    refreshVerboseLogging();
  }, [refreshVerboseLogging]);

  const appendLog = useCallback((msg: string, verbose?: boolean) => {
    // Also mirror to console.log -- React Native forwards this straight to
    // the Metro terminal on the PC whenever the app is connected in debug
    // mode, so you can copy/paste log lines from there without needing to
    // screen-mirror or copy text off the phone itself. Deliberately
    // unfiltered: Metro is a developer-only audience that already sees
    // everything regardless of this app's own Verbose Logging setting.
    // Verbose lines are skipped entirely (console too) while Verbose Logging is off: during Live
    // mode there are dozens per second and formatting/forwarding them starves the JS thread.
    if (verbose && !verboseLoggingRef.current) return;
    console.log(`[meter] ${msg}`);
    // The Logs tab / Share Debug Log, on the other hand, is what the
    // Verbose Logging setting actually controls -- a verbose-flagged line
    // only gets added here, and so only shows up on-screen or in a shared
    // report, once that setting is on. Off by default (see preferences.ts).
    if (verbose && !verboseLoggingRef.current) return;
    // Timestamped here, not by each caller -- one place stamps every line
    // that ever lands in this log (connect/disconnect, measure, upload,
    // the AppState foreground/background transitions, CrashReporter's own
    // folded-in record, everything), so nothing can land untimestamped by
    // a caller forgetting to.
    // Lines are buffered and flushed at most ~3x/second: every setLog re-renders everything that
    // reads the log, and at BLE wire frequency (Live polling) that made taps on Stop/Disconnect
    // get lost behind a wall of re-renders.
    pendingRef.current.push({ ts: timestampPrefix(), msg });
    if (!flushTimerRef.current) {
      flushTimerRef.current = setTimeout(() => {
        flushTimerRef.current = null;
        const batch = pendingRef.current;
        pendingRef.current = [];
        const verboseOn = verboseLoggingRef.current;
        const lines = logRef.current;
        for (const { ts, msg: m } of batch) {
          // Verbose only: a run of identical lines (e.g. 95 polls of "-> write (2B): 8c 05")
          // collapses into one line, so polling can't push the useful lines out of the cap.
          if (verboseOn && lastRef.current && lastRef.current.msg === m) {
            lastRef.current.count += 1;
            lines[lines.length - 1] = `${lastRef.current.ts}  ${m}  [x${lastRef.current.count}, last at ${ts.slice(6)}]`;
            continue;
          }
          lastRef.current = { msg: m, ts, count: 1 };
          lines.push(`${ts}  ${m}`);
        }
        const cap = verboseOn ? VERBOSE_LOG_LINES : STANDARD_LOG_LINES;
        if (lines.length > cap) lines.splice(0, lines.length - cap);
        setLog(lines.slice());
      }, 300);
    }
  }, []);

  const clearLog = useCallback(() => {
    pendingRef.current = [];
    logRef.current = [];
    lastRef.current = null;
    setLog([]);
  }, []);

  const value = useMemo<LogContextValue>(
    () => ({ log, appendLog, clearLog, refreshVerboseLogging }),
    [log, appendLog, clearLog, refreshVerboseLogging]
  );

  return <LogContext.Provider value={value}>{children}</LogContext.Provider>;
}

export function useLog(): LogContextValue {
  const ctx = useContext(LogContext);
  if (!ctx) {
    throw new Error('useLog() called outside <LogProvider> -- see App.tsx for where it should wrap the app.');
  }
  return ctx;
}
