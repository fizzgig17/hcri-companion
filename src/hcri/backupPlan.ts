// src/hcri/backupPlan.ts
//
// The pure parts of the cloud backup (what has to be sent, what counts as a restorable reading), kept free of
// React Native imports so they can be unit-tested. See backup.ts.

import type { SavedReading } from '../storage/readingHistory';
import type { BackupState } from '../storage/backupState';

/** Short stable fingerprint of a reading (djb2 over its JSON + length): changes whenever the reading is edited. */
export function fingerprint(r: SavedReading): string {
  const json = JSON.stringify(r);
  let h = 5381;
  for (let i = 0; i < json.length; i++) h = ((h << 5) + h + json.charCodeAt(i)) | 0;
  return `${(h >>> 0).toString(36)}.${json.length.toString(36)}`;
}

/** Backup ids: readings use their own id; saved flickers get a prefix so the two kinds never collide. */
export const FLICKER_BACKUP_PREFIX = 'fl_';
export const flickerBackupId = (id: string): string => FLICKER_BACKUP_PREFIX + id;
export const isFlickerBackupId = (id: string): boolean => id.startsWith(FLICKER_BACKUP_PREFIX);

/** One thing that gets backed up: a saved reading or a saved flicker, under its backup id. */
export interface BackupItem {
  id: string;
  savedAt: number;
  payload: unknown;
}
export const readingItem = (r: SavedReading): BackupItem => ({ id: r.id, savedAt: r.savedAt, payload: r });
export const flickerItem = (f: { id: string; savedAt: number }): BackupItem => ({ id: flickerBackupId(f.id), savedAt: f.savedAt, payload: f });

/** Same fingerprint for any payload. */
export function fingerprintOf(x: unknown): string {
  return fingerprint(x as SavedReading);
}

/** What still has to go to the server: items whose fingerprint differs from what was last sent, plus queued deletions. */
export function planBackup(items: BackupItem[], state: Pick<BackupState, 'synced' | 'pendingDelete'>): { upload: BackupItem[]; deleteIds: string[] } {
  const gone = new Set(state.pendingDelete);
  return {
    upload: items.filter((it) => !gone.has(it.id) && state.synced[it.id] !== fingerprintOf(it.payload)),
    deleteIds: state.pendingDelete,
  };
}

/** True for a server item that looks like a reading this app can show (guards against a malformed backup). */
export function isRestorableReading(x: any): x is SavedReading {
  return !!x && typeof x.id === 'string' && typeof x.savedAt === 'number' && typeof x.label === 'string' && !!x.result && Array.isArray(x.result.spectrum);
}

