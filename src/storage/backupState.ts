// src/storage/backupState.ts
//
// Bookkeeping for the optional cloud backup (see hcri/backup.ts): which readings the server already has (by a
// fingerprint of what was sent, so an edited reading is sent again) and which deletions still have to be
// passed on. Kept separate from readingHistory.ts so that file can queue deletions without importing the
// backup code (which imports it).

import AsyncStorage from '@react-native-async-storage/async-storage';

const STATE_KEY = 'hcri.io.backup.v1';
const ENABLED_KEY = 'hcri.io.pref.cloudBackup';
const DECLINED_KEY = 'hcri.io.backup.restoreDeclined';

export interface BackupState {
  /** Reading id -> fingerprint of the version the server holds. */
  synced: Record<string, string>;
  /** Ids the person deleted in the app that the backup should drop too. */
  pendingDelete: string[];
  /** Epoch ms of the last run that finished with nothing left to send. */
  lastBackupAt?: number;
}

const EMPTY: BackupState = { synced: {}, pendingDelete: [] };

// One read-modify-write at a time, so two quick changes can't overwrite each other.
let chain: Promise<unknown> = Promise.resolve();
export function withBackupState<T>(fn: (s: BackupState) => T | Promise<T>): Promise<T> {
  const run = chain.then(async () => {
    const s = await loadBackupState();
    const out = await fn(s);
    await AsyncStorage.setItem(STATE_KEY, JSON.stringify(s));
    return out;
  });
  chain = run.catch(() => {});
  return run;
}

export async function loadBackupState(): Promise<BackupState> {
  try {
    const raw = await AsyncStorage.getItem(STATE_KEY);
    if (!raw) return { synced: {}, pendingDelete: [] };
    const p = JSON.parse(raw);
    return {
      synced: p && typeof p.synced === 'object' && p.synced ? p.synced : {},
      pendingDelete: Array.isArray(p?.pendingDelete) ? p.pendingDelete.filter((x: unknown) => typeof x === 'string') : [],
      lastBackupAt: typeof p?.lastBackupAt === 'number' ? p.lastBackupAt : undefined,
    };
  } catch {
    return { ...EMPTY, synced: {}, pendingDelete: [] };
  }
}

/** Remembers readings the person deleted, so the backup forgets them too (history trimming does NOT call this). */
export async function queueBackupDelete(ids: string[]): Promise<void> {
  if (!ids.length) return;
  try {
    await withBackupState((s) => {
      const set = new Set(s.pendingDelete);
      for (const id of ids) set.add(id);
      s.pendingDelete = Array.from(set);
    });
  } catch {
    // bookkeeping only; a missed delete just leaves an extra copy in the backup
  }
}

// On by default: a backup nobody turned on can't save anyone's readings. It only does anything once an API token is saved.
export async function loadBackupEnabled(): Promise<boolean> {
  const raw = await AsyncStorage.getItem(ENABLED_KEY);
  return raw === null ? true : raw === 'true';
}

export async function saveBackupEnabled(enabled: boolean): Promise<void> {
  await AsyncStorage.setItem(ENABLED_KEY, enabled ? 'true' : 'false');
}

export async function loadRestoreDeclined(): Promise<boolean> {
  return (await AsyncStorage.getItem(DECLINED_KEY)) === 'true';
}

export async function saveRestoreDeclined(declined: boolean): Promise<void> {
  await AsyncStorage.setItem(DECLINED_KEY, declined ? 'true' : 'false');
}
