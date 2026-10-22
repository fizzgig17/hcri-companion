import { Buffer } from 'buffer';
import { buildShareCardHtml, buildShareCardModel, pngAspect, rfLabel, rgLabel, shareCardFileName } from '../src/utils/shareCard';
import { calcTm30, interpolateSpd5nm } from '../src/utils/rfRg';

const spectrum = Array.from({ length: 401 }, (_, i) => ({ nm: 380 + i, value: 0.5 + 0.4 * Math.sin(i / 40) }));
const input: any = { spectrum, cct: 4485, duv: -0.0103, x: 0.3667, y: 0.35, ra: 93, r9: 88, title: 'Test </script> light', takenAt: 0, led: { brand: 'Acme', model: 'X1', cct: '4500K' } };
const look = { dark: true, accent: '#2fa87a', text: '#1a1a1e', dim: '#8b8b90' };

describe('share card', () => {
  it('uses the same Rf/Rg the report computes', () => {
    const m = buildShareCardModel(input, look, '1.0');
    const d = calcTm30(interpolateSpd5nm(spectrum.map((p) => p.nm), spectrum.map((p) => p.value)), input.cct);
    expect(m.Rf).toBe(d.rf);
    expect(m.Rg).toBe(d.rg);
    expect(m.bins).toHaveLength(16);
    expect(m.cvg).toHaveLength(16);
    expect(m.refVals).toHaveLength(spectrum.length);
    expect(m.cct).toBe(4485);
    expect(m.duv).toBe(-0.0103);
    expect(m.source).toBe('Acme X1 · 4500K');
  });
  it('page script parses and cannot be broken out of by the title', () => {
    const html = buildShareCardHtml(buildShareCardModel(input, look, '1.0'));
    const m = html.match(/<script>([\s\S]*)<\/script>/);
    expect(m).toBeTruthy();
    expect(html.split('</script>').length).toBe(2);
    expect(() => new Function(m![1])).not.toThrow();
  });
  it('rejects a reading with no spectrum', () => {
    expect(() => buildShareCardModel({ ...input, spectrum: [] }, look, '1.0')).toThrow();
  });
  it('reads a PNG aspect ratio', () => {
    const hdr = Buffer.alloc(24); hdr.writeUInt32BE(0x89504e47, 0); hdr.writeUInt32BE(1080, 16); hdr.writeUInt32BE(1800, 20);
    expect(pngAspect(hdr.toString('base64'))).toBeCloseTo(0.6);
    expect(pngAspect('abcd')).toBeNull();
  });
  it('labels and file names', () => {
    expect(rfLabel(95)).toBe('Excellent'); expect(rfLabel(82)).toBe('Good'); expect(rfLabel(72)).toBe('Moderate'); expect(rfLabel(50)).toBe('Low');
    expect(rgLabel(115)).toBe('Expanded'); expect(rgLabel(100)).toBe('Normal'); expect(rgLabel(90)).toBe('Compressed');
    expect(shareCardFileName('My lamp #1!')).toBe('My_lamp_1_hcri.png');
    expect(shareCardFileName('')).toBe('reading_hcri.png');
  });
});
