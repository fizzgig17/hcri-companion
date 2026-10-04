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
  /**
   * The hCRI.io report this reading was most recently uploaded as, if
   * ever -- the same {id, isPublic} shape the Main/Data tabs' own
   * copy-link button keeps in memory (see HomeScreen.tsx's
   * lastUploadedReport and UploadResult in uploadToHcri.ts), just
   * persisted here instead so History can offer the same "Copy Link"
   * affordance for a reading uploaded a while ago, not only the one
   * that's still the current in-memory result.
   *
   * Set/overwritten by setReadingReportLink() after EVERY successful
   * upload of this reading, from any of the three places that can
   * trigger one (Main tab, Data tab, History tab itself) -- a second
   * upload replaces whatever was here before rather than leaving a
   * stale reportId/reportIsPublic pointing at an earlier report.
   * Missing entirely for a reading that's never been uploaded, or was
   * uploaded before this field existed.
   */
  reportId?: number;
  reportIsPublic?: boolean;
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

/**
 * Records (or overwrites) which hCRI.io report a reading was most recently
 * uploaded as -- called after EVERY successful upload of a saved reading,
 * from any of Main tab, Data tab, or History tab's own upload/upload-many
 * flows (each already has a SavedReading id to hand by the time its upload
 * succeeds: measure() keeps the id addReading() returned for Main/Data's
 * "current reading", History already has the id for its own rows). A
 * second upload of the same reading calls this again and simply replaces
 * the previous {reportId, isPublic} -- there's no stale-link case to guard
 * against beyond always overwriting rather than merging/ignoring.
 */
export async function setReadingReportLink(id: string, reportId: number, isPublic: boolean): Promise<void> {
  const existing = await loadHistory();
  const next = existing.map((r) => (r.id === id ? { ...r, reportId, reportIsPublic: isPublic } : r));
  await saveAll(next);
}

/**
 * Renames a reading AND records its report link in one read-modify-write --
 * what Main/Data's upload() actually wants (see HomeScreen.tsx), and NOT
 * the same thing as calling renameReading() and setReadingReportLink()
 * back to back without awaiting one before starting the other: each of
 * those does its own loadHistory()-then-saveAll() round trip, and two
 * fired concurrently race each other -- whichever one's saveAll() finishes
 * last wins outright, silently overwriting the other's change (confirmed
 * 2026-10-04: this is why some uploaded readings ended up with their title
 * synced but no report link, or neither, instead of both). Keeping it to
 * a single load+modify+save avoids that race entirely rather than papering
 * over it with sequencing at each call site. `reportId`/`isPublic` are
 * optional so this can also be used for a rename-only sync if a future
 * caller needs that, though today's one caller always has both by the
 * time it calls this.
 */
export async function recordUpload(
  id: string,
  label: string,
  reportId?: number,
  isPublic?: boolean
): Promise<void> {
  const existing = await loadHistory();
  const next = existing.map((r) =>
    r.id === id
      ? { ...r, label, ...(typeof reportId === 'number' && typeof isPublic === 'boolean' ? { reportId, reportIsPublic: isPublic } : {}) }
      : r
  );
  await saveAll(next);
}

export async function deleteReading(id: string): Promise<void> {
  const existing = await loadHistory();
  await saveAll(existing.filter((r) => r.id !== id));
}

/** Deletes several readings in one go (HistoryTab's bulk/"select all" delete) -- one read-modify-write of the whole list instead of calling deleteReading in a loop, which would otherwise race itself: each call's `loadHistory()` wouldn't yet see the previous call's not-yet-finished `saveAll()`, so only the last delete in the loop would actually stick. */
export async function deleteManyReadings(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const idSet = new Set(ids);
  const existing = await loadHistory();
  await saveAll(existing.filter((r) => !idSet.has(r.id)));
}
