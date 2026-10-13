import { TbReassembler, tbToMeterResult, isTorchBearerName } from '../src/ble/torchBearer';

// Builds the exact packets the ESP32 bridge firmware sends (see README in tobes-esp32).
function packets(vals: number[], startNm: number, chunk: number, exposureMs = 38.4, status = 0): Uint8Array[] {
  const out: Uint8Array[] = [];
  const s = new DataView(new ArrayBuffer(20)); // exactly what the firmware sends: 1+1+2+4+4+4+2+2
  s.setUint8(0, 1);
  s.setUint8(1, status);
  s.setUint16(2, 534, true);
  s.setFloat32(4, exposureMs, true);
  s.setFloat32(8, 0.33, true);
  s.setFloat32(12, 98.9, true);
  s.setUint16(16, vals.length, true);
  s.setUint16(18, startNm, true);
  out.push(new Uint8Array(s.buffer));
  const total = vals.length * 4;
  const h = new DataView(new ArrayBuffer(8));
  h.setUint8(0, 2);
  h.setUint16(1, vals.length, true);
  h.setUint16(3, startNm, true);
  h.setUint8(5, 1);
  h.setUint16(6, total, true);
  out.push(new Uint8Array(h.buffer));
  const raw = new Uint8Array(total);
  const dv = new DataView(raw.buffer);
  vals.forEach((v, i) => dv.setFloat32(i * 4, v, true));
  const payload = chunk - 2;
  let seq = 0;
  for (let off = 0; off < total; off += payload, seq++) {
    const n = Math.min(payload, total - off);
    const p = new Uint8Array(n + 2);
    p[0] = 3;
    p[1] = seq;
    p.set(raw.subarray(off, off + n), 2);
    out.push(p);
  }
  out.push(new Uint8Array([4, seq]));
  return out;
}

// A smooth broadband spectrum, 340-1000 nm at 1 nm.
const vals = Array.from({ length: 661 }, (_, i) => {
  const nm = 340 + i;
  return Math.max(0, Math.exp(-((nm - 560) ** 2) / (2 * 120 ** 2)));
});

describe('Torch Bearer packets', () => {
  it('reassembles a full scan at several chunk sizes', () => {
    for (const chunk of [20, 100, 180, 240]) {
      const r = new TbReassembler();
      let scan = null;
      for (const p of packets(vals, 340, chunk)) scan = r.push(p) ?? scan;
      expect(scan).not.toBeNull();
      expect(scan!.spectrum).toHaveLength(661);
      expect(scan!.spectrum[0].nm).toBe(340);
      expect(scan!.spectrum[660].nm).toBe(1000);
      expect(scan!.spectrum[220].value).toBeCloseTo(vals[220], 5);
      expect(scan!.summary.exposureMs).toBeCloseTo(38.4, 3);
      expect(scan!.summary.peakNm).toBe(534);
    }
  });

  it('rejects a missing chunk', () => {
    const r = new TbReassembler();
    const ps = packets(vals, 340, 100);
    ps.splice(4, 1);
    expect(() => ps.forEach((p) => r.push(p))).toThrow(/out of order/);
  });

  it('converts a scan to a MeterResult with sane colour numbers', () => {
    const r = new TbReassembler();
    let scan = null;
    for (const p of packets(vals, 340, 180)) scan = r.push(p) ?? scan;
    const res = tbToMeterResult(scan!, 'Torch Bearer');
    expect(res.spectrum).toHaveLength(661);
    expect(res.cct).toBeGreaterThan(3000);
    expect(res.cct).toBeLessThan(9000);
    expect(res.rIndices).toHaveLength(15);
    expect(res.lux).toBeGreaterThan(0);
    expect(res.par).toBeGreaterThan(0);
  });

  it('matches the advertised name', () => {
    expect(isTorchBearerName('Torch Bearer')).toBe(true);
    expect(isTorchBearerName('HPCS-330P-0635249')).toBe(false);
    expect(isTorchBearerName(null)).toBe(false);
  });
});

describe('real captured packets', () => {
  it('parses the summary and header seen on a real Torch Bearer (from a debug log)', () => {
    const r = new TbReassembler();
    // 01 00 c0 01 33 33 33 3f a7 e8 cc 40 ... (20 bytes total, tail zero-filled here)
    const summary = new Uint8Array(20);
    summary.set([0x01, 0x00, 0xc0, 0x01, 0x33, 0x33, 0x33, 0x3f, 0xa7, 0xe8, 0xcc, 0x40]);
    expect(() => r.push(summary)).not.toThrow();
    // 02 95 02 54 01 01 54 0a  -> 661 points, start 340 nm, step 1, 2644 bytes
    expect(() => r.push(new Uint8Array([0x02, 0x95, 0x02, 0x54, 0x01, 0x01, 0x54, 0x0a]))).not.toThrow();
  });
});

describe('ColorMunki status', () => {
  const { parseTbStatus, munkiButtonMode, colorMunkiFailMessage, tbToMeterResult } = require('../src/ble/torchBearer');
  const status = (state: number, reason: number, kind: number, flags: number) => {
    const b = new Uint8Array(8);
    b[0] = state; b[1] = reason; b[6] = kind; b[7] = flags;
    return b;
  };

  it('reads the 6-byte status of older firmware as a Torch Bearer with no dial', () => {
    const s = parseTbStatus(new Uint8Array([0, 0, 0, 0, 0, 0]));
    expect(s.kind).toBe(0);
    expect(s.dialKnown).toBe(false);
  });

  it('decodes the dial position and calibration flag', () => {
    const s = parseTbStatus(status(0, 0, 1, 0x80 | 0x04 | 3));
    expect(s).toMatchObject({ kind: 1, dialKnown: true, dial: 3, calibrated: true });
  });

  it('shows Calibrate on the calibration position, whether or not it is calibrated', () => {
    expect(munkiButtonMode(parseTbStatus(status(0, 0, 1, 0x80 | 2)))).toEqual({ kind: 'calibrate' });
    expect(munkiButtonMode(parseTbStatus(status(0, 0, 1, 0x80 | 0x04 | 2)))).toEqual({ kind: 'calibrate' });
  });

  it('asks for a recalibration once the calibration is older than the limit', () => {
    const b = new Uint8Array(10);
    b.set(status(0, 0, 1, 0x80 | 0x04 | 3));
    b[8] = 90; b[9] = 0; // 90 minutes old when sent
    const s = parseTbStatus(b);
    expect(s.calAgeMin).toBe(90);
    expect(munkiButtonMode(s, 4, 0).kind).toBe('measure');
    expect(munkiButtonMode(s, 1, 0)).toMatchObject({ kind: 'blocked', caption: 'Recalibrate' });
    expect(munkiButtonMode(s, 0, 0).kind).toBe('measure'); // 0 = never expires
    // carried forward from the moment it was received
    const aged = { ...s, receivedAt: 0 };
    expect(munkiButtonMode(aged, 2, 20 * 60000).kind).toBe('measure'); // 110 min
    expect(munkiButtonMode(aged, 2, 40 * 60000).kind).toBe('blocked'); // 130 min
    expect(parseTbStatus(status(0, 0, 1, 0x84)).calAgeMin).toBeNull(); // old 8-byte status: unknown, never expires
  });

  it('allows a reading only on Ambient and only once calibrated', () => {
    expect(munkiButtonMode(parseTbStatus(status(0, 0, 1, 0x80 | 0x04 | 3)))).toEqual({ kind: 'measure' });
    expect(munkiButtonMode(parseTbStatus(status(0, 0, 1, 0x80 | 3))).kind).toBe('blocked');
  });

  it('blocks the button, with a note, on the other dial positions and while the dial is unknown', () => {
    for (const dial of [0, 1]) {
      const m = munkiButtonMode(parseTbStatus(status(0, 0, 1, 0x80 | 0x04 | dial)));
      expect(m.kind).toBe('blocked');
      expect((m as any).note.length).toBeGreaterThan(10);
    }
    expect(munkiButtonMode(parseTbStatus(status(0, 0, 1, 0))).kind).toBe('blocked');
  });

  it('explains why a ColorMunki reading failed', () => {
    expect(colorMunkiFailMessage(1)).toMatch(/too bright/i);
    expect(colorMunkiFailMessage(3)).toMatch(/calibrat/i);
    expect(colorMunkiFailMessage(99)).toMatch(/could not finish/i);
  });

  it('does not apply the Torch Bearer correction to a ColorMunki spectrum', () => {
    const spectrum = Array.from({ length: 351 }, (_, i) => ({ nm: 380 + i, value: 1 + Math.sin(i / 20) }));
    const r = tbToMeterResult({ summary: { status: 0, peakNm: 450, exposureMs: 50, peakValue: 2, sum: 1, npts: 351, startNm: 380 }, spectrum }, 'Torch Bearer', 1);
    expect(r.deviceName).toBe('ColorMunki');
    expect(r.meterModel).toBe('colormunki');
    expect(r.tbCorrected).toBe(false);
    expect(r.spectrum).toBe(spectrum);
  });
});
