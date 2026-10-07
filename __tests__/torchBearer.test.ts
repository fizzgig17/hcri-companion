import { TbReassembler, tbToMeterResult, isTorchBearerName } from '../src/ble/torchBearer';

// Builds the exact packets the ESP32 bridge firmware sends (see README in tobes-esp32).
function packets(vals: number[], startNm: number, chunk: number, exposureMs = 38.4, status = 0): Uint8Array[] {
  const out: Uint8Array[] = [];
  const s = new DataView(new ArrayBuffer(21));
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
