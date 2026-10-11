import { chartOrder, gridRects } from '../src/chartGrid';

const ALL = ['spectrum', 'cie', 'rvalues', 'flicker'] as const;

describe('chartOrder', () => {
  const av = [...ALL];
  test('default: spectrum big, then CIE, bars, flicker', () => {
    expect(chartOrder('spectrum', av)).toEqual(['spectrum', 'cie', 'rvalues', 'flicker']);
  });
  test('bar chart up: bars big, then spectrum, CIE, flicker', () => {
    expect(chartOrder('rvalues', av)).toEqual(['rvalues', 'spectrum', 'cie', 'flicker']);
  });
  test('CIE up (after bars): CIE big, then spectrum, bars, flicker', () => {
    expect(chartOrder('cie', av)).toEqual(['cie', 'spectrum', 'rvalues', 'flicker']);
  });
  test('flicker up: flicker big, then spectrum, CIE, bars', () => {
    expect(chartOrder('flicker', av)).toEqual(['flicker', 'spectrum', 'cie', 'rvalues']);
  });
  test('flicker saved but not available falls back to the first chart', () => {
    expect(chartOrder('flicker', ['spectrum', 'cie', 'rvalues'])).toEqual(['spectrum', 'cie', 'rvalues']);
  });
});

describe('gridRects', () => {
  test('landscape: big on top, small ones fill the row without overlap', () => {
    const r = gridRects(chartOrder('spectrum', [...ALL]), 1000, 600, 'landscape');
    expect(r.spectrum).toMatchObject({ x: 0, y: 0, w: 1000 });
    const row = ['cie', 'rvalues', 'flicker'].map((k) => r[k]);
    expect(row[0].y).toBeGreaterThan(r.spectrum.h);
    expect(row[2].x + row[2].w).toBe(1000);
    expect(row[0].x + row[0].w).toBeLessThan(row[1].x);
  });
  test('portrait: big on the left, small ones stacked on the right', () => {
    const r = gridRects(chartOrder('cie', [...ALL]), 800, 600, 'portrait');
    expect(r.cie).toMatchObject({ x: 0, y: 0, h: 600 });
    expect(r.cie.w).toBeLessThan(800 * 0.7);
    const col = ['spectrum', 'rvalues', 'flicker'].map((k) => r[k]);
    col.forEach((c) => expect(c.x).toBeGreaterThanOrEqual(r.cie.w));
    expect(col[1].y).toBeGreaterThan(col[0].y);
    expect(col[2].y + col[2].h).toBeLessThanOrEqual(600);
  });
  test('only the spectrum: fills the region', () => {
    expect(gridRects(['spectrum'], 700, 400, 'portrait').spectrum).toEqual({ x: 0, y: 0, w: 700, h: 400 });
  });
});
