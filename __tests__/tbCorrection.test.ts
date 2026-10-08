import { applyTbCorrection, setTbCorrectionEnabled, isTbCorrectionEnabled } from '../src/ble/tbCorrection';
import { tbToMeterResult } from '../src/ble/torchBearer';

const flat = (start: number, end: number) => {
  const s: { nm: number; value: number }[] = [];
  for (let nm = start; nm <= end; nm++) s.push({ nm, value: 1 });
  return s;
};

describe('Torch Bearer spectral correction', () => {
  afterEach(() => setTbCorrectionEnabled(true));

  it('defaults to on', () => {
    expect(isTbCorrectionEnabled()).toBe(true);
  });

  it('scales each wavelength and does not modify the input', () => {
    const input = flat(340, 1000);
    const out = applyTbCorrection(input);
    expect(out).toHaveLength(661);
    expect(input[100].value).toBe(1); // untouched
    expect(out[0].value).toBeCloseTo(1.065, 2); // 340 nm
    expect(out[440 - 340].value).toBeCloseTo(0.88, 1); // blue is pulled down
    expect(out[580 - 340].value).toBeGreaterThan(1.05); // amber is lifted
  });

  it('passes wavelengths outside the table through unchanged', () => {
    const out = applyTbCorrection([{ nm: 300, value: 2 }, { nm: 1100, value: 3 }]);
    expect(out[0].value).toBe(2);
    expect(out[1].value).toBe(3);
  });

  it('tbToMeterResult marks and applies the correction only when enabled', () => {
    const scan = {
      summary: { status: 0, peakNm: 600, exposureMs: 10, peakValue: 1, sum: 1, npts: 661, startNm: 340 },
      spectrum: flat(340, 1000),
    };
    setTbCorrectionEnabled(true);
    const on = tbToMeterResult(scan, 'Torch Bearer');
    expect(on.tbCorrected).toBe(true);
    expect(on.spectrum[440 - 340].value).toBeLessThan(1);
    setTbCorrectionEnabled(false);
    const off = tbToMeterResult(scan, 'Torch Bearer');
    expect(off.tbCorrected).toBe(false);
    expect(off.spectrum[440 - 340].value).toBe(1);
  });
});
