// src/storage/statDisplayPrefs.ts
//
// Which measurements show on the Main tab's result card, and in what
// order -- user-configurable from Settings (hold-and-drag to reorder,
// checkbox to show/hide; see components/DraggableStatList.tsx). Uses
// AsyncStorage, same as preferences.ts's keepAwake flag -- this isn't a
// secret, just a layout preference.
//
// Persisted as a single ordered list of ALL metric ids (see
// utils/statMetrics.ts) plus which of those are actually enabled, rather
// than just the enabled subset -- so unchecking a measurement keeps its
// place in the list instead of it jumping to the end if re-checked later.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { STAT_METRIC_IDS, DEFAULT_VISIBLE_STAT_IDS } from '../utils/statMetrics';

const ORDER_KEY = 'hcri.io.pref.statOrder';
const ENABLED_KEY = 'hcri.io.pref.statEnabled';

export interface StatDisplayPrefs {
  /** Every metric id, in display order (includes hidden ones, wherever they were last left in the list). */
  order: string[];
  /** Which ids from `order` are actually shown on the Main tab. */
  enabled: Set<string>;
}

/** Defaults first (in the requested order), then everything else in the registry's own order (x/y, then R1-R15) -- see statMetrics.ts. */
function defaultOrder(): string[] {
  const rest = STAT_METRIC_IDS.filter((id) => !DEFAULT_VISIBLE_STAT_IDS.includes(id));
  return [...DEFAULT_VISIBLE_STAT_IDS, ...rest];
}

export function defaultStatDisplayPrefs(): StatDisplayPrefs {
  return { order: defaultOrder(), enabled: new Set(DEFAULT_VISIBLE_STAT_IDS) };
}

export async function loadStatDisplayPrefs(): Promise<StatDisplayPrefs> {
  const [rawOrder, rawEnabled] = await Promise.all([
    AsyncStorage.getItem(ORDER_KEY),
    AsyncStorage.getItem(ENABLED_KEY),
  ]);

  let order: string[];
  try {
    order = rawOrder ? JSON.parse(rawOrder) : defaultOrder();
  } catch {
    order = defaultOrder();
  }
  // Reconcile against the live registry: drop any saved id that no
  // longer exists, and append any registry id missing from the saved
  // order (e.g. a measurement added to the app since this person last
  // touched Settings) at the bottom -- same spot a fresh install would
  // put it.
  const known = new Set(STAT_METRIC_IDS);
  order = order.filter((id) => known.has(id));
  for (const id of STAT_METRIC_IDS) {
    if (!order.includes(id)) order.push(id);
  }

  let enabledList: string[];
  try {
    enabledList = rawEnabled ? JSON.parse(rawEnabled) : DEFAULT_VISIBLE_STAT_IDS;
  } catch {
    enabledList = DEFAULT_VISIBLE_STAT_IDS;
  }
  const enabled = new Set(enabledList.filter((id) => known.has(id)));

  return { order, enabled };
}

export async function saveStatDisplayPrefs(prefs: StatDisplayPrefs): Promise<void> {
  await Promise.all([
    AsyncStorage.setItem(ORDER_KEY, JSON.stringify(prefs.order)),
    AsyncStorage.setItem(ENABLED_KEY, JSON.stringify(Array.from(prefs.enabled))),
  ]);
}

/** The ids MainTab should actually render, in order -- `order` filtered down to just the enabled ones. */
export function visibleStatIds(prefs: StatDisplayPrefs): string[] {
  return prefs.order.filter((id) => prefs.enabled.has(id));
}
