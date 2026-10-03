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
  /** Capped at the last 100 lines -- see appendLog below. */
  log: string[];
  /** `verbose` lines (BLE hex dumps, raw result bodies) are dropped unless the Settings "Verbose logging" toggle is on -- see refreshVerboseLogging. */
  appendLog: (msg: string, verbose?: boolean) => void;
  /** Empties the in-memory log shown on the Logs tab -- never persisted, so this just clears what's currently on screen. */
  clearLog: () => void;
  /** Re-reads the Verbose Logging preference from storage -- call this on screen focus (same reasoning as cachedUsername/statIds elsewhere) so a toggle flipped in Settings takes effect without an app restart. */
  refreshVerboseLogging: () => void;
}

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
    setLog((prev) => [...prev.slice(-99), `${timestampPrefix()}  ${msg}`]);
  }, []);

  const clearLog = useCallback(() => setLog([]), []);

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
