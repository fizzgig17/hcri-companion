// A new measurement saved while the previous reading's upload records its title/report link used to lose one of the two changes
// (both loaded the same list, the last save won) -- readings vanished from the app while their cloud backups were fine.
const mockMem = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    // A little latency so overlapping read-modify-writes really interleave.
    getItem: async (k: string) => { await new Promise<void>((r) => setTimeout(r, 2)); return mockMem.has(k) ? mockMem.get(k)! : null; },
    setItem: async (k: string, v: string) => { await new Promise<void>((r) => setTimeout(r, 2)); mockMem.set(k, v); },
    removeItem: async (k: string) => { mockMem.delete(k); },
    multiGet: async (ks: string[]) => ks.map((k) => [k, mockMem.has(k) ? mockMem.get(k)! : null]),
    multiSet: async (kv: [string, string][]) => { kv.forEach(([k, v]) => mockMem.set(k, v)); },
    multiRemove: async (ks: string[]) => { ks.forEach((k) => mockMem.delete(k)); },
    getAllKeys: async () => Array.from(mockMem.keys()),
  },
}));
jest.mock('react-native-keychain', () => ({}), { virtual: true });

import { addReading, loadHistory, recordUpload, renameReading, deleteReading } from '../src/storage/readingHistory';

const result: any = { deviceName: 'HPCS-330P', spectrum: Array.from({ length: 41 }, (_, i) => ({ nm: 380 + i * 10, value: 1 })) };

test('overlapping history changes never lose each other', async () => {
  const first = await addReading(result, 'one');
  // Fire a new reading, an upload record on the previous one, a rename and another reading all at once.
  const [second, , , third] = await Promise.all([
    addReading(result, 'two'),
    recordUpload(first.id, 'one (uploaded)', 'abc123', false),
    renameReading(first.id, 'one renamed'),
    addReading(result, 'three'),
  ]);
  const ids = (await loadHistory()).map((r) => r.id);
  expect(ids).toContain(first.id);
  expect(ids).toContain(second.id);
  expect(ids).toContain(third.id);
  expect(ids).toHaveLength(3);
  const f = (await loadHistory()).find((r) => r.id === first.id)!;
  expect(f.reportId).toBe('abc123');
});

test('many readings saved back to back all end up in the history', async () => {
  const before = (await loadHistory()).length;
  const saved = await Promise.all(Array.from({ length: 8 }, (_, i) => addReading(result, 'r' + i)));
  const after = await loadHistory();
  expect(after).toHaveLength(before + 8);
  await deleteReading(saved[0].id);
  expect((await loadHistory()).length).toBe(before + 7);
});
