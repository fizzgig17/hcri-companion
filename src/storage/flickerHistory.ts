// src/storage/flickerHistory.ts
//
// Flicker samples taken on their own ("New sample" on the Flicker page), kept so they survive leaving the page and
// can be shared, uploaded, or attached to a reading later. A flicker captured FOR a reading lives inside that reading
// (see readingHistory.ts) and is not listed here.
//
// Association, kept per saved flicker:
//   readingId -- the saved reading it was attached to (the flicker was copied into that reading). Whether it is then
//                "in a report" is read from that reading's own report link, so it never goes stale.
//   uploaded  -- sent to hCRI.io on its own (a standalone flicker reading there, not part of any report)

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { FlickerCapture } from '../ble/parseResult';
import { notifyHistoryChanged } from './readingHistory';
import { queueBackupDelete } from './backupState';
import { flickerBackupId } from '../hcri/backupPlan';
import { SavedFlicker, FLICKER_LIMIT, trimFlickers, isRestorableFlicker, attachedReading, flickersForReading, flickerAssociation } from './flickerLogic';

export { FLICKER_LIMIT, trimFlickers, isRestorableFlicker, attachedReading, flickersForReading, flickerAssociation };
export type { SavedFlicker };

const STORAGE_KEY = 'hcri.io.flickerHistory.v1';

function makeId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function loadFlickers(): Promise<SavedFlicker[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function saveAll(list: SavedFlicker[]): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  notifyHistoryChanged();   // schedules the cloud backup
}

/** Saves a standalone flicker sample (newest first). */
export async function addFlicker(flicker: FlickerCapture, label: string, model?: string): Promise<SavedFlicker> {
  const entry: SavedFlicker = { id: makeId(), label, savedAt: Date.now(), flicker, ...(model ? { model } : {}) };
  await saveAll(trimFlickers([entry, ...(await loadFlickers())]));
  return entry;
}

export async function updateFlicker(id: string, patch: Partial<Pick<SavedFlicker, 'label' | 'readingId' | 'uploaded'>>): Promise<void> {
  const list = await loadFlickers();
  await saveAll(list.map((f) => (f.id === id ? { ...f, ...patch } : f)));
}

export async function deleteFlickers(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const set = new Set(ids);
  await saveAll((await loadFlickers()).filter((f) => !set.has(f.id)));
  queueBackupDelete(ids.map(flickerBackupId));
}

/** Adds flickers restored from the cloud backup that aren't here yet. Returns how many ended up in the list. */
export async function mergeRestoredFlickers(restored: SavedFlicker[]): Promise<number> {
  const existing = await loadFlickers();
  const have = new Set(existing.map((f) => f.id));
  const fresh = restored.filter((f) => !have.has(f.id));
  if (!fresh.length) return 0;
  const merged = trimFlickers([...existing, ...fresh].sort((a, b) => b.savedAt - a.savedAt));
  await saveAll(merged);
  const kept = new Set(merged.map((f) => f.id));
  return fresh.filter((f) => kept.has(f.id)).length;
}

