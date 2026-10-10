// src/hcri/ledLists.ts
//
// The LED brand / model / CCT dropdown values, mirrored from hCRI.io so the
// picker works offline. Fetched the first time the app loads with internet,
// then re-checked (cheap conditional request, ETag) at most once a day.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { HCRI_API_BASE } from './apiConfig';

const KEY = 'hcri.io.ledLists.v1';
const CHECK_EVERY_MS = 24 * 60 * 60 * 1000;
const URL = `${HCRI_API_BASE}/index.php/api/v1/led_lists`;

export interface LedLists {
  brands: string[];
  models: string[];
  ccts: string[];
  /** brand -> models seen with that brand on the site (most common first) */
  modelsByBrand: Record<string, string[]>;
}

interface Stored { lists: LedLists; etag?: string; checkedAt: number }

export const EMPTY_LED_LISTS: LedLists = { brands: [], models: [], ccts: [], modelsByBrand: {} };

let memo: Stored | null = null;

async function load(): Promise<Stored | null> {
  if (memo) return memo;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (raw) memo = JSON.parse(raw);
  } catch { /* treat as empty */ }
  return memo;
}

export async function getCachedLedLists(): Promise<LedLists> {
  return (await load())?.lists ?? EMPTY_LED_LISTS;
}

/**
 * Fetches the lists if we have none yet, or the last check was over a day ago (or `force`).
 * Never throws: offline / server trouble just leaves the cached lists in place.
 * Returns the lists to use (cached or fresh).
 */
export async function refreshLedLists(force = false): Promise<LedLists> {
  const cur = await load();
  if (!force && cur && Date.now() - cur.checkedAt < CHECK_EVERY_MS && cur.lists.brands.length) return cur.lists;
  try {
    const headers: Record<string, string> = {};
    if (cur?.etag && cur.lists.brands.length) headers['If-None-Match'] = cur.etag;
    const res = await fetch(URL, { headers });
    if (res.status === 304 && cur) {
      memo = { ...cur, checkedAt: Date.now() };
    } else if (res.ok) {
      const j = await res.json();
      const lists: LedLists = {
        brands: j?.lists?.led_brand ?? [],
        models: j?.lists?.led_model ?? [],
        ccts: j?.lists?.led_cct ?? [],
        modelsByBrand: j?.modelsByBrand ?? {},
      };
      memo = { lists, etag: res.headers.get('ETag') ?? undefined, checkedAt: Date.now() };
    } else {
      return cur?.lists ?? EMPTY_LED_LISTS;
    }
    await AsyncStorage.setItem(KEY, JSON.stringify(memo));
    return memo!.lists;
  } catch {
    return cur?.lists ?? EMPTY_LED_LISTS;
  }
}
