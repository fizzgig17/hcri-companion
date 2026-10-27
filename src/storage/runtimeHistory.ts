// src/storage/runtimeHistory.ts
//
// Output-over-time runs recorded with a TKLamp tester (see components/TkLampLive.tsx), kept on the phone so they can be
// looked at, renamed and uploaded to the user's Runtime list on hCRI.io later. Values are lumens at a fixed interval.
// Not part of the cloud backup (yet): deleting one here never touches hCRI.io, and uploading never deletes it here.

import { createChunkedStore } from './chunkedList';

export interface SavedRuntime {
  id: string;
  label: string;
  savedAt: number;
  intervalSeconds: number;
  /** Lumens at intervalSeconds apart. */
  values: number[];
  /** The counts-per-lumen scale in force when it was recorded. */
  rawPerLm?: number;
  /** Sent to hCRI.io (under this label) at least once. */
  uploaded?: boolean;
}

export const RUNTIME_LIMIT = 100;

const store = createChunkedStore<SavedRuntime>('hcri.io.runtimeHistory.v1', 'hcri.io.runtimeHistory.legacy');
const listeners = new Set<() => void>();
/** Called after every change, so an open History list refreshes. Returns an unsubscribe function. */
export function onRuntimeHistoryChanged(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
const changed = () => listeners.forEach((cb) => { try { cb(); } catch { /* a listener must never break saving */ } });

export async function loadRuntimes(): Promise<SavedRuntime[]> {
  try { return await store.load(); } catch { return []; }
}

async function saveAll(list: SavedRuntime[]): Promise<void> {
  await store.save(list.slice(0, RUNTIME_LIMIT));
  changed();
}

export async function addRuntime(r: Omit<SavedRuntime, 'id' | 'savedAt'>): Promise<SavedRuntime> {
  const entry: SavedRuntime = { ...r, id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, savedAt: Date.now() };
  await saveAll([entry, ...(await loadRuntimes())]);
  return entry;
}

export async function updateRuntime(id: string, patch: Partial<Pick<SavedRuntime, 'label' | 'uploaded'>>): Promise<void> {
  const list = await loadRuntimes();
  await saveAll(list.map((r) => (r.id === id ? { ...r, ...patch } : r)));
}

export async function deleteRuntime(id: string): Promise<void> {
  await saveAll((await loadRuntimes()).filter((r) => r.id !== id));
}
