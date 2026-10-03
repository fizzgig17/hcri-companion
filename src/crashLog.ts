// src/crashLog.ts
//
// Persists the last uncaught JS error (message + stack) to AsyncStorage
// the instant it happens, so it survives the crash and the next app
// launch can read it back -- built for the "click the app icon after not
// using it for a while, it flashes open then dies" report, which has no
// stack trace to go on yet and isn't reliably reproducible on demand (so
// catching it live with `adb logcat` means happening to be plugged in at
// exactly the wrong moment).
//
// IMPORTANT SCOPE LIMIT: this only sees uncaught JS exceptions that reach
// React Native's own ErrorUtils (an error thrown in an event handler, an
// async function, a timer -- anything outside render, which is also
// exactly what ErrorBoundary.tsx can't catch, since that only covers
// render-phase errors). It CANNOT see a true native-level crash (a Java/
// Kotlin exception on the Android side, a segfault, an OOM kill) --
// those terminate the process before any JS code, including this file,
// gets a chance to run. If the next occurrence of this bug shows up here
// with a real JS error, that confirms it's JS-level and this is the
// stack trace to act on; if it keeps happening but this stays empty,
// that itself is useful evidence pointing at a native-level cause
// instead, which would need `adb logcat` (or Android Vitals) to diagnose.
//
// Requires @react-native-async-storage/async-storage (already installed
// -- see preferences.ts).

import AsyncStorage from '@react-native-async-storage/async-storage';

const LAST_CRASH_KEY = 'hcri.io.lastCrash';

// Generous but bounded -- a full native stack can run long, and this only
// needs to be read once by a person, not stored forever.
const MAX_STACK_CHARS = 4000;

export interface CrashRecord {
  timestamp: string;
  isFatal: boolean;
  message: string;
  stack?: string;
}

let installed = false;

/**
 * Call once, as early as possible (index.js, before AppRegistry even
 * registers the app) -- a crash that happens during the very first render
 * needs this hooked up before that render starts, not after.
 */
export function installGlobalErrorHandler(): void {
  if (installed) return;
  installed = true;

  // globalThis, not `global` -- TS recognizes the former out of the box
  // (see MeterConnection.ts's own `declare global` workaround for why the
  // latter needs one here); this avoids needing that boilerplate for a
  // single untyped lookup.
  const g: any = globalThis as any;
  if (!g.ErrorUtils || typeof g.ErrorUtils.setGlobalHandler !== 'function') return;

  // Chain, don't replace -- React Native's own default handler (the dev
  // redbox, or whatever the release build does with a fatal JS error)
  // still needs to run exactly as before. This only adds a side effect in
  // front of it.
  const previousHandler: ((error: Error, isFatal?: boolean) => void) | null =
    typeof g.ErrorUtils.getGlobalHandler === 'function' ? g.ErrorUtils.getGlobalHandler() : null;

  g.ErrorUtils.setGlobalHandler((error: Error, isFatal?: boolean) => {
    try {
      const record: CrashRecord = {
        timestamp: new Date().toISOString(),
        isFatal: !!isFatal,
        message: error?.message ?? String(error),
        stack: error?.stack ? error.stack.slice(0, MAX_STACK_CHARS) : undefined,
      };
      // Fire-and-forget: there's no reliable window to await anything
      // after a fatal error, but AsyncStorage's write is a local,
      // sub-millisecond-to-a-few-ms round trip, and in practice (same
      // assumption every "last crash" logger like this relies on) that's
      // enough time to land before the process actually goes down.
      AsyncStorage.setItem(LAST_CRASH_KEY, JSON.stringify(record)).catch(() => {});
    } catch {
      // Whatever happens, never let logging the crash be the reason the
      // real handler below doesn't run.
    }
    if (previousHandler) {
      previousHandler(error, isFatal);
    }
  });
}

export async function getLastCrash(): Promise<CrashRecord | null> {
  try {
    const raw = await AsyncStorage.getItem(LAST_CRASH_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function clearLastCrash(): Promise<void> {
  try {
    await AsyncStorage.removeItem(LAST_CRASH_KEY);
  } catch {
    // Best-effort -- nothing to recover into if even the clear fails.
  }
}
