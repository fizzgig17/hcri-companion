import { buildCsv, buildShareCsv } from '../src/hcri/buildCsv';
import type { MeterResult } from '../src/ble/parseResult';

// A smooth ~4000 K-ish spectrum, enough for the summary math to produce numbers.
const spectrum = Array.from({ length: 451 }, (_, i) => ({ nm: 350 + i, value: 1 + Math.exp(-(((350 + i) - 600) ** 2) / 20000) }));
const result = { deviceName: 'HPCS-330P', spectrum, lux: 1234.5, cct: 4100, ra: 90.2, duv: 0.001, integrationTimeMs: 5 } as unknown as MeterResult;

test('share CSV keeps the upload CSV intact and appends the summary after it', () => {
  const upload = buildCsv(result);
  const share = buildShareCsv(result);
  expect(share.startsWith(upload + '\n')).toBe(true);
  const tail = share.slice(upload.length);
  for (const k of ['CCT,', 'Duv,', 'Ra,', 'R9,', 'Lux,1234.5', 'MeterReportedCCT,4100']) expect(tail).toContain(k);
});

test('Torch Bearer readings carry no meter-reported lines', () => {
  expect(buildShareCsv({ ...result, source: 'torchbearer' } as MeterResult)).not.toContain('MeterReported');
});
