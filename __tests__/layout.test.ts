import { layoutModeFor, isSquareWindow, sideColumnWidth } from '../src/layout';

describe('layout', () => {
  it('detects near-square foldable windows', () => {
    expect(isSquareWindow(700, 760)).toBe(true);
    expect(isSquareWindow(900, 840)).toBe(true);
    expect(isSquareWindow(400, 900)).toBe(false);
    expect(isSquareWindow(500, 500)).toBe(false);
  });
  it('uses the dashboard for square windows and landscape tablets', () => {
    expect(layoutModeFor(900, 840)).toBe('dashboard');
    expect(layoutModeFor(1200, 800)).toBe('dashboard');
    expect(layoutModeFor(800, 1200)).toBe('stacked');
    expect(layoutModeFor(390, 844)).toBe('compact');
  });
  it('clamps the side column', () => {
    expect(sideColumnWidth(600)).toBe(300);
    expect(sideColumnWidth(1000)).toBe(340);
    expect(sideColumnWidth(2000)).toBe(420);
  });
});
