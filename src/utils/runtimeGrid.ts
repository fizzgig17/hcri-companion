// src/utils/runtimeGrid.ts
//
// Grid spacing for the output-over-time charts (see components/RuntimeChart.tsx). Kept free of React Native imports so it
// can be unit tested.


/**
 * Spacing of the finest horizontal grid lines: the smallest 1-2-5 step that keeps the chart to 30 lines or fewer. That is 50 lm
 * for a light up to 1500 lm, 100 lm up to 3000 lm, 200 up to 6000, and so on; dim lights get finer lines (10, 20 ...).
 */
export function gridStep(yMax: number): number {
  if (!(yMax > 0)) return 1;
  const need = yMax / 30;
  const k = Math.pow(10, Math.floor(Math.log10(need)));
  for (const m of [1, 2, 5, 10]) if (m * k >= need - 1e-12) return +(m * k).toPrecision(6);
  return 10 * k;
}

export type GridLevel = { level: 0 | 1 | 3; dash: string | null; opacity: number };

/**
 * How a grid line looks, so the eye can read the chart without numbers. With H the round "hundred" for this chart (100 lm for
 * most lights): the finest lines (50) are fine faint dots, every H is dotted, and every 5 H (500) is solid. (A dashed 250 line
 * was tried and dropped: on a phone it looks too much like the dotted one.) Other charts scale the same way (a 12,000 lm light: lines every 500, dotted per 1000 ...).
 */
export function gridLevel(v: number, minor: number): GridLevel {
  const H = Math.pow(10, Math.floor(Math.log10(5 * minor)));
  const is = (m: number) => Math.abs(v / m - Math.round(v / m)) < 1e-6;
  if (is(5 * H)) return { level: 3, dash: null, opacity: 0.7 };
  if (is(H)) return { level: 1, dash: '2,4', opacity: 0.45 };
  return { level: 0, dash: '1,3', opacity: 0.25 };
}

/** Every how many grid lines gets a number, so the numbers are never closer than about 24 px. */
export function gridLabelEvery(pxPerStep: number): number {
  const need = Math.ceil(24 / Math.max(1, pxPerStep));
  return [1, 2, 5, 10, 20].find((k) => k >= need) ?? 20;
}
