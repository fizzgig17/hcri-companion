// src/storage/readingHistory.ts
//
// Persists every completed measurement locally, most-recent first, so past
// readings survive app restarts and can be browsed/renamed/uploaded/shared
// later (see HistoryTab.tsx) instead of only ever existing as "whatever the
// last reading happened to be" in memory.
//
// Requires @react-native-async-storage/async-storage:
//   npm install @react-native-async-storage/async-storage
// (React Native >= 0.60 autolinks it -- no manual native setup needed.)
// Deliberately NOT Keychain (secureStorage.ts) -- these aren't secrets, and
// Keychain's storage is meant for small credential-sized blobs, not
// potentially dozens of full spectra (each with a few hundred float
// samples). preferences.ts uses the same AsyncStorage dependency, so it
// only needs installing once for both.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { MeterResult } from '../ble/parseResult';
import { analyzeSpectrum, SpectralAnalysis } from '../utils/spectralAnalysis';

const STORAGE_KEY = 'hcri.io.readingHistory.v1';

// Caps how many readings get kept locally -- unbounded growth would mean an
// ever-larger JSON blob getting read/written on every single change, which
// gets slow (and eventually large) if you take hundreds of readings over
// weeks of use. Oldest readings drop off the end automatically past this;
// nothing currently warns you when that happens, worth knowing if you're
// relying on this as permanent storage rather than "recent session
// history" -- upload anything you want to keep forever to hCRI.io instead.
const MAX_HISTORY = 100;

export interface SavedReading {
  id: string;
  label: string;
  /** Epoch ms when this reading was taken/saved -- NOT updated by a later rename, so it stays a true "when was this actually measured" timestamp. */
  savedAt: number;
  result: MeterResult;
  /**
   * Spectrum-derived CCT/Duv/Ra/R9/R1-R15/x/y for this reading, computed
   * ONCE here (via analyzeSpectrum()) at save time rather than re-run on
   * every History row render -- see HistoryTab.tsx's row summary, which
   * used to read the device-reported result.cct/result.ra directly instead
   * specifically to avoid that recompute cost. Storing it here gets the
   * same cheap-to-display property without depending on the device's own
   * metrics-block offsets being correct for whatever model/firmware took
   * this reading -- it's the exact same analysis object Main/Spectrum/Data
   * show, just persisted instead of only ever living in HomeScreen's
   * in-memory useMemo.
   *
   * Optional because readings saved before this field existed won't have
   * it -- HistoryTab falls back to computing it on the fly for those older
   * rows rather than treating a missing field as corrupted data.
   */
  analysis?: SpectralAnalysis;
}

function makeId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function loadHistory(): Promise<SavedReading[]> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // Corrupted/unparseable stored JSON -- treat as empty rather than
    // throwing and taking the whole History tab down with it.
    return [];
  }
}

async function saveAll(readings: SavedReading[]): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(readings));
}

/** Call once per completed measurement -- adds it to the front of history (most recent first) and returns the saved entry (including its new id). Computes `analysis` here, once, from `result.spectrum` -- see SavedReading's own comment on that field for why. */
export async function addReading(result: MeterResult, label: string): Promise<SavedReading> {
  const analysis = analyzeSpectrum(result.spectrum);
  const entry: SavedReading = { id: makeId(), label, savedAt: Date.now(), result, analysis };
  const existing = await loadHistory();
  const next = [entry, ...existing].slice(0, MAX_HISTORY);
  await saveAll(next);
  return entry;
}

/** Renames a saved reading in place -- e.g. right before uploading it under a new title (see HistoryTab.tsx), so the edited label sticks around in history after the upload rather than only ever living in that one upload request. */
export async function renameReading(id: string, label: string): Promise<void> {
  const existing = await loadHistory();
  const next = existing.map((r) => (r.id === id ? { ...r, label } : r));
  await saveAll(next);
}

export async function deleteReading(id: string): Promise<void> {
  const existing = await loadHistory();
  await saveAll(existing.filter((r) => r.id !== id));
}
