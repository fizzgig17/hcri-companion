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

import { bridgeAttachedFromAdv } from '../src/ble/meterLabel';

describe('bridgeAttachedFromAdv', () => {
  const b64 = (b: number[]) => ({ '255,255,104,67,0': '//9oQwA=', '255,255,104,67,1': '//9oQwE=', '255,255,104,67,2': '//9oQwI=', '76,0,1,2,3': 'TAABAgM=' } as Record<string, string>)[b.join(',')];
  it('reads the attached byte', () => {
    expect(bridgeAttachedFromAdv(b64([0xff, 0xff, 0x68, 0x43, 0]))).toBe('none');
    expect(bridgeAttachedFromAdv(b64([0xff, 0xff, 0x68, 0x43, 1]))).toBe('Torch Bearer');
    expect(bridgeAttachedFromAdv(b64([0xff, 0xff, 0x68, 0x43, 2]))).toBe('ColorMunki');
  });
  it('returns null for missing or foreign data (old firmware)', () => {
    expect(bridgeAttachedFromAdv(null)).toBeNull();
    expect(bridgeAttachedFromAdv(b64([0x4c, 0x00, 1, 2, 3]))).toBeNull();
  });
});

describe('bridge with a TKLamp tester', () => {
  it('reads attached = 3 from the advertisement', () => {
    // FF FF 'h' 'C' 03 -> base64
    const b64 = '//9oQwM=';
    expect(bridgeAttachedFromAdv(b64)).toBe('TKLamp');
  });
});
