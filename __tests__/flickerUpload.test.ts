import { uploadReadingToHcri } from '../src/hcri/uploadFlickerToHcri';

const flicker: any = { frequencyHz: 120, percentFlicker: 30, flickerIndex: 0.1, cycleMs: 8.3, spanMs: 100, sampleIdx: 7, gear: 1, waveform: [1, 2, 3] };

function mockFetch(flickerStatus: number) {
  const calls: any[] = [];
  (globalThis as any).fetch = jest.fn(async (url: string, init: any) => {
    calls.push({ url, init });
    if (url.endsWith('/upload')) return { ok: true, status: 200, text: async () => JSON.stringify({ id: 42, isPublic: false }) };
    return { ok: flickerStatus < 300, status: flickerStatus, text: async () => '{}' };
  });
  return calls;
}

test('posts flicker with reportId after upload', async () => {
  const calls = mockFetch(201);
  const res = await uploadReadingToHcri({ flicker, deviceName: 'HPCS-330P' } as any, 'csv', 'L', 'tok');
  expect(res.success).toBe(true);
  const f = calls.find((c) => c.url.endsWith('/flicker'));
  const body = JSON.parse(f.init.body);
  expect(body.reportId).toBe(42);
  expect(body.settings).toEqual({ sampleIdx: 7, gear: 1 });
  expect(body.model).toBe('HPCS-330P');
});

test('flicker 404 does not fail the report upload', async () => {
  mockFetch(404);
  const res = await uploadReadingToHcri({ flicker } as any, 'csv', 'L', 'tok');
  expect(res.success).toBe(true);
});

test('no flicker call without a capture', async () => {
  const calls = mockFetch(201);
  await uploadReadingToHcri({} as any, 'csv', 'L', 'tok');
  expect(calls.length).toBe(1);
});

test('standalone flicker upload sends notes and no reportId', async () => {
  const calls = mockFetch(201);
  const { uploadFlickerToHcri } = require('../src/hcri/uploadFlickerToHcri');
  const ok = await uploadFlickerToHcri(flicker, { label: 'T', notes: 'n' }, 'tok');
  expect(ok).toBe(true);
  const body = JSON.parse(calls[0].init.body);
  expect(body.reportId).toBeUndefined();
  expect(body.notes).toBe('n');
});
