import { parseTkSample, TkSmoother, TkRecorder, resampleRun, tkLumens, TK_RAW_PER_LM_DEFAULT, defaultRunLabel } from '../src/ble/tklamp';

const pkt = (ms: number, raw: number) => {
  const b = new Uint8Array(9);
  const dv = new DataView(b.buffer);
  b[0] = 6;
  dv.setUint32(1, ms, true);
  dv.setUint32(5, raw, true);
  return b;
};

describe('TKLamp live packets', () => {
  it('parses packet 06', () => {
    expect(parseTkSample(pkt(12345, 674318))).toEqual({ ms: 12345, raw: 674318 });
  });
  it('ignores other packets and short ones', () => {
    expect(parseTkSample(new Uint8Array([1, 2, 3]))).toBeNull();
    const b = pkt(1, 2);
    b[0] = 3;
    expect(parseTkSample(b)).toBeNull();
  });
  it('converts with the measured scale', () => {
    // Captured against the 2150 lm calibration lamp: 674318 raw.
    expect(Math.round(tkLumens(674318, TK_RAW_PER_LM_DEFAULT))).toBe(2153);
    expect(tkLumens(100, 0)).toBe(0);
  });
});

describe('TkSmoother', () => {
  it('averages the last n values', () => {
    const s = new TkSmoother(3);
    s.push(10);
    s.push(20);
    expect(s.push(30)).toBe(20);
    expect(s.push(40)).toBe(30);
  });
});

describe('recording and resampling', () => {
  it('bins readings into 1 s steps', () => {
    const r = new TkRecorder();
    for (let i = 0; i < 20; i++) r.add({ ms: 5000 + i * 220, raw: 313200 }, 313.2); // 1000 lm for ~4.4 s
    expect(r.count).toBe(20);
    const out = resampleRun(r.points())!;
    expect(out.intervalSeconds).toBe(1);
    expect(out.values.length).toBe(5);
    expect(out.values.every((v) => v === 1000)).toBe(true);
  });
  it('repeats the last value across a gap', () => {
    const out = resampleRun([{ t: 0, lm: 100 }, { t: 0.5, lm: 100 }, { t: 3.2, lm: 50 }])!;
    expect(out.values).toEqual([100, 100, 100, 50]);
  });
  it('widens the step for very long runs', () => {
    const out = resampleRun([{ t: 0, lm: 1 }, { t: 20000, lm: 1 }])!;
    expect(out.intervalSeconds).toBe(5);
    expect(out.values.length).toBeLessThanOrEqual(5000);
  });
  it('needs at least two points', () => {
    expect(resampleRun([{ t: 0, lm: 1 }])).toBeNull();
  });
  it('makes a readable default label', () => {
    expect(defaultRunLabel(new Date(2026, 9, 27, 9, 5))).toBe('TKLamp run 2026-10-27 09:05');
  });
});
