// Sync of a light: create on the server, upload only readings without a report, link + order, read back.
let mockStore: string | null = null;
jest.mock('@react-native-async-storage/async-storage', () => ({ __esModule: true, default: { getItem: jest.fn(async () => mockStore), setItem: jest.fn(async (_k: string, v: string) => { mockStore = v; }) } }));

let mockHistory: any[] = [];
const mockUploads: string[] = [];
let mockFailUpload = false;
jest.mock('../src/storage/readingHistory', () => ({
  loadHistory: async () => mockHistory,
  setReadingReportLink: async (id: string, reportId: string) => { mockHistory = mockHistory.map((h) => (h.id === id ? { ...h, reportId } : h)); },
}));
jest.mock('../src/storage/secureStorage', () => ({ loadHcriCredentials: async () => ({ username: 'u', token: 'hcri_x' }) }));
jest.mock('../src/hcri/buildCsv', () => ({ buildCsv: () => 'csv' }));
jest.mock('../src/hcri/uploadFlickerToHcri', () => ({
  uploadReadingToHcri: async (_r: any, _c: string, label: string) => {
    if (mockFailUpload) return { success: false, message: 'offline' }; mockUploads.push(label); return { success: true, message: 'ok', reportId: `R${mockUploads.length}`, isPublic: false }; },
}));
const mockCalls: string[] = [];
jest.mock('../src/hcri/lightsApi', () => {
  const ok = (data: any) => ({ ok: true, data });
  const light = (readings: any[] = []) => ({ id: 7, name: 'L', notes: '', categories: {}, isPublic: false, count: readings.length, stats: {}, series: {}, readings });
  return {
    LIGHT_KINDS: ['light_brand', 'light_model', 'led_brand', 'led_model', 'led_cct', 'optic'],
    createServerLight: async () => { mockCalls.push('create'); return ok(light()); },
    patchServerLight: async () => { mockCalls.push('patch'); return ok(light()); },
    setServerCategories: async (_t: string, _i: number, k: string, v: string[]) => { mockCalls.push(`cat:${k}=${v.join('|')}`); return ok({}); },
    attachServerReports: async (_t: string, _i: number, ids: string[]) => { mockCalls.push(`attach:${ids.join(',')}`); return ok({ added: ids.length, light: light(ids.map((id) => ({ id }))) }); },
    orderServerReports: async (_t: string, _i: number, ids: string[]) => { mockCalls.push(`order:${ids.join(',')}`); return ok(light()); },
    removeServerReport: async (_t: string, _i: number, id: string) => { mockCalls.push(`remove:${id}`); return ok({}); },
    getServerLight: async () => { mockCalls.push('get'); return ok(light([{ id: 'R1' }, { id: 'old' }])); },
    listServerLights: async () => ok([]),
  };
});

import { syncLight } from '../src/hcri/lightsSync';
import { createLocalLight, loadLights, patchLight, saveLights } from '../src/storage/lightsStore';

beforeEach(async () => { mockFailUpload = false; mockStore = null; await saveLights([]); mockCalls.length = 0; mockUploads.length = 0; mockHistory = [
  { id: 'a', label: 'A', result: {}, reportId: 'OLD1' },
  { id: 'b', label: 'B', result: {} },
]; });

it('creates the light, uploads only readings with no report, links in phone order, reads back', async () => {
  const l = await createLocalLight('Test', '', ['b', 'a']);
  await patchLight(l.id, () => ({ cats: { light_brand: ['Convoy'], led_brand: ['Nichia', 'Cree'] } }));
  const r = await syncLight(l.id);
  expect(r.ok).toBe(true);
  expect(r.uploaded).toBe(1);
  expect(mockUploads).toEqual(['B']);                       // 'a' already had a report
  expect(mockCalls[0]).toBe('create');
  expect(mockCalls).toContain('cat:light_brand=Convoy');
  expect(mockCalls).toContain('cat:led_brand=Nichia|Cree');
  expect(mockCalls).toContain('attach:R1,OLD1');            // phone order: b (new R1) then a (OLD1)
  expect(mockCalls).toContain('order:R1,OLD1');
  const saved = (await loadLights())[0];
  expect(saved.serverId).toBe(7);
  expect(saved.dirty).toBe(false);
  expect(saved.server?.count).toBe(2);
});

it('takes removed readings off the server light and does not recreate an existing light', async () => {
  const l = await createLocalLight('Test', '', ['a']);
  await syncLight(l.id);
  mockCalls.length = 0;
  await patchLight(l.id, () => ({ readingIds: [], removedReportIds: ['OLD1'], notes: 'n' }));
  await syncLight(l.id);
  expect(mockCalls).not.toContain('create');
  expect(mockCalls).toContain('patch');
  expect(mockCalls).toContain('remove:OLD1');
});

it('keeps the light dirty when a reading fails to upload', async () => {
  const l = await createLocalLight('X', '', ['b']);
  mockFailUpload = true;
  const r = await syncLight(l.id);
  expect(r.ok).toBe(false);
  expect(r.failedReadings).toBe(1);
  expect((await loadLights()).find((x) => x.id === l.id)?.dirty).toBe(true);
});
