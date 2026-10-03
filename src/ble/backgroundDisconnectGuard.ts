// src/ble/backgroundDisconnectGuard.ts
//
// Shared across every screen that can put up a native share sheet (Home's
// CSV/log shares, History's per-reading and bulk CSV shares) -- not scoped
// to any one screen's React state, because the thing it's guarding is
// app-wide: there's exactly one AppState listener (HomeScreen's) deciding
// whether to disconnect the meter on backgrounding, and it needs to know
// about a share sheet opened from ANY screen now that History is its own
// top-level tab, not a panel inside Home. A plain module-level flag (same
// singleton-across-reloads spirit as MeterConnection's
// getSharedBleManager()) is all this needs -- it's never rendered, so
// there's no reason to route it through React state/context.
let suppressed = false;

export function isBackgroundDisconnectSuppressed(): boolean {
  return suppressed;
}

/**
 * Wraps an async action (sharing a CSV/log, so far) that's expected to
 * briefly take the app out of the foreground on its own -- presenting a
 * native share sheet, say -- so HomeScreen's AppState listener doesn't
 * treat that as the person switching away and disconnect the meter out
 * from under them.
 */
export async function withBackgroundDisconnectSuppressed(action: () => Promise<void>): Promise<void> {
  suppressed = true;
  try {
    await action();
  } finally {
    suppressed = false;
  }
}
