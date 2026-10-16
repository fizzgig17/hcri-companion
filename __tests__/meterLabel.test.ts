import { hpcsModelName, meterListLabel } from '../src/ble/meterLabel';

describe('meter labels', () => {
  it('drops the serial from HPCS names', () => {
    expect(hpcsModelName('HPCS-330P-0635249')).toBe('HPCS-330P');
    expect(hpcsModelName('HPCS-310-0326030')).toBe('HPCS-310');
    expect(hpcsModelName('HPCS330Pro')).toBe('HPCS330Pro');
    expect(hpcsModelName(null)).toBeNull();
  });
  it('labels bridges the same way connected or not', () => {
    expect(meterListLabel('hCRI Bridge', false, null)).toBe('hCRI Bridge');
    expect(meterListLabel('hCRI Bridge', false, 'Torch Bearer')).toBe('hCRI Bridge · Torch Bearer');
    expect(meterListLabel('hCRI Bridge', true, 'ColorMunki')).toBe('hCRI Bridge · ColorMunki');
    expect(meterListLabel('HPCS-330P-0635249', false, null)).toBe('HPCS-330P');
  });
});
