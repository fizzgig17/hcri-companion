// Bakes the CIE 1931 horseshoe background as a static PNG, using hCRI.io's
// own per-pixel technique (see spd/assets/app.js: function L() draws into an
// offscreen canvas with getImageData/putImageData, masked to the horseshoe
// polygon via a point-in-polygon test, coloring each pixel with function
// ee(x,y) -- xyY -> linear sRGB via the CIE XYZ matrix, out-of-gamut colors
// desaturated by shifting the most-negative channel to 0, then normalized so
// the brightest channel hits 1 before gamma encoding). That's a genuine
// per-pixel raster, not a small number of gradient-filled triangles fanned
// from a shared center -- which is exactly why it never shows seams, cracks,
// or a washed-out interior the way this app's old SVG-triangle-fan fill did.
//
// Since the horseshoe's shape and colors never depend on any particular
// reading (only the Planckian curve, ticks, and the reading's own dot do),
// this is baked ONCE, at build time, into a static asset -- there's no need
// to redo a per-pixel raster on-device every time the chart mounts.

const fs = require('fs');
const { PNG } = require('pngjs')
// Run with: node scripts/bakeCieChart.js  (needs `npm install pngjs` -- it's a
// dev-time-only tool, not a runtime dependency of the app itself);

// ---- Exact CIE 1931 2-degree CMF tables, 380-780nm, 5nm steps (81 values
// each) -- verbatim from src/utils/spectralAnalysis.ts, itself ported
// verbatim from hCRI.io's own spd.php. ----
const CMF_X = [0.001368,0.002236,0.004243,0.007650,0.014310,0.023190,0.043510,0.077630,0.134380,0.214770,0.283900,0.328500,0.348280,0.348060,0.336200,0.318700,0.290800,0.251100,0.195360,0.142100,0.095640,0.057950,0.032010,0.014700,0.004900,0.002400,0.009300,0.029100,0.063270,0.109600,0.165500,0.225750,0.290400,0.359700,0.433450,0.512050,0.594500,0.678400,0.762100,0.842500,0.916300,0.978600,1.026300,1.056700,1.062200,1.045600,1.002600,0.938400,0.854450,0.751400,0.642400,0.541900,0.447900,0.360800,0.283500,0.218700,0.164900,0.121200,0.087400,0.063600,0.046770,0.032900,0.022700,0.015840,0.011359,0.008111,0.005790,0.004109,0.002899,0.002049,0.001440,0.001000,0.000690,0.000476,0.000332,0.000235,0.000166,0.000117,0.000083,0.000059,0.000042];
const CMF_Y = [0.000039,0.000064,0.000120,0.000217,0.000396,0.000640,0.001210,0.002180,0.004000,0.007300,0.011600,0.016840,0.023000,0.029800,0.038000,0.048000,0.060000,0.073900,0.090980,0.112600,0.139020,0.169300,0.208020,0.258600,0.323000,0.407300,0.503000,0.608200,0.710000,0.793200,0.862000,0.914850,0.954000,0.980300,0.994950,1.000000,0.995000,0.978600,0.952000,0.915400,0.870000,0.816300,0.757000,0.694900,0.631000,0.566800,0.503000,0.441200,0.381000,0.321000,0.265000,0.217000,0.175000,0.138200,0.107000,0.081600,0.061000,0.044580,0.032000,0.023200,0.017000,0.011920,0.008210,0.005723,0.004102,0.002929,0.002091,0.001484,0.001047,0.000740,0.000520,0.000361,0.000249,0.000172,0.000120,0.000085,0.000060,0.000042,0.000030,0.000021,0.000015];
const CMF_Z = [0.006450,0.010550,0.020050,0.036210,0.067850,0.110200,0.207400,0.371300,0.645600,1.039050,1.385600,1.622960,1.747060,1.782600,1.772110,1.744100,1.669200,1.528100,1.287640,1.041900,0.812950,0.616200,0.465180,0.353300,0.272000,0.212300,0.158200,0.111700,0.078250,0.057250,0.042160,0.029840,0.020300,0.013400,0.008750,0.005750,0.003900,0.002750,0.002100,0.001800,0.001650,0.001400,0.001100,0.001000,0.000800,0.000600,0.000340,0.000240,0.000190,0.000100,0.000050,0.000030,0.000020,0.000010,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000];

const locus = [];
for (let i = 0; i < 81; i++) {
  const X = CMF_X[i], Y = CMF_Y[i], Z = CMF_Z[i];
  const s = X + Y + Z;
  locus.push({ nm: 380 + i * 5, x: s > 0 ? X / s : 1 / 3, y: s > 0 ? Y / s : 1 / 3 });
}

// hCRI.io's own xy -> sRGB function, verbatim (app.js, function ee(e,t)):
// Y is implicitly 1 (relative luminance doesn't matter for a chromaticity
// diagram's fill -- every point is rendered at "as bright as it can be
// while staying in gamut", not at any particular real luminance).
function xyToSrgb(x, y) {
  if (y < 1e-8) return [30, 0, 50];
  const X = (x * 1) / y;
  const Z = ((1 - x - y) * 1) / y;
  let r = 3.2404542 * X - 1.5371385 * 1 - 0.4985314 * Z;
  let g = -0.969266 * X + 1.8760108 * 1 + 0.041556 * Z;
  let b = 0.0556434 * X - 0.2040259 * 1 + 1.0572252 * Z;
  const m = Math.min(r, g, b);
  if (m < 0) { r -= m; g -= m; b -= m; }
  const M = Math.max(r, g, b, 1e-6);
  r /= M; g /= M; b /= M;
  const gamma = (v) => (v > 0.0031308 ? 1.055 * v ** (1 / 2.4) - 0.055 : 12.92 * v);
  const clamp = (v) => Math.max(0, Math.min(1, v));
  return [
    Math.round(gamma(clamp(r)) * 255),
    Math.round(gamma(clamp(g)) * 255),
    Math.round(gamma(clamp(b)) * 255),
  ];
}

// Boundary polygon for the point-in-polygon mask: the full real locus,
// 380-780nm, closed back to its own start with the line of purples (the
// straight chord no single wavelength produces). Using the FULL locus here
// (not capped at 700 the way the chart's on-screen label set is) is
// deliberate and safe: this only feeds a point-in-polygon test for a raster
// mask, not a shared-center triangle fan, so the sub-degree jitter in the
// near-converged 700-780nm tail just wobbles the mask edge by a fraction of
// a pixel -- invisible -- rather than tearing visible triangles the way it
// did in the old fan-fill approach.
const poly = locus.map((p) => [p.x, p.y]);

function pointInPolygon(px, py) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    const intersect = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

// Domain matches ChromaticityChart.tsx's X_DOMAIN/Y_DOMAIN exactly, so this
// raster can be stretched directly over the chart's plot box with no
// distortion and no re-deriving of any mapping math on-device.
const X_DOMAIN = [0.0, 0.8];
const Y_DOMAIN = [0.0, 0.9];
const SCALE = 640; // px per unit x-domain -- 640x720 output, ~2x a typical 320-wide chart for a crisp look on high-DPI phones without an oversized asset.
const W = Math.round((X_DOMAIN[1] - X_DOMAIN[0]) * SCALE);
const H = Math.round((Y_DOMAIN[1] - Y_DOMAIN[0]) * SCALE);

// 3x3 supersampling per output pixel -- hCRI.io's own version skips this
// (it downsamples for animation-frame performance, since it re-rasterizes
// on every report load), but this is baked once, offline, so there's no
// reason not to spend the extra cycles on smooth, anti-aliased edges rather
// than a hard-jagged polygon mask.
const SS = 3;
const png = new PNG({ width: W, height: H });
for (let py = 0; py < H; py++) {
  for (let px = 0; px < W; px++) {
    const idx = (H - 1 - py) * W + px; // flip vertically: image row 0 = top = y-domain max
    let rSum = 0, gSum = 0, bSum = 0, coverage = 0;
    for (let sy = 0; sy < SS; sy++) {
      for (let sx = 0; sx < SS; sx++) {
        const x = X_DOMAIN[0] + (px + (sx + 0.5) / SS) / W * (X_DOMAIN[1] - X_DOMAIN[0]);
        const y = Y_DOMAIN[0] + (py + (sy + 0.5) / SS) / H * (Y_DOMAIN[1] - Y_DOMAIN[0]);
        if (pointInPolygon(x, y)) {
          const [r, g, b] = xyToSrgb(x, y);
          rSum += r; gSum += g; bSum += b;
          coverage++;
        }
      }
    }
    const o = idx * 4;
    const n = SS * SS;
    if (coverage > 0) {
      png.data[o] = Math.round(rSum / coverage);
      png.data[o + 1] = Math.round(gSum / coverage);
      png.data[o + 2] = Math.round(bSum / coverage);
      png.data[o + 3] = Math.round((coverage / n) * 255);
    } else {
      png.data[o] = 0;
      png.data[o + 1] = 0;
      png.data[o + 2] = 0;
      png.data[o + 3] = 0;
    }
  }
}

const buf = PNG.sync.write(png, { colorType: 6 });
const outPath = require('path').join(__dirname, '..', 'src', 'assets', 'cie1931_fill.png');
fs.writeFileSync(outPath, buf);
console.log('wrote', outPath, '--', buf.length, 'bytes,', W, 'x', H);
