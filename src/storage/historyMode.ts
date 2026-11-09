// src/storage/historyMode.ts
//
// "Full history" mode: set after the person refreshes History from the hCRI.io backup (Settings). Normally the app
// keeps only its latest ~100 readings (see readingHistory.ts); in full mode the local lists are allowed to hold as
// many items as the cloud backup does, so everything restored from the server stays reachable in History.

import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'hcri.io.pref.fullHistory';
/** Same ceiling the hCRI.io backup keeps per account. */
export const FULL_HISTORY_LIMIT = 5000;

let full = false;
let loaded: Promise<void> | null = null;

export function fullHistoryMode(): boolean {
  return full;
}

/** Reads the saved mode once (loadHistory/loadFlickers call this before anything is trimmed). */
export function ensureHistoryMode(): Promise<void> {
  if (!loaded) {
    loaded = AsyncStorage.getItem(KEY).then((v) => { full = v === '1'; }).catch(() => {});
  }
  return loaded;
}

export async function setFullHistoryMode(value: boolean): Promise<void> {
  full = value;
  loaded = Promise.resolve();
  try { await AsyncStorage.setItem(KEY, value ? '1' : '0'); } catch { /* best effort */ }
}
