// src/utils/runtimeGrid.ts
//
// Grid spacing for the output-over-time charts (see components/RuntimeChart.tsx). Kept free of React Native imports so it
// can be unit tested.

const GRID_NICE = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000];

/**
 * Spacing of the horizontal grid lines and tick marks: every 100 lumens. A chart that would have fewer than three or more
 * than thirty lines at 100 (a dim light, or a very bright one) gets the nearest round spacing instead, so it never turns
 * into a solid block of lines.
 */
export function gridStep(yMax: number): number {
  const n = yMax / 100;
  if (n >= 3 && n <= 30) return 100;
  if (yMax < 300) {
    for (let i = GRID_NICE.length - 1; i >= 0; i--) if (GRID_NICE[i] <= yMax / 4 + 1e-9) return GRID_NICE[i];
    return GRID_NICE[0];
  }
  return GRID_NICE.find((k) => yMax / k <= 30) ?? GRID_NICE[GRID_NICE.length - 1];
}

/** Every how many grid lines gets a number, so the numbers are never closer than about 24 px. */
export function gridLabelEvery(pxPerStep: number): number {
  const need = Math.ceil(24 / Math.max(1, pxPerStep));
  return [1, 2, 5, 10, 20].find((k) => k >= need) ?? 20;
}
