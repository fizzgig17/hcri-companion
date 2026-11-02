// src/hcri/ledLists.ts
//
// The LED brand / model / CCT dropdown values, mirrored from hCRI.io so the
// picker works offline. Fetched the first time the app loads with internet,
// then re-checked (cheap conditional request, ETag) at most once a day.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { HCRI_API_BASE } from './apiConfig';
import fetchWithTimeout from './fetchWithTimeout';

const KEY = 'hcri.io.ledLists.v1';   // same key: old caches simply lack `others` and are refreshed on the next start
const CHECK_EVERY_MS = 24 * 60 * 60 * 1000;
const URL = `${HCRI_API_BASE}/index.php/api/v1/led_lists`;

export interface LedLists {
  brands: string[];
  models: string[];
  ccts: string[];
  /** brand -> models seen with that brand on the site (most common first) */
  modelsByBrand: Record<string, string[]>;
  /** The other category lists (light_brand, light_model, optic, lumens, current), for the Categorize screen. */
  others: Record<string, string[]>;
}

interface Stored { lists: LedLists; etag?: string; checkedAt: number }

export const EMPTY_LED_LISTS: LedLists = { brands: [], models: [], ccts: [], modelsByBrand: {}, others: {} };

let memo: Stored | null = null;

async function load(): Promise<Stored | null> {
  if (memo) return memo;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (raw) {
      memo = JSON.parse(raw);
      if (memo && !memo.lists.others) memo.lists.others = {};   // cached by an older version
    }
  } catch { /* treat as empty */ }
  return memo;
}

export async function getCachedLedLists(): Promise<LedLists> {
  return (await load())?.lists ?? EMPTY_LED_LISTS;
}

/**
 * Fetches the lists if we have none yet, or the last check was over a day ago (or `force`; the app forces it once each
 * time it starts, which is a cheap conditional request when nothing changed).
 * Never throws: offline / server trouble just leaves the cached lists in place.
 * Returns the lists to use (cached or fresh).
 */
export async function refreshLedLists(force = false): Promise<LedLists> {
  const cur = await load();
  const haveOthers = !!cur && Object.keys(cur.lists.others ?? {}).length > 0;
  if (!force && cur && Date.now() - cur.checkedAt < CHECK_EVERY_MS && cur.lists.brands.length && haveOthers) return cur.lists;
  try {
    const headers: Record<string, string> = {};
    if (cur?.etag && cur.lists.brands.length && haveOthers) headers['If-None-Match'] = cur.etag;
    const res = await fetchWithTimeout(URL, { headers });
    if (res.status === 304 && cur) {
      memo = { ...cur, checkedAt: Date.now() };
    } else if (res.ok) {
      const j = await res.json();
      const lists: LedLists = {
        brands: j?.lists?.led_brand ?? [],
        models: j?.lists?.led_model ?? [],
        ccts: j?.lists?.led_cct ?? [],
        modelsByBrand: j?.modelsByBrand ?? {},
        others: {
          light_brand: j?.lists?.light_brand ?? [],
          light_model: j?.lists?.light_model ?? [],
          optic: j?.lists?.optic ?? [],
          lumens: j?.lists?.lumens ?? [],
          current: j?.lists?.current ?? [],
        },
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
