import { bridgeSimCommandB64, parseBridgeButton, bridgeButtonText } from '../src/ble/bridgeSim';

describe('bridge simulation', () => {
  it('builds command 07 <kind>', () => {
    expect(bridgeSimCommandB64(0)).toBe('BwA=');
    expect(bridgeSimCommandB64(1)).toBe('BwE=');
    expect(bridgeSimCommandB64(2)).toBe('BwI=');
    expect(bridgeSimCommandB64(3)).toBe('BwM=');
  });

  it('parses a button press and release', () => {
    const down = parseBridgeButton(new Uint8Array([7, 1, 1, 0, 0, 0, 0, 0, 0]));
    expect(down).toMatchObject({ button: 'top', pressed: true, heldMs: 0 });
    expect(bridgeButtonText(down!)).toBe('Top button pressed');
    const up = parseBridgeButton(new Uint8Array([7, 2, 0, 1, 2, 3, 4, 0xd2, 0x04]));
    expect(up).toMatchObject({ button: 'bottom', pressed: false, heldMs: 1234 });
    expect(bridgeButtonText(up!)).toBe('Bottom button released (held 1.2 s)');
  });

  it('ignores anything else', () => {
    expect(parseBridgeButton(new Uint8Array([6, 1, 1]))).toBeNull();
    expect(parseBridgeButton(new Uint8Array([7, 3, 1]))).toBeNull();
    expect(parseBridgeButton(new Uint8Array([7]))).toBeNull();
  });
});
