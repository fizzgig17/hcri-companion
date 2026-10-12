// src/chartGrid.ts
//
// The pure geometry/ordering behind SpectrumGrid (kept free of React Native so it can be unit tested).

export type ChartId = 'spectrum' | 'cie' | 'rvalues' | 'flicker';
/** The order the small charts keep, whichever one is big. */
export const CANONICAL: ChartId[] = ['spectrum', 'cie', 'rvalues', 'flicker'];
export const CHART_IDS = new Set<string>(CANONICAL);


const GAP = 12;

export type Rect = { x: number; y: number; w: number; h: number };

/** Positions the big chart and the small ones for a region. */
export function gridRects(order: ChartId[], width: number, height: number, layout: 'landscape' | 'portrait'): Record<string, Rect> {
  const out: Record<string, Rect> = {};
  const [big, ...small] = order;
  if (!small.length) {
    out[big] = { x: 0, y: 0, w: width, h: height };
    return out;
  }
  // Exactly two charts: side by side in either orientation.
  if (layout === 'portrait' || small.length === 1) {
    const bigW = Math.round(width * 0.58);
    const colW = width - bigW - GAP;
    const cardH = (height - GAP * (small.length - 1)) / small.length;
    out[big] = { x: 0, y: 0, w: bigW, h: height };
    small.forEach((id, i) => { out[id] = { x: bigW + GAP, y: Math.round(i * (cardH + GAP)), w: colW, h: Math.round(cardH) }; });
    return out;
  }
  const lowerH = Math.max(150, Math.min(240, Math.round(height * 0.4)));
  const topH = Math.max(120, height - lowerH - GAP);
  out[big] = { x: 0, y: 0, w: width, h: topH };
  const weights: Record<ChartId, number> = { spectrum: 1.6, cie: 1, rvalues: 1.5, flicker: 1.15 };
  const totalW = width - GAP * (small.length - 1);
  const wsum = small.reduce((a, id) => a + weights[id], 0);
  let x = 0;
  small.forEach((id, i) => {
    const w = i === small.length - 1 ? width - x : Math.floor((totalW * weights[id]) / wsum);
    out[id] = { x, y: topH + GAP, w, h: lowerH };
    x += w + GAP;
  });
  return out;
}

/** The big chart, then the rest in the fixed order. */
export function chartOrder(top: ChartId, available: ChartId[]): ChartId[] {
  const t = available.includes(top) ? top : available[0];
  return [t, ...CANONICAL.filter((id) => available.includes(id) && id !== t)];
}


/** The remembered full order, limited to the charts available now (missing ones follow in the fixed order). */
export function normalizeOrder(saved: ChartId[], available: ChartId[]): ChartId[] {
  const kept = saved.filter((id, i) => available.includes(id) && saved.indexOf(id) === i);
  return [...kept, ...CANONICAL.filter((id) => available.includes(id) && !kept.includes(id))];
}

/** Puts chart `a` where `b` is and `b` where `a` was. */
export function swapCharts(order: ChartId[], a: ChartId, b: ChartId): ChartId[] {
  const i = order.indexOf(a);
  const j = order.indexOf(b);
  if (i < 0 || j < 0 || i === j) return order;
  const out = [...order];
  out[i] = b;
  out[j] = a;
  return out;
}
