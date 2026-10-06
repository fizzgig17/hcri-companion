import { parseBatteryReply } from '../src/ble/protocol';

describe('parseBatteryReply', () => {
  it('reads percent and charging flag from an 8C C3 reply', () => {
    expect(parseBatteryReply(Uint8Array.from([0x8c, 0xc3, 60, 0x01]))).toEqual({ percent: 60, charging: false });
    expect(parseBatteryReply(Uint8Array.from([0x8c, 0xc3, 60, 0x00]))).toEqual({ percent: 60, charging: true });
    expect(parseBatteryReply(Uint8Array.from([0x8c, 0xc3, 100, 0x10]))).toEqual({ percent: 100, charging: true });
  });
  it('rejects malformed replies', () => {
    expect(parseBatteryReply(Uint8Array.from([0x8c, 0xc3, 60]))).toBeNull();
    expect(parseBatteryReply(Uint8Array.from([0x8c, 0x03, 60, 1]))).toBeNull();
    expect(parseBatteryReply(Uint8Array.from([0x8c, 0xc3, 200, 1]))).toBeNull();
  });
});
