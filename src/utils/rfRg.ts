// src/utils/rfRg.ts
//
// TM-30-18 / CIE 2017 Rf (fidelity) and Rg (gamut) indices -- a line-for-line
// port of hCRI.io's api/_core/spd.php:calc_rf_rg(), following the same
// "port verbatim, don't re-derive" rule spectralAnalysis.ts documents for
// its own CCT/Duv/CRI port, so these numbers never quietly disagree with
// what hCRI.io itself computes for the identical uploaded spectrum.
//
// This needs its own, separate machinery from spectralAnalysis.ts because
// TM-30 specifically requires:
//  - the CIE 1964 10-degree observer CMFs (CMF10_X/Y/Z, cesData.ts),
//    not the 2-degree CMFs the Ra/CCT/Duv port uses;
//  - a 99-sample CES reflectance set (CES99, cesData.ts), not the 15-sample
//    CIE 13.3 TCS set;
//  - a full CIECAM02 -> CAM02-UCS (Jp,ap,bp) color appearance model, which
//    the CRI calculation doesn't need at all;
//  - 81-point, 5nm-step arrays throughout (matching spd.php's calc_rf_rg
//    itself, which operates at 5nm, unlike the "hires" 1nm CRI/CCT path).
//
// calcRfRg() exposes just Rf and Rg; calcTm30() additionally returns the
// per-bin / per-sample detail arrays (rfBins, rcsBins, rhsBins, cvgTest/cvgRef,
// rfSamples, sampleHues) that calc_rf_rg also returns, ported the same way.
// They feed the in-app TM-30 report (tm30Report.ts).

import { CMF10_X, CMF10_Y, CMF10_Z, CES99 } from '../hcri/cesData';

/** Linear interpolation onto the 81-point, 5nm-step 380-780nm grid, zero
 * outside the measured range -- matches spd.php's interpolate_spd() exactly
 * (notably NOT flat-clamped, unlike spectralAnalysis.ts's spdInterpAt(),
 * since calc_rf_rg's own reference-illuminant and white-point normalization
 * steps assume a true zero tail rather than a repeated last sample). */
export function interpolateSpd5nm(wls: number[], vals: number[]): number[] {
  const out: number[] = [];
  for (let w = 380; w <= 780; w += 5) {
    let lo = -1;
    for (let i = 0; i < wls.length - 1; i++) {
      if (wls[i] <= w && wls[i + 1] >= w) { lo = i; break; }
    }
    if (lo === -1) { out.push(0.0); continue; }
    const t = (w - wls[lo]) / (wls[lo + 1] - wls[lo]);
    out.push(vals[lo] * (1 - t) + vals[lo + 1] * t);
  }
  return out;
}

/** Planck's law at 5nm steps, 380-780nm (81 values) -- matches spd.php's blackbody_spd(). */
function blackbodySpd5nm(T: number): number[] {
  const h = 6.626e-34, c = 3e8, k = 1.381e-23;
  const out: number[] = [];
  for (let i = 0; i <= 80; i++) {
    const m = (380 + i * 5) * 1e-9;
    out.push((2 * h * c * c / m ** 5) / (Math.exp(h * c / (m * k * T)) - 1));
  }
  return out;
}

// CIE daylight S0/S1/S2 basis functions, 10nm steps, 300-830nm (54 values
// each) -- same tables spectralAnalysis.ts's daylight1nm() uses, duplicated
// here (rather than imported) because this port stays self-contained and
// matches spd.php's own file layout, where daylight_spd() carries its own
// copies too.
const DAYLIGHT_S0 = [0.04,6.0,29.6,55.3,57.3,61.8,61.5,68.8,63.4,65.8,94.8,104.8,105.9,96.8,113.9,125.6,125.5,121.3,121.3,113.5,113.1,110.8,106.5,108.8,105.3,104.4,100.0,96.0,95.1,89.1,90.5,90.3,88.4,84.0,85.1,81.9,82.6,84.9,81.3,71.9,74.3,76.4,63.3,71.7,77.0,65.2,47.7,68.6,65.0,66.0,61.0,53.3,58.9,61.9];
const DAYLIGHT_S1 = [0.02,4.5,22.4,42.0,40.6,41.6,38.0,42.4,38.5,35.0,43.4,46.3,43.9,37.1,36.7,35.9,32.6,27.9,24.3,20.1,16.2,13.2,8.6,6.1,4.2,1.9,0.0,-1.6,-3.5,-3.5,-5.8,-7.2,-8.6,-9.5,-10.9,-10.7,-12.0,-14.0,-13.6,-12.0,-13.3,-12.9,-10.6,-11.6,-12.2,-10.2,-7.8,-11.2,-10.4,-10.6,-9.7,-8.3,-9.3,-9.8];
const DAYLIGHT_S2 = [0.0,2.0,4.0,8.5,7.8,6.7,5.3,6.1,2.0,1.2,-1.1,-0.5,-0.7,-1.2,-2.6,-2.9,-2.8,-2.6,-2.6,-1.8,-1.5,-1.3,-1.2,-1.0,-0.5,-0.3,0.0,0.2,0.5,2.1,3.2,4.1,4.7,5.1,6.7,7.3,8.6,9.8,10.2,8.3,9.6,8.5,7.0,7.6,8.0,6.7,5.2,7.4,6.8,7.0,6.4,5.5,6.1,6.5];

/** CIE daylight (D-series) illuminant reconstructed from CCT, at 5nm steps,
 * 380-780nm (81 values) -- matches spd.php's daylight_spd(). CIE 13.3/TM-30
 * use this (not a Planckian) as the reference for CCT >= 5000K. */
function daylightSpd5nm(cct: number): number[] {
  const T = Math.max(4000.0, Math.min(25000.0, cct));
  const xD = T <= 7000.0
    ? -4.6070e9 / (T * T * T) + 2.9678e6 / (T * T) + 0.09911e3 / T + 0.244063
    : -2.0064e9 / (T * T * T) + 1.9018e6 / (T * T) + 0.24748e3 / T + 0.237040;
  const yD = -3.000 * xD * xD + 2.870 * xD - 0.275;
  const M = 0.0241 + 0.2562 * xD - 0.7341 * yD;
  const M1 = (-1.3515 - 1.7703 * xD + 5.9114 * yD) / M;
  const M2 = (0.0300 - 31.4424 * xD + 30.0717 * yD) / M;

  const out: number[] = [];
  for (let w = 380; w <= 780; w += 5) {
    const idx = (w - 300) / 10.0;
    const i = Math.floor(idx);
    const f = idx - i;
    const s0 = DAYLIGHT_S0[i] + f * (DAYLIGHT_S0[i + 1] - DAYLIGHT_S0[i]);
    const s1 = DAYLIGHT_S1[i] + f * (DAYLIGHT_S1[i + 1] - DAYLIGHT_S1[i]);
    const s2 = DAYLIGHT_S2[i] + f * (DAYLIGHT_S2[i + 1] - DAYLIGHT_S2[i]);
    out.push(s0 + M1 * s1 + M2 * s2);
  }
  return out;
}

type Vec3 = [number, number, number];

function mat3(m: number[][], v: Vec3): Vec3 {
  return [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
  ];
}

const M_CAT02 = [
  [0.7328, 0.4296, -0.1624],
  [-0.7036, 1.6975, 0.0061],
  [0.0030, 0.0136, 0.9834],
];
const M_HPE = [
  [0.38971, 0.68898, -0.07868],
  [-0.22981, 1.18340, 0.04641],
  [0.00000, 0.00000, 1.00000],
];

function invert3(m: number[][]): number[][] {
  const det =
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const i = 1.0 / det;
  return [
    [(m[1][1] * m[2][2] - m[1][2] * m[2][1]) * i, (m[0][2] * m[2][1] - m[0][1] * m[2][2]) * i, (m[0][1] * m[1][2] - m[0][2] * m[1][1]) * i],
    [(m[1][2] * m[2][0] - m[1][0] * m[2][2]) * i, (m[0][0] * m[2][2] - m[0][2] * m[2][0]) * i, (m[0][2] * m[1][0] - m[0][0] * m[1][2]) * i],
    [(m[1][0] * m[2][1] - m[1][1] * m[2][0]) * i, (m[0][1] * m[2][0] - m[0][0] * m[2][1]) * i, (m[0][0] * m[1][1] - m[0][1] * m[1][0]) * i],
  ];
}
const M_CAT02_INV = invert3(M_CAT02);

/** CIECAM02 forward model (Average surround, L_A=100, Y_b=20, D=1 i.e.
 * full/discounted adaptation) -- returns [J, M, h]. Matches spd.php's
 * calc_rf_rg()-local $cam02 closure exactly, which itself matches the
 * colour-science Python library's CIECAM02 (CIE 159:2004, with Luo2013's
 * negative-value handling in the post-adaptation compression step). */
function ciecam02(XYZ: Vec3, XYZw: Vec3): [number, number, number] {
  const L_A = 100.0, Y_b = 20.0, c = 0.69, Nc = 1.0;
  const Y_w = XYZw[1];

  const k = 1.0 / (5.0 * L_A + 1.0);
  const FL = 0.2 * k ** 4 * (5.0 * L_A) + 0.1 * (1.0 - k ** 4) ** 2 * (5.0 * L_A) ** (1.0 / 3.0);
  const n = Y_b / Y_w;
  const z = 1.48 + Math.sqrt(n);
  const Nbb = 0.725 * (1.0 / n) ** 0.2;
  const Ncb = Nbb;

  const adapt = (v: number): number => {
    const sign = v >= 0.0 ? 1.0 : -1.0;
    const vF = Math.abs(v) * FL / 100.0;
    const vF42 = vF ** 0.42;
    return sign * 400.0 * vF42 / (vF42 + 27.13) + 0.1;
  };

  // Chromatic adaptation: D=1 (discount_illuminant=True)
  const RGB_w = mat3(M_CAT02, XYZw);
  const Dr = Y_w / RGB_w[0], Dg = Y_w / RGB_w[1], Db = Y_w / RGB_w[2];

  const RGBwc: Vec3 = [Y_w, Y_w, Y_w];
  const XYZwc = mat3(M_CAT02_INV, RGBwc);
  const RGB_pw = mat3(M_HPE, XYZwc);
  const Ra_w = adapt(RGB_pw[0]), Ga_w = adapt(RGB_pw[1]), Ba_w = adapt(RGB_pw[2]);
  const A_w = Nbb * (2.0 * Ra_w + Ga_w + 0.05 * Ba_w - 0.305);

  const RGB = mat3(M_CAT02, XYZ);
  const RGBc: Vec3 = [Dr * RGB[0], Dg * RGB[1], Db * RGB[2]];
  const XYZc = mat3(M_CAT02_INV, RGBc);
  const RGB_p = mat3(M_HPE, XYZc);
  const Ra = adapt(RGB_p[0]), Ga = adapt(RGB_p[1]), Ba = adapt(RGB_p[2]);

  const a = Ra - (12.0 * Ga) / 11.0 + Ba / 11.0;
  const b = (Ra + Ga - 2.0 * Ba) / 9.0;
  const h = ((Math.atan2(b, a) * 180) / Math.PI + 360.0) % 360.0;

  const e_t = 0.25 * (Math.cos((h * Math.PI) / 180 + 2.0) + 3.8);

  const A = Nbb * (2.0 * Ra + Ga + 0.05 * Ba - 0.305);
  const J = 100.0 * (A / A_w) ** (c * z);

  const t_den = Ra + Ga + (21.0 / 20.0) * Ba;
  const t = t_den > 0
    ? ((50000.0 / 13.0) * Nc * Ncb * e_t * Math.sqrt(a ** 2 + b ** 2)) / t_den
    : 0.0;
  const C = t ** 0.9 * Math.sqrt(J / 100.0) * (1.64 - 0.29 ** n) ** 0.73;
  const M = C * FL ** 0.25;

  return [J, M, h];
}

/** CAM02-UCS conversion -- [J,M,h] -> [Jp,ap,bp]. Matches spd.php's $to_Jpapbp closure. */
function toJpapbp([J, M, h]: [number, number, number]): Vec3 {
  const Jp = (1.0 + 100.0 * 0.007) * J / (1.0 + 0.007 * J);
  const Mp = (1.0 / 0.0228) * Math.log(1.0 + 0.0228 * M);
  const hr = (h * Math.PI) / 180;
  return [Jp, Mp * Math.cos(hr), Mp * Math.sin(hr)];
}

export interface RfRg {
  rf: number;
  rg: number;
}

/**
 * TM-30-18 / CIE 2017 Rf (fidelity) and Rg (gamut) indices for a measured
 * spectrum, given its CCT. `spd` must already be the 81-point, 5nm-step
 * 380-780nm array (see interpolateSpd5nm()) -- matches spd.php's
 * calc_rf_rg($spd, $cct) exactly (minus the per-bin/per-sample detail
 * arrays it also returns; see this file's header).
 */
export function calcRfRg(spd: number[], cct: number): RfRg {
  const { rf, rg } = calcTm30(spd, cct);
  return { rf, rg };
}

/** TM-30 / CIE reference illuminant at 5nm, 380-780nm (81 values): Planckian <= 4000K, CIE daylight >= 5000K, normalised blend between. */
export function tm30ReferenceSpd(cct: number): number[] {
  const Tr = Math.max(1667.0, Math.min(25000.0, cct));
  if (Tr <= 4000.0) return blackbodySpd5nm(Tr);
  if (Tr >= 5000.0) return daylightSpd5nm(Tr);
  const p = blackbodySpd5nm(Tr);
  const d = daylightSpd5nm(Tr);
  const i560 = 36;
  const pn = p[i560] > 0 ? p.map((v) => v / p[i560]) : p;
  const dn = d[i560] > 0 ? d.map((v) => v / d[i560]) : d;
  const w = (Tr - 4000.0) / 1000.0;
  const ref: number[] = [];
  for (let k = 0; k < 81; k++) ref[k] = (1.0 - w) * pn[k] + w * dn[k];
  return ref;
}

export interface Tm30Detail extends RfRg {
  /** Rf,hj -- fidelity per hue bin (16). */
  rfBins: number[];
  /** Rcs,hj -- local chroma shift per bin, as a fraction (16). */
  rcsBins: number[];
  /** Rhs,hj -- local hue shift per bin, degrees (16). */
  rhsBins: number[];
  /** Color vector graphic points, reference normalised to a unit circle (16 x [x,y]). */
  cvgTest: [number, number][];
  cvgRef: [number, number][];
  /** Rf,CES -- fidelity of each of the 99 samples, and their reference hue angles. */
  rfSamples: number[];
  sampleHues: number[];
}

export function calcTm30(spd: number[], cct: number): Tm30Detail {
  const X10 = CMF10_X, Y10 = CMF10_Y, Z10 = CMF10_Z;

  // ── Build reference illuminant SPD ──────────────────────────────────────
  const ref = tm30ReferenceSpd(cct);

  // ── Normalize SPDs so white Y=100 ───────────────────────────────────────
  let tYw = 0.0;
  for (let i = 0; i < 81; i++) tYw += spd[i] * Y10[i];
  const tK = tYw > 0 ? 100.0 / tYw : 1.0;
  const spdN = spd.map((v) => v * tK);

  let rYw = 0.0;
  for (let i = 0; i < 81; i++) rYw += ref[i] * Y10[i];
  const rK = rYw > 0 ? 100.0 / rYw : 1.0;
  const refN = ref.map((v) => v * rK);

  // ── White XYZ ────────────────────────────────────────────────────────────
  const tWh: Vec3 = [0.0, 0.0, 0.0];
  const rWh: Vec3 = [0.0, 0.0, 0.0];
  for (let i = 0; i < 81; i++) {
    tWh[0] += spdN[i] * X10[i]; tWh[1] += spdN[i] * Y10[i]; tWh[2] += spdN[i] * Z10[i];
    rWh[0] += refN[i] * X10[i]; rWh[1] += refN[i] * Y10[i]; rWh[2] += refN[i] * Z10[i];
  }

  // ── Compute Jp,ap,bp for all 99 CES ─────────────────────────────────────
  const dEs: number[] = [];
  const refHues: number[] = [];
  const testJpapbp: Vec3[] = [];
  const refJpapbp: Vec3[] = [];

  for (const cesR of CES99) {
    let tX = 0, tY = 0, tZ = 0, rX = 0, rY = 0, rZ = 0;
    for (let i = 0; i < 81; i++) {
      const tc = spdN[i] * cesR[i];
      const rc = refN[i] * cesR[i];
      tX += tc * X10[i]; tY += tc * Y10[i]; tZ += tc * Z10[i];
      rX += rc * X10[i]; rY += rc * Y10[i]; rZ += rc * Z10[i];
    }
    const tJpapbp = toJpapbp(ciecam02([tX, tY, tZ], tWh));
    const rJpapbp = toJpapbp(ciecam02([rX, rY, rZ], rWh));
    testJpapbp.push(tJpapbp);
    refJpapbp.push(rJpapbp);

    const dE = Math.sqrt((tJpapbp[0] - rJpapbp[0]) ** 2 + (tJpapbp[1] - rJpapbp[1]) ** 2 + (tJpapbp[2] - rJpapbp[2]) ** 2);
    dEs.push(dE);
    refHues.push(((Math.atan2(rJpapbp[2], rJpapbp[1]) * 180) / Math.PI + 360.0) % 360.0);
  }

  // ── Overall Rf ───────────────────────────────────────────────────────────
  const meanDE = dEs.reduce((a, b) => a + b, 0) / 99.0;
  const Rf = Math.round(Math.min(100.0, 10.0 * Math.log(Math.exp((100.0 - 6.73 * meanDE) / 10.0) + 1.0)));

  // ── Bin assignments (by reference hue angle) ───────────────────────────
  const bins = refHues.map((h) => Math.floor(h / 22.5) % 16);

  // ── Per-bin averages of ap,bp ────────────────────────────────────────────
  const testAvg: [number, number][] = Array.from({ length: 16 }, () => [0.0, 0.0]);
  const refAvg: [number, number][] = Array.from({ length: 16 }, () => [0.0, 0.0]);
  const binCounts = new Array(16).fill(0);

  bins.forEach((b, idx) => {
    testAvg[b][0] += testJpapbp[idx][1];
    testAvg[b][1] += testJpapbp[idx][2];
    refAvg[b][0] += refJpapbp[idx][1];
    refAvg[b][1] += refJpapbp[idx][2];
    binCounts[b]++;
  });
  for (let b = 0; b < 16; b++) {
    if (binCounts[b] > 0) {
      testAvg[b][0] /= binCounts[b]; testAvg[b][1] /= binCounts[b];
      refAvg[b][0] /= binCounts[b]; refAvg[b][1] /= binCounts[b];
    }
  }

  // ── Rg = area ratio ──────────────────────────────────────────────────────
  const polyArea = (pts: [number, number][]): number => {
    const n = pts.length;
    let area = 0.0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      area += pts[i][0] * pts[j][1] - pts[j][0] * pts[i][1];
    }
    return Math.abs(area) / 2.0;
  };
  const tArea = polyArea(testAvg);
  const rArea = polyArea(refAvg);
  const Rg = rArea > 0 ? Math.round(Math.min(130.0, Math.max(60.0, (100.0 * tArea) / rArea))) : 100;

  // ── Per-bin detail (matches spd.php's rfBins / rcsBins / rhsBins / cvg*) ──
  const fid = (dE: number): number => Math.max(0.0, Math.min(100.0, 10.0 * Math.log(Math.exp((100.0 - 6.73 * dE) / 10.0) + 1.0)));
  const binDEs: number[][] = Array.from({ length: 16 }, () => []);
  bins.forEach((b, idx) => binDEs[b].push(dEs[idx]));
  const rfBins: number[] = [];
  const rcsBins: number[] = [];
  const rhsBins: number[] = [];
  const cvgTest: [number, number][] = [];
  const cvgRef: [number, number][] = [];
  for (let b = 0; b < 16; b++) {
    const bDE = binDEs[b].length > 0 ? binDEs[b].reduce((a, c) => a + c, 0) / binDEs[b].length : meanDE;
    rfBins.push(fid(bDE));
    const [tx, ty] = testAvg[b];
    const [ax, ay] = refAvg[b];
    const tC = Math.sqrt(tx * tx + ty * ty);
    const rC = Math.sqrt(ax * ax + ay * ay);
    rcsBins.push(rC > 0.5 ? (tC - rC) / rC : 0.0);
    const tH = Math.atan2(ty, tx);
    const rH = Math.atan2(ay, ax);
    let dH = tH - rH;
    if (dH > Math.PI) dH -= 2 * Math.PI;
    if (dH < -Math.PI) dH += 2 * Math.PI;
    rhsBins.push((dH * 180) / Math.PI);
    if (binCounts[b] === 0 || rC < 1e-9) {
      const ang = ((22.5 * b + 11.25) * Math.PI) / 180;
      cvgRef.push([Math.cos(ang), Math.sin(ang)]);
      cvgTest.push([Math.cos(ang), Math.sin(ang)]);
    } else {
      const rad = tC / rC;
      cvgRef.push([Math.cos(rH), Math.sin(rH)]);
      cvgTest.push([rad * Math.cos(tH), rad * Math.sin(tH)]);
    }
  }

  return {
    rf: Rf, rg: Rg, rfBins, rcsBins, rhsBins, cvgTest, cvgRef,
    rfSamples: dEs.map(fid),
    sampleHues: refHues,
  };
}
