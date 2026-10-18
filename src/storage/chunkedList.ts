// src/storage/chunkedList.ts
//
// A list of records (each with a string `id`) kept as ONE storage entry per record plus a small index entry, instead of
// one giant JSON blob. A blob holding a hundred full spectra (plus flicker waveforms) can grow past what the phone's
// storage will read or write in one piece; when that happens the whole History fails to load and every new save fails.
// Per-record entries stay small, and a save only rewrites the records that actually changed.
//
// Migration: if the old single-blob key exists it is read once, written out as records, and removed. If it exists but
// can NOT be read, it is left untouched (never overwritten or deleted) and the list starts empty, so nothing the phone
// might still be able to recover later is destroyed.
//
// Write order is records, then index, then removal of dropped records, so a crash in the middle leaves either the old
// list or the new one, never a list that points at missing records.

import AsyncStorage from '@react-native-async-storage/async-storage';

export interface ChunkedStore<T extends { id: string }> {
  load(): Promise<T[]>;
  save(list: T[]): Promise<void>;
}

export interface KeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export function createChunkedStore<T extends { id: string }>(
  baseKey: string,
  legacyKey: string,
  storage: KeyValueStore = AsyncStorage as unknown as KeyValueStore,
  onProblem: (msg: string) => void = () => {}
): ChunkedStore<T> {
  const indexKey = `${baseKey}.index`;
  const recKey = (id: string) => `${baseKey}.r.${id}`;
  // What is currently on disk, as the exact strings written/read, so a save only touches what changed.
  let written = new Map<string, string>();
  let writtenIndex: string | null = null;
  let ready: Promise<void> | null = null;
  // Saves run one at a time, in order.
  let queue: Promise<unknown> = Promise.resolve();

  async function migrate(): Promise<void> {
    let raw: string | null = null;
    try {
      raw = await storage.getItem(legacyKey);
    } catch (e: any) {
      onProblem(`Old ${legacyKey} could not be read (${e?.message ?? e}); left in place`);
      return;
    }
    if (!raw) return;
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { onProblem(`Old ${legacyKey} is not valid JSON; left in place`); return; }
    if (!Array.isArray(parsed)) return;
    const list = (parsed as T[]).filter((x) => x && typeof x.id === 'string');
    await writeList(list);
    try { await storage.removeItem(legacyKey); } catch { /* harmless: the index exists now, so the old blob is never read again */ }
  }

  async function init(): Promise<void> {
    let idx: string | null = null;
    try { idx = await storage.getItem(indexKey); } catch (e: any) { onProblem(`Index read failed: ${e?.message ?? e}`); throw e; }
    if (idx == null) await migrate();
  }

  async function writeList(list: T[]): Promise<void> {
    const nextRecs = new Map<string, string>();
    const toWrite: [string, string][] = [];
    for (const r of list) {
      const json = JSON.stringify(r);
      nextRecs.set(r.id, json);
      if (written.get(r.id) !== json) toWrite.push([r.id, json]);
    }
    for (const [id, json] of toWrite) await storage.setItem(recKey(id), json);
    const idx = JSON.stringify(list.map((r) => r.id));
    if (idx !== writtenIndex) await storage.setItem(indexKey, idx);
    const dropped = [...written.keys()].filter((id) => !nextRecs.has(id));
    written = nextRecs;
    writtenIndex = idx;
    for (const id of dropped) { try { await storage.removeItem(recKey(id)); } catch { /* orphan record, never listed */ } }
  }

  async function readList(): Promise<T[]> {
    let idx: string | null = null;
    idx = await storage.getItem(indexKey);
    if (idx == null) { written = new Map(); writtenIndex = null; return []; }
    let ids: string[];
    try { const p = JSON.parse(idx); ids = Array.isArray(p) ? p.filter((x) => typeof x === 'string') : []; } catch { ids = []; }
    const out: T[] = [];
    const recs = new Map<string, string>();
    for (const id of ids) {
      try {
        const json = await storage.getItem(recKey(id));
        if (!json) continue;
        const rec = JSON.parse(json) as T;
        if (rec && rec.id === id) { out.push(rec); recs.set(id, json); }
      } catch (e: any) {
        onProblem(`Record ${id} could not be read: ${e?.message ?? e}`);
      }
    }
    written = recs;
    writtenIndex = idx;
    return out;
  }

  return {
    async load() {
      if (!ready) ready = init().catch((e) => { ready = null; throw e; });
      await ready;
      await queue.catch(() => {});
      return readList();
    },
    save(list) {
      const run = async () => {
        if (!ready) ready = init().catch((e) => { ready = null; throw e; });
        await ready;
        // Make sure `written` reflects disk before diffing (first save after launch).
        if (writtenIndex == null && written.size === 0) await readList();
        await writeList(list);
      };
      const p = queue.then(run, run);
      queue = p.catch(() => {});
      return p;
    },
  };
}
