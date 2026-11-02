jest.mock('@react-native-async-storage/async-storage', () => ({ __esModule: true, default: { getItem: jest.fn(), setItem: jest.fn() } }));

let mockRows: any[] = [];
const mockSynced: string[] = [];
jest.mock('../src/storage/readingHistory', () => ({
  patchReadings: async (ids: string[], fn: (r: any) => any) => {
    mockRows = mockRows.map((r) => {
      if (!ids.includes(r.id)) return r;
      const ch = fn(r);
      return ch ? { ...r, ...ch } : r;
    });
  },
}));
jest.mock('../src/hcri/ledSync', () => ({ syncLedForReading: async (id: string) => { mockSynced.push(id); return id !== 'noreport'; } }));

import { applyCategories, otherCategoriesLine, hasAnyValue, EMPTY_VALUES } from '../src/hcri/categorize';

const vals = { leds: [{ brand: 'Nichia', model: '519A', cct: '4000' }], other: { light_brand: 'Convoy', optic: '  TIR ', lumens: '' } };

beforeEach(() => {
  mockSynced.length = 0;
  mockRows = [
    { id: 'a' },
    { id: 'b', leds: [{ brand: 'Cree', model: 'XPL', cct: '5000' }], led: { brand: 'Cree', model: 'XPL', cct: '5000' }, categories: { light_brand: 'Wurkkos' } },
    { id: 'noreport' },
  ];
});

test('replace mode overwrites what a reading has and marks it unsent', async () => {
  const res = await applyCategories(['a', 'b'], vals, true);
  expect(res.changed).toBe(2);
  expect(mockRows[1].leds).toEqual([{ brand: 'Nichia', model: '519A', cct: '4000' }]);
  expect(mockRows[1].categories).toEqual({ light_brand: 'Convoy', optic: 'TIR' });
  expect(mockRows[1].ledSynced).toBe(false);
  expect(mockRows[1].catSynced).toBe(false);
  expect(mockSynced).toEqual(['a', 'b']);
});

test('fill-only mode leaves existing values alone and fills the gaps', async () => {
  const res = await applyCategories(['a', 'b'], vals, false);
  expect(res.changed).toBe(2);
  expect(mockRows[0].categories).toEqual({ light_brand: 'Convoy', optic: 'TIR' });
  expect(mockRows[1].leds[0].brand).toBe('Cree');                       // already had LEDs
  expect(mockRows[1].categories).toEqual({ light_brand: 'Wurkkos', optic: 'TIR' });   // kept its brand, got the optic
});

test('a reading that would not change is skipped, and blank fields are never applied', async () => {
  mockRows = [{ id: 'b', leds: [{ brand: 'Cree', model: 'XPL', cct: '5000' }], categories: { light_brand: 'Wurkkos' } }];
  const res = await applyCategories(['b'], { leds: vals.leds, other: { light_brand: 'Convoy' } }, false);
  expect(res).toEqual({ changed: 0, skipped: 1, pendingSend: 0 });
  expect(mockSynced).toEqual([]);
  const blank = await applyCategories(['b'], { leds: [], other: { optic: '   ' } }, true);
  expect(blank.changed).toBe(0);
});

test('readings without a report on hCRI.io count as pending to send', async () => {
  const res = await applyCategories(['noreport'], vals, true);
  expect(res).toEqual({ changed: 1, skipped: 0, pendingSend: 1 });
});

test('helpers', () => {
  expect(hasAnyValue(EMPTY_VALUES)).toBe(false);
  expect(hasAnyValue(vals)).toBe(true);
  expect(otherCategoriesLine({ categories: { light_brand: 'Convoy', light_model: 'S2+', optic: 'TIR', lumens: '800', current: '1.5' } })).toBe('Convoy S2+ · TIR · 800 lm · 1.5 A');
  expect(otherCategoriesLine({})).toBe('');
});
