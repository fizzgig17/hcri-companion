// src/storage/lightsStore.ts
//
// Lights kept on the phone: a light is a name, notes, categories and an ordered list of this phone's readings. It can be
// created and filled while offline; "Sync" sends it to hCRI.io (uploading any reading that has not been uploaded yet) and
// brings back the trend numbers. `dirty` marks changes not yet sent. `serverId` is the light's id on hCRI.io once it exists.

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { LightKind, ServerLight, ServerReading } from '../hcri/lightsApi';

const KEY = 'hcri.io.lights.v1';

export interface LocalLight {
  id: string;
  serverId?: number;
  name: string;
  notes: string;
  /** Chosen category values per kind (light brand/model, LED brand/model/CCT, optic). */
  cats: Partial<Record<LightKind, string[]>>;
  /** This phone's readings (History ids), in trend order. */
  readingIds: string[];
  /** Reports taken off the light here that still have to be taken off on hCRI.io. */
  removedReportIds: string[];
  /** Changes not yet sent to hCRI.io. */
  dirty: boolean;
  createdAt: number;
  /** What hCRI.io last said about it (trends, counts, readings that are not on this phone). */
  server?: ServerLight;
  syncedAt?: number;
}

let memo: LocalLight[] | null = null;
let listener: (() => void) | null = null;
export const setLightsChangeListener = (fn: (() => void) | null) => { listener = fn; };

export async function loadLights(): Promise<LocalLight[]> {
  if (memo) return memo;
  try { const raw = await AsyncStorage.getItem(KEY); memo = raw ? JSON.parse(raw) : []; } catch { memo = []; }
  return memo!;
}
export async function saveLights(list: LocalLight[]): Promise<void> {
  memo = list;
  try { await AsyncStorage.setItem(KEY, JSON.stringify(list)); } catch { /* best effort */ }
  listener?.();
}
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export async function createLocalLight(name: string, notes = '', readingIds: string[] = []): Promise<LocalLight> {
  const l: LocalLight = { id: uid(), name: name.trim(), notes, cats: {}, readingIds, removedReportIds: [], dirty: true, createdAt: Date.now() };
  await saveLights([l, ...(await loadLights())]);
  return l;
}
/** Applies a change to one light, marking it dirty unless the patch says otherwise. */
export async function patchLight(id: string, fn: (l: LocalLight) => Partial<LocalLight>, markDirty = true): Promise<LocalLight | null> {
  let out: LocalLight | null = null;
  const next = (await loadLights()).map((l) => { if (l.id !== id) return l; out = { ...l, ...fn(l), ...(markDirty ? { dirty: true } : {}) }; return out; });
  await saveLights(next);
  return out;
}
export async function deleteLocalLight(id: string): Promise<void> {
  await saveLights((await loadLights()).filter((l) => l.id !== id));
}

export const serverCats = (s?: ServerLight): LocalLight['cats'] => {
  const out: LocalLight['cats'] = {};
  for (const [k, v] of Object.entries(s?.categories ?? {})) out[k as LightKind] = (v ?? []).map((x) => x.value);
  return out;
};
export type { ServerReading };
