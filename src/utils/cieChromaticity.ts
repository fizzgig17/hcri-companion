// src/utils/cieChromaticity.ts
//
// Pure math for drawing a CIE 1931 chromaticity diagram: the horseshoe-
// shaped "spectral locus" (the outer boundary of all visible color), and
// the "Planckian locus" (the blackbody curve that CCT is measured against,
// with the little perpendicular tick marks at round CCT values you see on
// the vendor app's chart). No lookup tables of measured data -- both curves
// are computed from well-known closed-form approximations, so this file is
// small and has no external data file to keep in sync.

/**
 * Approximates the CIE 1931 2-degree standard observer color matching
 * functions (x̄, ȳ, z̄) at a given wavelength, using the multi-lobe Gaussian
 * fit from Wyman, Sloan & Shirley, "Simple Analytic Approximations to the
 * CIE XYZ Color Matching Functions" (JCGT 2013). This is a widely-used
 * closed-form stand-in for the CIE's own tabulated data -- accurate enough
 * to draw the locus shape correctly, without needing to embed a 400+ row
 * table of measured values.
 */
function gaussianLobe(x: number, mu: number, sigma1: number, sigma2: number): number {
  const sigma = x < mu ? sigma1 : sigma2;
  const t = (x - mu) / sigma;
  return Math.exp(-0.5 * t * t);
}

export interface XYZ {
  x: number;
  y: number;
  z: number;
}

export function cieColorMatch(wavelengthNm: number): XYZ {
  const w = wavelengthNm;
  const xBar =
    1.056 * gaussianLobe(w, 599.8, 37.9, 31.0) +
    0.362 * gaussianLobe(w, 442.0, 16.0, 26.7) -
    0.065 * gaussianLobe(w, 501.1, 20.4, 26.2);
  const yBar = 0.821 * gaussianLobe(w, 568.8, 46.9, 40.5) + 0.286 * gaussianLobe(w, 530.9, 16.3, 31.1);
  const zBar = 1.217 * gaussianLobe(w, 437.0, 11.8, 36.0) + 0.681 * gaussianLobe(w, 459.0, 26.0, 13.8);
  return { x: xBar, y: yBar, z: zBar };
}

export interface XY {
  x: number;
  y: number;
}

function xyzToXy({ x, y, z }: XYZ): XY {
  const sum = x + y + z;
  if (sum <= 0) return { x: 0, y: 0 };
  return { x: x / sum, y: y / sum };
}

/**
 * The spectral locus: xy chromaticity of a pure single wavelength, swept
 * across the visible range. Plotting these points in order and closing the
 * bottom edge with a straight line back from violet to red (the
 * "line of purples" -- there's no single wavelength for magenta/purple,
 * it only exists as a mix of the two spectral extremes) reproduces the
 * familiar horseshoe outline.
 */
export function spectralLocus(stepNm = 2, fromNm = 380, toNm = 700): XY[] {
  const points: XY[] = [];
  for (let w = fromNm; w <= toNm; w += stepNm) {
    points.push(xyzToXy(cieColorMatch(w)));
  }
  return points;
}

/**
 * The Planckian (blackbody) locus: xy chromaticity of an ideal thermal
 * radiator at temperature T (Kelvin). Uses Kim et al.'s cubic-spline
 * approximation (1998), the standard closed-form fit for this curve --
 * accurate to within the width of the line it'd be drawn with, over the
 * whole practical lighting range (1667K-25000K).
 */
export function planckianLocusXy(tKelvin: number): XY {
  const T = tKelvin;
  let x: number;
  if (T >= 1667 && T <= 4000) {
    x =
      -0.2661239e9 / (T * T * T) -
      0.2343589e6 / (T * T) +
      0.8776956e3 / T +
      0.17991;
  } else {
    x =
      -3.0258469e9 / (T * T * T) +
      2.1070379e6 / (T * T) +
      0.2226347e3 / T +
      0.24039;
  }

  let y: number;
  if (T >= 1667 && T <= 2222) {
    y = -1.1063814 * x ** 3 - 1.3481102 * x ** 2 + 2.18555832 * x - 0.20219683;
  } else if (T > 2222 && T <= 4000) {
    y = -0.9549476 * x ** 3 - 1.37418593 * x ** 2 + 2.09137015 * x - 0.16748867;
  } else {
    y = 3.081758 * x ** 3 - 5.8733867 * x ** 2 + 3.75112997 * x - 0.37001483;
  }

  return { x, y };
}

/**
 * Chromaticity (x, y) integrated directly from a measured spectrum, using
 * the same CIE 2-degree color matching functions as the spectral locus
 * above. This is deliberately the *same approach hCRI.io itself uses* --
 * hCRI.io only ever receives the raw wavelength/value spectrum (see
 * buildCsv.ts) and derives x/y/CCT/Duv/etc. from that alone, never from the
 * device's own onboard x/y/CCT fields. Doing the identical integration here
 * means the on-device Chrom tab shows the same point hCRI.io will end up
 * showing for the same reading, and -- just as importantly -- it's immune
 * to any remaining bug in a model's x/y/cct field OFFSETS, since it never
 * reads those fields at all. A plain per-point (Riemann) sum is accurate
 * enough here: consecutive spectrum points are 1nm apart, well within the
 * ~5-10nm scale the CIE matching functions vary over.
 */
export function xyFromSpectrum(spectrum: { nm: number; value: number }[]): XY {
  let X = 0;
  let Y = 0;
  let Z = 0;
  for (const p of spectrum) {
    const cm = cieColorMatch(p.nm);
    X += cm.x * p.value;
    Y += cm.y * p.value;
    Z += cm.z * p.value;
  }
  const sum = X + Y + Z;
  if (sum <= 0) return { x: 0, y: 0 };
  return { x: X / sum, y: Y / sum };
}

/**
 * Correlated color temperature from an (x, y) chromaticity point, via
 * McCamy's cubic approximation (1992) -- the standard closed-form CCT
 * estimate, accurate to a few K in the 2500K-10000K range this meter cares
 * about. Computed here (rather than trusting the device's own CCT field)
 * for the same reason as xyFromSpectrum above: it only depends on x/y,
 * which are themselves now derived straight from the spectrum.
 */
export function cctFromXy(xy: XY): number {
  const n = (xy.x - 0.332) / (0.1858 - xy.y);
  return 437 * n ** 3 + 3601 * n ** 2 + 6861 * n + 5517;
}

/**
 * Duv: signed distance from an (x, y) point to the Planckian locus, in the
 * perceptually-uniform CIE 1960 u/v space (not raw xy) -- the standard
 * space Duv is defined in. Positive above the locus (greenish), negative
 * below (pinkish/magenta), matching the sign convention used elsewhere in
 * this codebase (see the u'==u, v'==1.5*v note in protocol.ts). Found by a
 * coarse search over the locus for the closest point, then refined with the
 * local tangent to get a sign and a slightly better distance -- overkill
 * precision isn't needed here since this is a display-only value, not
 * something re-derived by hCRI.io (which computes its own Duv from the
 * uploaded spectrum independently).
 */
function xyToUv(xy: XY): XY {
  const denom = -2 * xy.x + 12 * xy.y + 3;
  return { x: (4 * xy.x) / denom, y: (6 * xy.y) / denom };
}

export function duvFromXy(xy: XY): number {
  const uv = xyToUv(xy);
  let bestDist = Infinity;
  let bestT = 5000;
  for (let t = 1000; t <= 20000; t += 25) {
    const p = xyToUv(planckianLocusXy(t));
    const d = Math.hypot(uv.x - p.x, uv.y - p.y);
    if (d < bestDist) {
      bestDist = d;
      bestT = t;
    }
  }
  const p0 = xyToUv(planckianLocusXy(bestT - 5));
  const p1 = xyToUv(planckianLocusXy(bestT + 5));
  // Cross product of the locus tangent with the vector to our point tells
  // us which side (sign) we're on.
  const tx = p1.x - p0.x;
  const ty = p1.y - p0.y;
  const cross = tx * (uv.y - p0.y) - ty * (uv.x - p0.x);
  return Math.sign(cross) * bestDist;
}

/** CCT tick values to mark along the blackbody curve, matching the vendor app's chart (2k through 10k, denser at the low/warm end where the curve bends more sharply). */
export const CCT_TICKS_K = [2000, 2500, 3000, 3500, 4000, 4500, 5000, 6000, 7000, 10000];

/**
 * A short perpendicular tick segment across the Planckian locus at
 * temperature T -- the little crosshatch marks the vendor chart draws at
 * each round CCT value. Direction is estimated from the curve's local
 * tangent (a tiny finite-difference step), then rotated 90 degrees.
 */
export function planckianTick(tKelvin: number, halfLengthXy = 0.01): [XY, XY] {
  const p0 = planckianLocusXy(tKelvin - 10);
  const p1 = planckianLocusXy(tKelvin + 10);
  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;
  const len = Math.hypot(dx, dy) || 1;
  // Perpendicular unit vector.
  const nx = -dy / len;
  const ny = dx / len;
  const center = planckianLocusXy(tKelvin);
  return [
    { x: center.x - nx * halfLengthXy, y: center.y - ny * halfLengthXy },
    { x: center.x + nx * halfLengthXy, y: center.y + ny * halfLengthXy },
  ];
}
