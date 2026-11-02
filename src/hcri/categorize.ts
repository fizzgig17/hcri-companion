// src/hcri/categorize.ts
//
// Categorize: put LEDs and the other hCRI.io categories (light brand / model, optic, lumens, current) on one or many
// saved readings. Nothing here runs by itself: it only runs when the person taps Categorize in the dialog.
//
// The last values the person applied are remembered, and the dialog opens with them filled in; they are a starting
// point only (nothing is applied until Categorize is tapped, and new readings are never categorized automatically).

import AsyncStorage from '@react-native-async-storage/async-storage';
import { patchReadings, SavedReading } from '../storage/readingHistory';
import { LedDetails } from './ledApi';
import { hasLed, ledPatch, ledsOfReading } from './leds';
import { syncLedForReading } from './ledSync';

export type OtherKind = 'light_brand' | 'light_model' | 'optic' | 'lumens' | 'current';

export const OTHER_KINDS: { kind: OtherKind; label: string; numeric?: boolean }[] = [
  { kind: 'light_brand', label: 'Light brand' },
  { kind: 'light_model', label: 'Light model' },
  { kind: 'optic', label: 'Optic' },
  { kind: 'lumens', label: 'Lumens', numeric: true },
  { kind: 'current', label: 'Current', numeric: true },
];

/** What the Categorize dialog edits: the LEDs plus one value per other category (empty string = not set). */
export interface CategoryValues {
  leds: LedDetails[];
  other: Partial<Record<OtherKind, string>>;
}

export const EMPTY_VALUES: CategoryValues = { leds: [], other: {} };

const LAST_KEY = 'hcri.io.pref.lastCategorize.v1';

export async function loadLastCategorize(): Promise<CategoryValues> {
  try {
    const raw = await AsyncStorage.getItem(LAST_KEY);
    if (raw) {
      const j = JSON.parse(raw);
      return { leds: Array.isArray(j?.leds) ? j.leds : [], other: j?.other && typeof j.other === 'object' ? j.other : {} };
    }
  } catch { /* nothing remembered */ }
  return EMPTY_VALUES;
}

export async function saveLastCategorize(v: CategoryValues): Promise<void> {
  try { await AsyncStorage.setItem(LAST_KEY, JSON.stringify(v)); } catch { /* best effort */ }
}

/** A reading's current values, in the dialog's shape. */
export function valuesOfReading(r: SavedReading): CategoryValues {
  return { leds: ledsOfReading(r), other: { ...(r.categories ?? {}) } };
}

export function hasAnyValue(v: CategoryValues): boolean {
  return v.leds.some(hasLed) || Object.values(v.other).some((x) => !!x && x.trim() !== '');
}

/** "Light: Convoy · Optic: TIR · 800 lm · 1.5 A" for the History row; empty when nothing is set. */
export function otherCategoriesLine(r: Pick<SavedReading, 'categories'>): string {
  const c = r.categories ?? {};
  const parts: string[] = [];
  const light = [c.light_brand, c.light_model].filter(Boolean).join(' ');
  if (light) parts.push(light);
  if (c.optic) parts.push(c.optic);
  if (c.lumens) parts.push(`${c.lumens} lm`);
  if (c.current) parts.push(`${c.current} A`);
  return parts.join(' · ');
}

export interface ApplyResult {
  /** Readings that were changed. */
  changed: number;
  /** Readings that were left alone because they already had values (fill-only mode). */
  skipped: number;
  /** Changed readings that have a report on hCRI.io but could not be sent right now (offline, ...); they are sent next time. */
  pendingSend: number;
}

/**
 * Applies `values` to the readings `ids`.
 *  - replace = true:  every value that is filled in overwrites what the reading has (LEDs replace the reading's LEDs).
 *  - replace = false: a reading only gets a value where it has none yet; its existing choices stay.
 * Blank fields are never applied. The change is saved on the phone at once and, for readings already uploaded, sent to
 * their reports on hCRI.io; the others are sent when they are uploaded.
 */
export async function applyCategories(ids: string[], values: CategoryValues, replace: boolean): Promise<ApplyResult> {
  const newLeds = values.leds.filter(hasLed);
  const newOther: Partial<Record<OtherKind, string>> = {};
  for (const { kind } of OTHER_KINDS) {
    const v = (values.other[kind] ?? '').trim();
    if (v) newOther[kind] = v;
  }
  let changed = 0, skipped = 0;
  const touched: string[] = [];
  await patchReadings(ids, (r) => {
    const patch: Partial<SavedReading> = {};
    let did = false;
    if (newLeds.length && (replace || !ledsOfReading(r).length)) {
      Object.assign(patch, ledPatch(newLeds), { ledSynced: false, ledDismissed: false, ledCleared: false });
      did = true;
    }
    const cats = { ...(r.categories ?? {}) };
    let catDid = false;
    for (const k of Object.keys(newOther) as OtherKind[]) {
      if (replace || !cats[k]) { cats[k] = newOther[k]; catDid = true; }
    }
    if (catDid) { patch.categories = cats; patch.catSynced = false; did = true; }
    if (did) { changed++; touched.push(r.id); return patch; }
    skipped++;
    return null;
  });
  let pendingSend = 0;
  for (const id of touched) {
    const ok = await syncLedForReading(id);   // false also when there is no report yet (sent at upload)
    if (!ok) pendingSend++;
  }
  return { changed, skipped, pendingSend };
}
