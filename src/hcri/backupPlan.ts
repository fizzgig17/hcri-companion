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

/** What still has to go to the server: readings whose fingerprint differs from what was last sent, plus queued deletions. */
export function planBackup(history: SavedReading[], state: Pick<BackupState, 'synced' | 'pendingDelete'>): { upload: SavedReading[]; deleteIds: string[] } {
  const gone = new Set(state.pendingDelete);
  return {
    upload: history.filter((r) => !gone.has(r.id) && state.synced[r.id] !== fingerprint(r)),
    deleteIds: state.pendingDelete,
  };
}

/** True for a server item that looks like a reading this app can show (guards against a malformed backup). */
export function isRestorableReading(x: any): x is SavedReading {
  return !!x && typeof x.id === 'string' && typeof x.savedAt === 'number' && typeof x.label === 'string' && !!x.result && Array.isArray(x.result.spectrum);
}

