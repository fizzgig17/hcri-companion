// src/utils/tm30Report.ts
//
// Builds the IES TM-30-18 Color Rendition Report for one reading, entirely on
// the phone -- no upload, no network. The result is a self-contained HTML page
// (inline SVG charts) that the app shows in a scrolling WebView AND converts to
// a PDF for sharing, so the on-screen report and the PDF are the same thing.
//
// Layout follows hCRI.io's TM-30 PDF (api/_core/tm30_pdf_builder.php): header
// numbers, color vector graphic, spectrum, the three local-shift bar charts, the
// 99-sample fidelity bars and the notes. Numbers come from the same ported
// calculations the rest of the app uses (rfRg.ts / spectralAnalysis.ts).

import { calcTm30, interpolateSpd5nm, tm30ReferenceSpd, Tm30Detail } from './rfRg';
import { CMF10_Y } from '../hcri/cesData';
import { APP_VERSION } from '../buildInfo';
import type { MeterResult } from '../ble/parseResult';
import type { SpectralAnalysis } from './spectralAnalysis';

export interface Tm30Input {
  /** Reading title (History label). */
  title: string;
  notes?: string;
  /** Epoch ms the reading was taken. */
  takenAt?: number;
  deviceName?: string;
  spectrum: { nm: number; value: number }[];
  cct: number;
  duv: number;
  x: number;
  y: number;
  ra: number;
  r9: number;
}

/** Report input for a reading: the spectrum plus the app's own analysis values. */
export function tm30InputFromReading(result: MeterResult, analysis: SpectralAnalysis, title: string, takenAt?: number): Tm30Input {
  return {
    title,
    takenAt,
    deviceName: result.sampleLabel ? undefined : result.deviceName,
    spectrum: result.spectrum,
    cct: analysis.cct,
    duv: analysis.duv,
    x: analysis.x,
    y: analysis.y,
    ra: analysis.ra,
    r9: analysis.r9,
  };
}

type RGB = [number, number, number];

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const f1 = (n: number, d = 1): string => n.toFixed(d);
const rgbStr = (c: RGB): string => `rgb(${c[0]},${c[1]},${c[2]})`;

function blend(rgb: RGB, base: RGB, mix: number): RGB {
  return [0, 1, 2].map((i) => Math.max(0, Math.min(255, Math.trunc(base[i] + (rgb[i] - base[i]) * mix)))) as RGB;
}

function wl2rgb(wl: number): RGB {
  if (wl < 380) return [80, 0, 130];
  if (wl < 440) { const t = (wl - 380) / 60; return [0, 0, Math.min(255, Math.trunc(130 + 125 * t))]; }
  if (wl < 490) { const t = (wl - 440) / 50; return [0, Math.trunc(255 * t), 255]; }
  if (wl < 510) { const t = (wl - 490) / 20; return [0, 255, Math.trunc(255 * (1 - t))]; }
  if (wl < 580) { const t = (wl - 510) / 70; return [Math.trunc(255 * t), Math.trunc(255 * (1 - t * 0.2)), 0]; }
  if (wl < 645) { const t = (wl - 580) / 65; return [255, Math.trunc(180 * (1 - t)), 0]; }
  if (wl <= 780) { const t = (wl - 645) / 135; return [Math.trunc(255 * (1 - t * 0.3)), 0, 0]; }
  return [80, 0, 0];
}

function hue2rgb(h: number, lo = 30, hi = 240): RGB {
  const r = 128 + 127 * Math.cos((h * Math.PI) / 180);
  const g = 128 + 127 * Math.cos(((h - 120) * Math.PI) / 180);
  const b = 128 + 127 * Math.cos(((h + 120) * Math.PI) / 180);
  return [r, g, b].map((v) => Math.max(lo, Math.min(hi, Math.trunc(v)))) as RGB;
}

const INK = '#101828';
const MUTED = '#5b6b80';
const GRID = '#d7e1eb';
const PANEL_LINE = '#bed2e1';
const AXIS = '#50647a';

// ── SPD chart ───────────────────────────────────────────────────────────────
function spdChart(input: Tm30Input, W = 360, H = 210): string {
  const pts = input.spectrum.filter((p) => isFinite(p.nm) && isFinite(p.value));
  const pL = 34, pR = W - 8, pT = 12, pB = H - 34;
  if (pts.length < 2 || Math.max(...pts.map((p) => p.value)) <= 0) {
    return `<svg viewBox="0 0 ${W} 60" width="100%"><text x="${W / 2}" y="34" text-anchor="middle" font-size="11" fill="${MUTED}">No spectral data</text></svg>`;
  }
  const wls = pts.map((p) => p.nm);
  const vals = pts.map((p) => Math.max(0, p.value));
  const maxV = Math.max(...vals);
  const minWl = Math.min(...wls);
  const span = Math.max(1, Math.max(...wls) - minWl);
  const X = (wl: number) => pL + ((wl - minWl) / span) * (pR - pL);
  const Y = (v: number) => pB - (v / maxV) * (pB - pT) * 0.9;

  let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" xmlns="http://www.w3.org/2000/svg" font-family="Helvetica,Arial,sans-serif">`;
  // Spectral-colour gradient for the area under the curve.
  s += `<defs><linearGradient id="spdg" gradientUnits="userSpaceOnUse" x1="${pL}" y1="0" x2="${pR}" y2="0">`;
  for (let wl = Math.ceil(minWl / 10) * 10; wl <= minWl + span; wl += 10) {
    const c = blend(wl2rgb(wl), [185, 185, 185], 0.5);
    s += `<stop offset="${(((wl - minWl) / span) * 100).toFixed(1)}%" stop-color="${rgbStr(c)}"/>`;
  }
  s += `</linearGradient></defs>`;
  s += `<rect x="${pL}" y="${pT}" width="${pR - pL}" height="${pB - pT}" fill="#f8fafc" stroke="${PANEL_LINE}" stroke-width="0.6"/>`;
  for (const wl of [400, 450, 500, 550, 600, 650, 700, 750]) {
    if (wl < minWl || wl > minWl + span) continue;
    s += `<line x1="${f1(X(wl))}" y1="${pT}" x2="${f1(X(wl))}" y2="${pB}" stroke="${GRID}" stroke-width="0.5"/>`;
    s += `<text x="${f1(X(wl))}" y="${pB + 11}" text-anchor="middle" font-size="8" fill="#82969f">${wl}</text>`;
  }
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${f1(X(p.nm))},${f1(Y(Math.max(0, p.value)))}`).join('');
  s += `<path d="${line}L${f1(X(wls[wls.length - 1]))},${pB}L${f1(X(wls[0]))},${pB}Z" fill="url(#spdg)"/>`;

  // Reference illuminant, flux-matched to the test source.
  if (input.cct > 0) {
    const ref = tm30ReferenceSpd(input.cct);
    const test = interpolateSpd5nm(wls, vals);
    let ft = 0, fr = 0;
    for (let i = 0; i < 81; i++) { ft += test[i] * CMF10_Y[i]; fr += ref[i] * CMF10_Y[i]; }
    const sc = fr > 0 ? ft / fr : 0;
    if (sc > 0) {
      let d = '';
      for (let i = 0; i < 81; i++) {
        const wl = 380 + i * 5;
        if (wl < minWl || wl > minWl + span) continue;
        d += `${d ? 'L' : 'M'}${f1(X(wl))},${f1(Y(Math.min(maxV, ref[i] * sc)))}`;
      }
      if (d) s += `<path d="${d}" fill="none" stroke="#828282" stroke-width="1" stroke-dasharray="3 2.5"/>`;
    }
  }
  s += `<path d="${line}" fill="none" stroke="#c81e1e" stroke-width="1.5" stroke-linejoin="round"/>`;
  s += `<text x="${pL + 6}" y="${pT + 11}" font-size="8.5" fill="#c81e1e">— Test</text>`;
  s += `<text x="${pL + 44}" y="${pT + 11}" font-size="8.5" fill="#646464">- - Reference</text>`;
  s += `<text x="${(pL + pR) / 2}" y="${H - 6}" text-anchor="middle" font-size="9" fill="${AXIS}">Wavelength (nm)</text>`;
  return s + '</svg>';
}

// ── Local shift / fidelity bar charts (16 hue bins) ─────────────────────────
function binChart(
  title: string,
  mode: 'chroma' | 'hue' | 'fidelity',
  data: number[],
  axisMax: number,
  yLabels: [string, string, string],
  W = 360,
  H = 138,
  plotH = 92,
): string {
  const pL = 36, pR = W - 6, pT = 14;
  const bw = (pR - pL) / 16;
  const zeroY = pT + plotH / 2;
  let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" xmlns="http://www.w3.org/2000/svg" font-family="Helvetica,Arial,sans-serif">`;
  s += `<text x="${pL}" y="9" font-size="8.5" font-weight="700" fill="#1e3c64">${esc(title)}</text>`;
  s += `<rect x="${pL}" y="${pT}" width="${pR - pL}" height="${plotH}" fill="#f8fafc" stroke="${PANEL_LINE}" stroke-width="0.6"/>`;
  yLabels.forEach((lbl, j) => {
    s += `<text x="${pL - 4}" y="${pT + (j / 2) * plotH + 3}" text-anchor="end" font-size="7.5" fill="${AXIS}">${esc(lbl)}</text>`;
  });
  if (mode === 'fidelity') {
    for (const pct of [25, 50, 75]) {
      const gy = pT + plotH - (pct / 100) * plotH;
      s += `<line x1="${pL}" y1="${gy}" x2="${pR}" y2="${gy}" stroke="${GRID}" stroke-width="0.5"/>`;
    }
  } else {
    s += `<line x1="${pL}" y1="${zeroY}" x2="${pR}" y2="${zeroY}" stroke="#64788c" stroke-width="0.9"/>`;
  }
  for (let h = 0; h < 16; h++) {
    const v = data[h] ?? 0;
    const col = rgbStr(hue2rgb(h * 22.5 + 11.25));
    const x = pL + h * bw + 1;
    let label = '';
    let ly = 0;
    if (mode === 'fidelity') {
      const rb = Math.min(100, Math.max(0, v));
      const bh = (rb / 100) * plotH * 0.92;
      s += `<rect x="${f1(x, 2)}" y="${f1(pT + plotH - bh, 2)}" width="${f1(bw - 2, 2)}" height="${f1(bh, 2)}" fill="${col}"/>`;
      label = String(Math.round(rb));
      ly = pT + plotH - bh - 2;
    } else {
      const frac = axisMax > 0 ? Math.max(-1, Math.min(1, v / axisMax)) : 0;
      const bh = Math.abs(frac) * (plotH / 2) * 0.92;
      const y0 = frac >= 0 ? zeroY - bh : zeroY;
      s += `<rect x="${f1(x, 2)}" y="${f1(y0, 2)}" width="${f1(bw - 2, 2)}" height="${f1(bh, 2)}" fill="${col}"/>`;
      if (mode === 'chroma') {
        const pct = Math.round(v * 100);
        if (Math.abs(pct) >= 2) label = `${pct > 0 ? '+' : ''}${pct}%`;
      } else if (Math.abs(v) >= 0.5) {
        label = `${v > 0 ? '+' : ''}${v.toFixed(1)}°`;
      }
      ly = frac >= 0 ? zeroY - bh - 2 : zeroY + bh + 7;
    }
    if (label) {
      s += `<text x="${f1(pL + h * bw + bw / 2)}" y="${f1(ly)}" text-anchor="middle" font-size="${label.length > 3 ? 5.5 : 6.5}" fill="${INK}">${esc(label)}</text>`;
    }
    s += `<text x="${f1(pL + h * bw + bw / 2)}" y="${pT + plotH + 10}" text-anchor="middle" font-size="7.5" fill="${AXIS}">${h + 1}</text>`;
  }
  if (H >= 100) s += `<text x="${(pL + pR) / 2}" y="${H - 3}" text-anchor="middle" font-size="7.5" fill="${AXIS}">Hue bin</text>`;
  return s + '</svg>';
}

// ── Color vector graphic ────────────────────────────────────────────────────
function cvgWheel(d: Tm30Detail, maxWidth = '420px'): string {
  const W = 340, cx = W / 2, cy = W / 2, R = 108;
  const pt = (r: number, aDeg: number): [number, number] => {
    const a = (aDeg * Math.PI) / 180;
    return [cx + r * Math.cos(a), cy - r * Math.sin(a)];
  };
  let s = `<svg viewBox="0 0 ${W} ${W}" width="100%" xmlns="http://www.w3.org/2000/svg" font-family="Helvetica,Arial,sans-serif" style="max-width:${maxWidth};display:block;margin:0 auto">`;
  // Hue sectors: bin h spans hue angle h*22.5 .. (h+1)*22.5, counter-clockwise from east (as TM-30 plots it).
  for (let h = 0; h < 16; h++) {
    const a1 = h * 22.5, a2 = a1 + 22.5;
    const [x1, y1] = pt(R + 16, a1);
    const [x2, y2] = pt(R + 16, a2);
    const c = blend(hue2rgb(h * 22.5 + 11.25), [170, 170, 170], 0.45);
    s += `<path d="M${cx},${cy}L${f1(x1)},${f1(y1)}A${R + 16},${R + 16} 0 0 0 ${f1(x2)},${f1(y2)}Z" fill="${rgbStr(c)}"/>`;
  }
  s += `<circle cx="${cx}" cy="${cy}" r="${R}" fill="#f8f9fc"/>`;
  for (const f of [0.25, 0.5, 0.75, 1.0]) {
    s += `<circle cx="${cx}" cy="${cy}" r="${R * f}" fill="none" stroke="${f === 1 ? '#1e1e1e' : '#b4bed2'}" stroke-width="${f === 1 ? 1.6 : 0.6}"/>`;
  }
  for (let h = 0; h < 16; h++) {
    const [x1, y1] = pt(17, h * 22.5);
    const [x2, y2] = pt(R, h * 22.5);
    s += `<line x1="${f1(x1)}" y1="${f1(y1)}" x2="${f1(x2)}" y2="${f1(y2)}" stroke="#c8d2dc" stroke-width="0.5"/>`;
  }
  const map = (p: [number, number]): [number, number] => {
    const r = Math.max(0.05, Math.min(1.45, Math.hypot(p[0], p[1])));
    const a = Math.atan2(p[1], p[0]);
    return [cx + R * r * Math.cos(a), cy - R * r * Math.sin(a)];
  };
  const tp = d.cvgTest.map(map);
  const rp = d.cvgRef.map(map);
  s += `<path d="M${tp.map((p) => `${f1(p[0])},${f1(p[1])}`).join('L')}Z" fill="rgba(190,25,25,0.12)" stroke="#be1919" stroke-width="2" stroke-linejoin="round"/>`;
  // Reference -> test arrows.
  rp.forEach((r, i) => {
    const t = tp[i];
    const dx = t[0] - r[0], dy = t[1] - r[1];
    const len = Math.hypot(dx, dy);
    if (len < 1.2) return;
    const ux = dx / len, uy = dy / len;
    const hd = 4, hw = 1.6;
    s += `<line x1="${f1(r[0])}" y1="${f1(r[1])}" x2="${f1(t[0])}" y2="${f1(t[1])}" stroke="#1e3c96" stroke-width="1"/>`;
    s += `<path d="M${f1(t[0])},${f1(t[1])}L${f1(t[0] - ux * hd - uy * hw)},${f1(t[1] - uy * hd + ux * hw)}L${f1(t[0] - ux * hd + uy * hw)},${f1(t[1] - uy * hd - ux * hw)}Z" fill="#1e3c96"/>`;
  });
  tp.forEach((p) => { s += `<circle cx="${f1(p[0])}" cy="${f1(p[1])}" r="2.6" fill="#aa0f0f"/>`; });
  s += `<circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="#141414" stroke-width="1.6"/>`;
  for (let h = 0; h < 16; h++) {
    const [x, y] = pt(R + 27, h * 22.5 + 11.25);
    s += `<text x="${f1(x)}" y="${f1(y + 3.5)}" text-anchor="middle" font-size="10" font-weight="700" fill="#141414">${h + 1}</text>`;
  }
  return s + '</svg>';
}

// ── 99 color samples ────────────────────────────────────────────────────────
function cesChart(d: Tm30Detail, H = 110, plotH = 70): string {
  const W = 360;
  const pL = 28, pR = W - 6, pT = 8;
  const bw = (pR - pL) / 99;
  let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" xmlns="http://www.w3.org/2000/svg" font-family="Helvetica,Arial,sans-serif">`;
  s += `<rect x="${pL}" y="${pT}" width="${pR - pL}" height="${plotH}" fill="#f8fafc" stroke="${PANEL_LINE}" stroke-width="0.6"/>`;
  for (const [lbl, frac] of [['100', 0], ['75', 0.25], ['50', 0.5], ['25', 0.75]] as [string, number][]) {
    const gy = pT + plotH * frac;
    if (frac > 0) s += `<line x1="${pL}" y1="${gy}" x2="${pR}" y2="${gy}" stroke="${GRID}" stroke-width="0.5"/>`;
    s += `<text x="${pL - 3}" y="${gy + 3}" text-anchor="end" font-size="7.5" fill="${AXIS}">${lbl}</text>`;
  }
  d.rfSamples.forEach((rv, i) => {
    const v = Math.min(100, Math.max(0, rv));
    const bh = (v / 100) * plotH * 0.94;
    const c = rgbStr(hue2rgb(d.sampleHues[i] ?? (i / 99) * 360));
    s += `<rect x="${f1(pL + i * bw, 2)}" y="${f1(pT + plotH - bh, 2)}" width="${f1(Math.max(0.5, bw), 2)}" height="${f1(bh, 2)}" fill="${c}"/>`;
  });
  for (const n of [1, 10, 20, 30, 40, 50, 60, 70, 80, 90, 99]) {
    s += `<text x="${f1(pL + (n - 1) * bw + bw / 2)}" y="${pT + plotH + 10}" text-anchor="middle" font-size="7.5" fill="${AXIS}">${n}</text>`;
  }
  s += `<text x="${(pL + pR) / 2}" y="${H - 6}" text-anchor="middle" font-size="8" fill="${AXIS}">CES color sample</text>`;
  return s + '</svg>';
}

function stat(label: string, value: string, color = INK): string {
  return `<div class="stat"><div class="sl">${esc(label)}</div><div class="sv" style="color:${color}">${esc(value)}</div></div>`;
}

/** Full report page. Throws if the spectrum can't support a TM-30 calculation. */
export function buildTm30Html(input: Tm30Input): string {
  const pts = input.spectrum.filter((p) => isFinite(p.nm) && isFinite(p.value));
  if (pts.length < 2) throw new Error('This reading has no spectrum, so a TM-30 report can’t be generated.');
  const spd = interpolateSpd5nm(pts.map((p) => p.nm), pts.map((p) => Math.max(0, p.value)));
  const d = calcTm30(spd, input.cct);

  const absMax = (a: number[]) => a.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  const csMax = Math.max(0.1, Math.ceil(absMax(d.rcsBins) / 0.05 - 1e-9) * 0.05);
  const hsMax = Math.max(5, Math.ceil(absMax(d.rhsBins) / 5 - 1e-9) * 5);
  const csPct = Math.round(csMax * 100);
  const hsTxt = `${hsMax}°`;

  const rfColor = d.rf >= 85 ? '#28823c' : d.rf >= 70 ? '#b47814' : '#a02828';
  const rgColor = Math.abs(d.rg - 100) <= 8 ? '#28823c' : '#b47814';
  const date = new Date(input.takenAt ?? Date.now());
  const dateStr = `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}/${date.getFullYear()}`;
  const gen = new Date();
  const genStr = `${gen.getFullYear()}-${String(gen.getMonth() + 1).padStart(2, '0')}-${String(gen.getDate()).padStart(2, '0')} ${String(gen.getHours()).padStart(2, '0')}:${String(gen.getMinutes()).padStart(2, '0')}`;
  const notes = (input.notes ?? '').trim();

  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  *{box-sizing:border-box}
  html,body{margin:0;padding:0;background:#fff;color:${INK};font-family:Helvetica,Arial,sans-serif}
  .page{max-width:640px;margin:0 auto;padding:0 0 16px}
  .bar{background:#0c1424;color:#c8e6ff;padding:12px 14px}
  .bar h1{font-size:15px;margin:0}
  .bar .t{font-size:12px;color:#7fb0cf;margin-top:3px;word-break:break-word}
  .info{display:flex;flex-wrap:wrap;gap:6px;padding:10px 12px 0}
  .chip{background:#e6eef8;border:1px solid #b4c8dc;border-radius:4px;padding:4px 8px;font-size:12px}
  .chip b{display:block;font-size:9px;letter-spacing:.04em;color:#3c648c;text-transform:uppercase}
  h2{font-size:12px;letter-spacing:.02em;background:#e0ecf8;color:#143c6e;margin:16px 12px 8px;padding:5px 8px;border-radius:3px}
  .sec{padding:0 12px}
  .keep{page-break-inside:avoid;break-inside:avoid}
  h2{page-break-after:avoid;break-after:avoid}
  .big{display:flex;gap:10px;padding:12px 12px 0}
  .big .n{flex:1;border:1px solid #bed2e1;border-radius:6px;padding:8px 10px;text-align:center;background:#f8fafc}
  .big .n .v{font-size:34px;font-weight:800;line-height:1.05}
  .big .n .l{font-size:11px;color:#3c5a78;margin-top:2px}
  .stats{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;padding:8px 12px 0}
  .stat{background:#ebf2fc;border:1px solid #bed2e6;border-radius:4px;padding:5px 8px}
  .stat .sl{font-size:9px;letter-spacing:.04em;text-transform:uppercase;color:#32588c}
  .stat .sv{font-size:15px;font-weight:700;margin-top:1px}
  .note{font-size:12px;color:#374a5e;padding:0 12px;line-height:1.4;word-break:break-word}
  .foot{font-size:9.5px;color:#8a97a5;text-align:center;padding:14px 14px 0;line-height:1.4}
  .cap{font-size:10.5px;color:#5b6b80;padding:2px 12px 0}
</style></head><body><div class="page">
<div class="bar"><h1>IES TM-30-18 Color Rendition Report</h1><div class="t">${esc(input.title || 'Reading')}</div></div>
<div class="info">
  <div class="chip"><b>Source</b>${esc(input.title || '-')}</div>
  ${input.deviceName ? `<div class="chip"><b>Meter</b>${esc(input.deviceName)}</div>` : ''}
  <div class="chip"><b>Date</b>${dateStr}</div>
</div>
<div class="big">
  <div class="n"><div class="v" style="color:${rfColor}">${d.rf}</div><div class="l">Rf · fidelity</div></div>
  <div class="n"><div class="v" style="color:${rgColor}">${d.rg}</div><div class="l">Rg · gamut</div></div>
</div>
<div class="stats">
  ${stat('CCT', `${Math.round(input.cct)} K`)}
  ${stat('Duv', `${input.duv >= 0 ? '+' : ''}${input.duv.toFixed(4)}`)}
  ${stat('Ra (CRI)', String(Math.round(input.ra)))}
  ${stat('R9', String(Math.round(input.r9)))}
  ${stat('CIE x', input.x.toFixed(4))}
  ${stat('CIE y', input.y.toFixed(4))}
</div>
<div class="keep"><h2>Color Vector Graphic</h2>
<div class="sec">${cvgWheel(d)}
<div class="cap">Black circle = reference illuminant. Red shape = this light; outside the circle is more saturated, inside is less. Arrows show the shift for each of the 16 hue bins.</div></div></div>
<div class="keep"><h2>Spectral Power Distribution</h2>
<div class="sec">${spdChart(input)}</div></div>
<h2>Local Color Rendition</h2>
<div class="sec">
  <div class="keep">${binChart('LOCAL CHROMA SHIFT (Rcs,hj)', 'chroma', d.rcsBins, csMax, [`+${csPct}%`, '0%', `-${csPct}%`])}</div>
  <div class="keep">${binChart('LOCAL HUE SHIFT (Rhs,hj)', 'hue', d.rhsBins, hsMax, [`+${hsTxt}`, '0', `-${hsTxt}`])}</div>
  <div class="keep">${binChart('LOCAL COLOR FIDELITY (Rf,hj)', 'fidelity', d.rfBins, 100, ['100', '50', '0'])}</div>
</div>
<div class="keep"><h2>Color Sample Fidelity, Rf,CES</h2>
<div class="sec">${cesChart(d)}</div></div>
${notes ? `<h2>Notes</h2><div class="note">${esc(notes)}</div>` : ''}
<div class="foot">Generated ${genStr} on-device by hCRI Companion v${esc(APP_VERSION)} · Colors are for visual orientation purposes only.</div>
</div></body></html>`;
}

/**
 * The shared PDF: one A4 page laid out like hCRI.io's own TM-30 PDF (SPD + three local-shift charts
 * on top, color vector graphic with Rf/Rg and the value tiles, the 99-sample bars, then notes and
 * the xy / CRI boxes). Every size is in rem with 1rem = 1/59.5 of the page width, so the page keeps
 * its A4 proportions whatever width the PDF renderer lays the HTML out at.
 */
export function buildTm30PdfHtml(input: Tm30Input): string {
  const pts = input.spectrum.filter((p) => isFinite(p.nm) && isFinite(p.value));
  if (pts.length < 2) throw new Error('This reading has no spectrum, so a TM-30 report can’t be generated.');
  const spd = interpolateSpd5nm(pts.map((p) => p.nm), pts.map((p) => Math.max(0, p.value)));
  const d = calcTm30(spd, input.cct);

  const absMax = (a: number[]) => a.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  const csMax = Math.max(0.1, Math.ceil(absMax(d.rcsBins) / 0.05 - 1e-9) * 0.05);
  const hsMax = Math.max(5, Math.ceil(absMax(d.rhsBins) / 5 - 1e-9) * 5);
  const csPct = Math.round(csMax * 100);
  const hsTxt = `${hsMax}°`;
  const rfColor = d.rf >= 85 ? '#28823c' : d.rf >= 70 ? '#b47814' : '#a02828';
  const rgColor = Math.abs(d.rg - 100) <= 8 ? '#28823c' : '#b47814';
  const date = new Date(input.takenAt ?? Date.now());
  const dateStr = `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}/${date.getFullYear()}`;
  const gen = new Date();
  const genStr = `${gen.getFullYear()}-${String(gen.getMonth() + 1).padStart(2, '0')}-${String(gen.getDate()).padStart(2, '0')} ${String(gen.getHours()).padStart(2, '0')}:${String(gen.getMinutes()).padStart(2, '0')}`;
  const notes = (input.notes ?? '').trim();
  const duvTxt = `${input.duv >= 0 ? '+' : ''}${input.duv.toFixed(4)}`;

  const tile = (label: string, value: string) =>
    `<div class="tile"><div class="tl">${esc(label)}</div><div class="tv">${esc(value)}</div></div>`;
  const bins = (t: string, m: 'chroma' | 'hue' | 'fidelity', data: number[], mx: number, yl: [string, string, string]) =>
    binChart(t, m, data, mx, yl, 300, 84, 54);

  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  @page{margin:0}
  *{box-sizing:border-box}
  /* max(): the PDF renderer's off-screen web view can report a 0-wide viewport, which would collapse every rem to 0 and print a blank page. */
  html{font-size:10px;font-size:max(4px, calc(100vw / 59.5))}
  html,body{margin:0;padding:0;background:#fff;color:${INK};font-family:Helvetica,Arial,sans-serif}
  .pg{position:relative;width:59.5rem;height:84rem;overflow:hidden}
  .bar{background:#0c1424;height:4.5rem;padding:0 2.3rem;display:flex;align-items:center;justify-content:space-between}
  .bar .a{color:#c8e6ff;font-size:1.5rem;font-weight:700}
  .bar .b{color:#7fb0cf;font-size:1.1rem;max-width:24rem;text-align:right;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
  .in{padding:0 2.3rem}
  .chips{display:flex;gap:.4rem;margin-top:1rem}
  .chip{flex:1;background:#e6eef8;border:1px solid #b4c8dc;padding:.35rem .6rem;font-size:1.1rem;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
  .chip b{display:block;font-size:.8rem;letter-spacing:.04em;color:#3c648c;text-transform:uppercase}
  .sh{background:#e0ecf8;color:#143c6e;font-size:1.1rem;font-weight:700;padding:.45rem .7rem;margin-bottom:.4rem}
  .row{display:flex;gap:1rem}
  .col{width:27rem}
  .vcg{position:relative;height:20.6rem}
  .rfn{position:absolute;top:0;font-size:3rem;font-weight:800;line-height:1}
  .rfl{position:absolute;top:3.3rem;font-size:1.1rem;color:#3c5a78}
  .tiles{display:grid;grid-template-columns:1fr 1fr;gap:.6rem}
  .tile{background:#ebf2fc;border:1px solid #bed2e6;padding:.6rem .8rem;height:6.3rem}
  .tile .tl{font-size:.9rem;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#32588c}
  .tile .tv{font-size:1.9rem;font-weight:700;margin-top:.6rem}
  .box{border:1px solid #aac3dc;padding:.5rem .8rem;font-size:1.15rem;line-height:1.5}
  .foot{position:absolute;left:0;right:0;bottom:.9rem;text-align:center;color:#a0a0a0;font-size:.9rem;line-height:1.5;font-style:italic}
</style></head><body><div class="pg">
<div class="bar"><div class="a">IES TM-30-18 Color Rendition Report</div><div class="b">${esc(input.title || 'Reading')}</div></div>
<div class="in">
  <div class="chips">
    <div class="chip"><b>Source</b>${esc(input.title || '-')}</div>
    ${input.deviceName ? `<div class="chip" style="flex:.6"><b>Meter</b>${esc(input.deviceName)}</div>` : ''}
    <div class="chip" style="flex:.4"><b>Date</b>${dateStr}</div>
  </div>
  <div class="row" style="margin-top:1rem">
    <div class="col"><div class="sh">Spectral Power Distribution</div>${spdChart(input, 300, 226)}</div>
    <div class="col" style="padding-top:.2rem">
      ${bins('LOCAL CHROMA SHIFT (Rcs,hj)', 'chroma', d.rcsBins, csMax, [`+${csPct}%`, '0%', `-${csPct}%`])}
      ${bins('LOCAL HUE SHIFT (Rhs,hj)', 'hue', d.rhsBins, hsMax, [`+${hsTxt}`, '0', `-${hsTxt}`])}
      ${bins('LOCAL COLOR FIDELITY (Rf,hj)', 'fidelity', d.rfBins, 100, ['100', '50', '0'])}
    </div>
  </div>
  <div class="sh" style="margin-top:1rem">Color Vector Graphic (CVG)</div>
  <div class="row">
    <div class="col vcg">
      <div class="rfn" style="left:0;color:${rfColor}">${d.rf}</div><div class="rfl" style="left:0">Rf</div>
      <div class="rfn" style="right:0;color:${rgColor}">${d.rg}</div><div class="rfl" style="right:0">Rg</div>
      <div style="width:20.4rem;margin:0 auto">${cvgWheel(d, '100%')}</div>
    </div>
    <div class="col"><div class="tiles">
      ${tile('CIE x', input.x.toFixed(4))}${tile('Duv', duvTxt)}
      ${tile('CIE y', input.y.toFixed(4))}${tile('Ra (CRI)', String(Math.round(input.ra)))}
      ${tile('CCT', `${Math.round(input.cct)} K`)}${tile('R9', String(Math.round(input.r9)))}
    </div></div>
  </div>
  <div class="sh" style="margin-top:.9rem">Color Sample Fidelity, Rf,CES</div>
  ${cesChart(d, 96, 60)}
  <div class="row" style="margin-top:.8rem">
    <div style="width:26rem;font-size:1.15rem;line-height:1.4;overflow:hidden;max-height:4.6rem"><b style="color:#1e3250">Notes:</b> ${esc(notes || '-')}</div>
    <div class="box" style="width:12.5rem"><b>x</b> &nbsp; ${input.x.toFixed(4)}<br><b>y</b> &nbsp; ${input.y.toFixed(4)}</div>
    <div class="box" style="width:14rem"><b style="color:#1e3250">CIE 13.3-1995 (CRI)</b><br>Ra &nbsp; <b>${Math.round(input.ra)}</b> &nbsp;&nbsp; R9 &nbsp; <b>${Math.round(input.r9)}</b></div>
  </div>
</div>
<div class="foot">Generated ${genStr} on-device by hCRI Companion v${esc(APP_VERSION)} · Colors are for visual orientation purposes only.</div>
</div></body></html>`;
}
