// src/storage/flickerLogic.ts
//
// The pure parts of the saved-flicker list (types, which flickers a reading may take, what a flicker's badge says),
// free of storage imports so they can be unit-tested. See flickerHistory.ts.

import type { FlickerCapture } from '../ble/parseResult';

/** Saved flickers kept; the oldest fall off first. */
export const FLICKER_LIMIT = 100;

export interface SavedFlicker {
  id: string;
  label: string;
  /** Epoch ms when the sample was taken. */
  savedAt: number;
  flicker: FlickerCapture;
  /** Meter model that took it (e.g. HPCS-330P). */
  model?: string;
  readingId?: string;
  uploaded?: boolean;
}

type ReadingRef = { id: string; reportId?: number; result: { flicker?: unknown } };

/** The reading a saved flicker is attached to, if that reading still exists. */
export function attachedReading<R extends { id: string }>(f: SavedFlicker, readings: R[]): R | undefined {
  return f.readingId ? readings.find((r) => r.id === f.readingId) : undefined;
}

/** Saved flickers a reading may take: none if the reading already has a flicker; otherwise only ones not attached to any reading. */
export function flickersForReading(reading: ReadingRef, flickers: SavedFlicker[], readings: ReadingRef[]): SavedFlicker[] {
  if (reading.result.flicker) return [];
  return flickers.filter((f) => !attachedReading(f, readings));
}

/** Where a saved flicker stands, for the badge on its row. */
export function flickerAssociation(f: SavedFlicker, readings: ReadingRef[]): 'report' | 'reading' | 'uploaded' | 'none' {
  const r = attachedReading(f, readings);
  if (r) return r.reportId != null ? 'report' : 'reading';
  return f.uploaded ? 'uploaded' : 'none';
}

export function trimFlickers(list: SavedFlicker[]): SavedFlicker[] {
  // Newest first; the oldest fall off the end.
  return list.length > FLICKER_LIMIT ? list.slice(0, FLICKER_LIMIT) : list;
}

/** True for a server item that looks like a saved flicker. */
export function isRestorableFlicker(x: any): x is SavedFlicker {
  return !!x && typeof x.id === 'string' && typeof x.savedAt === 'number' && !!x.flicker && Array.isArray(x.flicker.waveform) && typeof x.flicker.frequencyHz === 'number';
}
