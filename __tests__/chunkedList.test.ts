jest.mock('@react-native-async-storage/async-storage', () => ({ __esModule: true, default: {} }));
import { createChunkedStore, KeyValueStore } from '../src/storage/chunkedList';

function memStore(initial: Record<string, string> = {}, failGet: (k: string) => boolean = () => false) {
  const m = new Map(Object.entries(initial));
  const writes: string[] = [];
  const s: KeyValueStore = {
    getItem: async (k) => { if (failGet(k)) throw new Error('Row too big to fit into CursorWindow'); return m.has(k) ? m.get(k)! : null; },
    setItem: async (k, v) => { writes.push(k); m.set(k, v); },
    removeItem: async (k) => { m.delete(k); },
  };
  return { m, s, writes };
}
type R = { id: string; n: number };

test('round trips and only rewrites changed records', async () => {
  const { s, writes } = memStore();
  const st = createChunkedStore<R>('b', 'old', s);
  expect(await st.load()).toEqual([]);
  await st.save([{ id: 'a', n: 1 }, { id: 'b', n: 2 }]);
  writes.length = 0;
  await st.save([{ id: 'a', n: 1 }, { id: 'b', n: 3 }]);
  expect(writes).toEqual(['b.r.b']);
  const st2 = createChunkedStore<R>('b', 'old', s);
  expect(await st2.load()).toEqual([{ id: 'a', n: 1 }, { id: 'b', n: 3 }]);
});

test('dropped records are removed', async () => {
  const { s, m } = memStore();
  const st = createChunkedStore<R>('b', 'old', s);
  await st.save([{ id: 'a', n: 1 }, { id: 'b', n: 2 }]);
  await st.save([{ id: 'b', n: 2 }]);
  expect(m.has('b.r.a')).toBe(false);
  expect(await st.load()).toEqual([{ id: 'b', n: 2 }]);
});

test('migrates the old blob, then removes it', async () => {
  const { s, m } = memStore({ old: JSON.stringify([{ id: 'x', n: 1 }, { id: 'y', n: 2 }]) });
  const st = createChunkedStore<R>('b', 'old', s);
  expect(await st.load()).toEqual([{ id: 'x', n: 1 }, { id: 'y', n: 2 }]);
  expect(m.has('old')).toBe(false);
});

test('an unreadable old blob is left alone and the list starts empty', async () => {
  const { s, m } = memStore({ old: 'x' }, (k) => k === 'old');
  const st = createChunkedStore<R>('b', 'old', s);
  expect(await st.load()).toEqual([]);
  await st.save([{ id: 'n', n: 1 }]);
  expect(m.get('old')).toBe('x');
  expect(await st.load()).toEqual([{ id: 'n', n: 1 }]);
});

test('a record that cannot be read is skipped, not fatal', async () => {
  const { s } = memStore();
  const st = createChunkedStore<R>('b', 'old', s);
  await st.save([{ id: 'a', n: 1 }, { id: 'b', n: 2 }]);
  const { m } = memStore();
  const s2 = { ...s, getItem: async (k: string) => { if (k === 'b.r.a') throw new Error('bad'); return s.getItem(k); } };
  const st2 = createChunkedStore<R>('b', 'old', s2);
  expect(await st2.load()).toEqual([{ id: 'b', n: 2 }]);
  void m;
});

test('an unreadable index makes save fail instead of overwriting', async () => {
  const { s, m } = memStore({ 'b.index': '["a"]', 'b.r.a': JSON.stringify({ id: 'a', n: 1 }) }, (k) => k === 'b.index');
  const st = createChunkedStore<R>('b', 'old', s);
  await expect(st.save([{ id: 'z', n: 9 }])).rejects.toThrow();
  expect(m.get('b.index')).toBe('["a"]');
});
