// src/utils/tm30AnnexSvg.ts
//
// The IES TM-30-18 "Annex E" report page, drawn as one SVG, laid out exactly like the TM-30 report you get on
// hCRI.io (frontend/src/components/AnnexEModal.jsx draws it onto an 825 x 1070 canvas; every coordinate, font
// size and colour below is that canvas code, light theme). The app's PDF is this picture on a page of the same
// proportions, so the phone's PDF and the website's look the same.

import { calcTm30, interpolateSpd5nm, tm30ReferenceSpd } from './rfRg';

export const ANNEX_W = 825;
export const ANNEX_H = 1070;

export interface AnnexInput {
  title: string;
  notes?: string;
  takenAt?: number;
  spectrum: { nm: number; value: number }[];
  cct: number;
  duv: number;
  x: number;
  y: number;
  ra: number;
  r9: number;
  /** LED the person confirmed for this reading (fills the LED / CCT boxes in the strip under the header). */
  led?: { brand?: string; model?: string; cct?: string };
  /** Footer, right side. */
  generatedBy?: string;
}

const FONT = 'Helvetica,Arial,sans-serif';
const COL = { text: '#1a3a5c', accent: '#2d6a9f', border: '#c8d4e0', dim: '#888', strong: '#222', faint: '#aaa' };
const GOOD = '#1a7a3a';
const WARN = '#9a6600';
const BAD = '#c0001a';

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const n2 = (v: number): string => (Math.round(v * 100) / 100).toString();

function hueToRGB(h: number): [number, number, number] {
  const f = (a: number) => Math.max(30, Math.min(240, Math.round(128 + 127 * Math.cos((a * Math.PI) / 180))));
  return [f(h), f(h - 120), f(h + 120)];
}

function fidelityColor(v: number | null): string {
  return v == null ? COL.faint : v >= 90 ? GOOD : v >= 80 ? '#3a7a1a' : v >= 70 ? WARN : BAD;
}

/** Same ticks as the site's xTicks(): the ends plus a round step in between. */
function xTicks(lo: number, hi: number): number[] {
  if (!(hi > lo)) return [lo];
  const span = hi - lo;
  const step = span <= 350 ? 50 : span <= 900 ? 100 : 200;
  const out: number[] = [];
  for (let w = Math.ceil(lo / step) * step; w < hi; w += step) {
    if (w - lo > step * 0.4 && hi - w > step * 0.4) out.push(w);
  }
  out.unshift(lo);
  out.push(hi);
  return out;
}

type Base = 'top' | 'middle' | 'bottom' | 'alpha';
interface TOpt { size: number; color: string; bold?: boolean; anchor?: 'start' | 'middle' | 'end'; base?: Base; opacity?: number; mono?: boolean; rotate?: [number, number, number] }

/** Canvas-style text: (x, y) is the anchor point for the given textBaseline. */
function text(t: string | number, x: number, y: number, o: TOpt): string {
  const base = o.base ?? 'alpha';
  const yy = base === 'top' ? y + o.size * 0.8 : base === 'middle' ? y + o.size * 0.35 : base === 'bottom' ? y - o.size * 0.2 : y;
  const rot = o.rotate ? ` transform="rotate(${o.rotate[0]} ${o.rotate[1]} ${o.rotate[2]})"` : '';
  return `<text x="${n2(x)}" y="${n2(yy)}" font-family="${o.mono ? 'Menlo,Courier New,monospace' : FONT}" font-size="${o.size}"${o.bold ? ' font-weight="700"' : ''} fill="${o.color}"${o.opacity != null ? ` fill-opacity="${o.opacity}"` : ''} text-anchor="${o.anchor ?? 'start'}"${rot}>${esc(String(t))}</text>`;
}
const line = (x1: number, y1: number, x2: number, y2: number, stroke: string, w: number, extra = ''): string =>
  `<line x1="${n2(x1)}" y1="${n2(y1)}" x2="${n2(x2)}" y2="${n2(y2)}" stroke="${stroke}" stroke-width="${w}"${extra}/>`;
const rect = (x: number, y: number, w: number, h: number, fill: string, extra = ''): string =>
  `<rect x="${n2(x)}" y="${n2(y)}" width="${n2(w)}" height="${n2(h)}" fill="${fill}"${extra}/>`;

function sectionLabel(label: string, x: number, y: number): string {
  const w = label.length * 4.9;
  return text(label, x, y, { size: 8.5, bold: true, color: COL.text, base: 'top' }) + line(x, y + 11, x + w + 2, y + 11, COL.accent, 1);
}
function boxBorder(x0: number, x1: number, y0: number, y1: number): string {
  return `<path d="M${x0},${y0}L${x0},${y1}L${x1},${y1}" fill="none" stroke="rgba(0,0,0,0.18)" stroke-width="0.6"/>`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function buildAnnexSvg(input: AnnexInput, widthPx: number, heightPx: number): string {
  const pts = input.spectrum.filter((p) => isFinite(p.nm) && isFinite(p.value));
  if (pts.length < 2) throw new Error('This reading has no spectrum, so a TM-30 report can’t be generated.');
  const wls = pts.map((p) => p.nm);
  const vals = pts.map((p) => Math.max(0, p.value));
  const d = calcTm30(interpolateSpd5nm(wls, vals), input.cct);

  const Rf = Math.round(d.rf), Rg = Math.round(d.rg), cct = Math.round(input.cct), duv = input.duv;
  const ra = input.ra, r9 = input.r9;
  const rfBins = d.rfBins, rcsBins = d.rcsBins, rhsBins = d.rhsBins;
  const rgColor = Math.abs(Rg - 100) <= 8 ? GOOD : WARN;
  const duvColor = Math.abs(duv) < 0.006 ? GOOD : WARN;
  const r9Color = r9 >= 50 ? GOOD : r9 >= 0 ? WARN : BAD;

  const o: string[] = [];
  o.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${widthPx}" height="${heightPx}" viewBox="0 0 ${ANNEX_W} ${ANNEX_H}" style="display:block">`);
  o.push(rect(0, 0, ANNEX_W, ANNEX_H, '#fafbfc'));

  // ── Header band ──
  const dt = new Date(input.takenAt ?? Date.now());
  const dateStr = `${MONTHS[dt.getMonth()]} ${dt.getDate()}, ${dt.getFullYear()}`;
  o.push(rect(0, 0, ANNEX_W, 48, COL.text));
  o.push(text('IES TM-30-18', 22, 20, { size: 16, bold: true, color: '#ffffff', base: 'middle' }));
  o.push(text('Color Rendition Report', 22, 35, { size: 11, color: '#ffffff', opacity: 0.65, base: 'middle' }));
  o.push(text('hcri.io', 803, 20, { size: 13, bold: true, color: '#ffffff', opacity: 0.9, anchor: 'end', base: 'middle' }));
  o.push(text(dateStr, 803, 35, { size: 10, color: '#ffffff', opacity: 0.5, anchor: 'end', base: 'middle' }));

  // ── Source / LED strip ──
  o.push(rect(0, 52, ANNEX_W, 34, '#f0f4f8'));
  o.push(line(0, 86, ANNEX_W, 86, COL.border, 0.5));
  const cols: [string, string][] = [['SOURCE', input.title || '—']];
  const ledName = [input.led?.brand, input.led?.model].filter(Boolean).join(' ');
  if (ledName) cols.push(['LED', ledName]);
  if (input.led?.cct) cols.push(['CCT', `${String(input.led.cct).replace(/\s*k$/i, '')}K`]);
  const colW = ANNEX_W / cols.length;
  cols.forEach(([k, v], i) => {
    const x = i * colW + 16;
    const maxChars = Math.max(4, Math.floor((colW - 20) / 5.7));
    const txt = v.length > maxChars ? `${v.slice(0, maxChars - 1)}…` : v;
    o.push(text(k, x, 57, { size: 8, bold: true, color: COL.dim, base: 'top' }));
    o.push(text(txt, x, 68, { size: 11, color: COL.strong, base: 'top' }));
    if (i > 0) o.push(line(i * colW, 58, i * colW, 80, COL.border, 0.5));
  });

  // ── Metric tiles ──
  o.push(rect(0, 86, ANNEX_W, 52, '#ffffff'));
  o.push(line(0, 138, ANNEX_W, 138, COL.border, 0.5));
  const tiles: [string, string, string, string][] = [
    ['Rf', String(Rf), fidelityColor(Rf), 'Color Fidelity'],
    ['Rg', String(Rg), rgColor, 'Gamut Index'],
    ['CCT', `${cct} K`, COL.accent, 'Color Temp.'],
    ['Duv', `${duv >= 0 ? '+' : ''}${duv.toFixed(4)}`, duvColor, 'Planckian Dist.'],
    ['Ra', String(Math.round(ra)), fidelityColor(ra), 'CRI (CIE 13.3)'],
    ['R9', String(Math.round(r9)), r9Color, 'Sat. Red'],
  ];
  const tw = ANNEX_W / tiles.length;
  tiles.forEach(([label, val, color, sub], i) => {
    const cx = i * tw + tw / 2;
    o.push(text(label, cx, 93, { size: 8, bold: true, color: COL.dim, anchor: 'middle', base: 'top' }));
    o.push(text(val, cx, 115, { size: val.length > 5 ? 17 : 21, bold: true, color, anchor: 'middle', base: 'middle' }));
    o.push(text(sub, cx, 136, { size: 8, color: COL.faint, anchor: 'middle', base: 'bottom' }));
    if (i > 0) o.push(line(i * tw, 96, i * tw, 128, COL.border, 0.5));
  });

  // ── Spectral power distribution ──
  o.push(sectionLabel('Spectral Power Distribution', 308, 148));
  o.push(boxBorder(336, 807, 161, 273));
  o.push(text('Relative Power', 316, 217, { size: 7.5, color: COL.dim, anchor: 'middle', base: 'middle', rotate: [-90, 316, 217] }));
  {
    const minWl = Math.min(...wls), maxWl = Math.max(...wls), maxV = Math.max(...vals) || 1;
    const xOf = (w: number) => 336 + ((w - minWl) / (maxWl - minWl)) * 471;
    const yOf = (v: number) => 273 - v * 112 * 0.9;
    // Reference illuminant at the reading's CCT, 5 nm grid normalised to its peak, interpolated at the test wavelengths.
    const refRaw = tm30ReferenceSpd(input.cct || 4000);
    const refPeak = Math.max(...refRaw) || 1;
    const refNorm = refRaw.map((v) => v / refPeak);
    const refAt = (w: number) => {
      const idx = Math.max(0, Math.min(80, (w - 380) / 5));
      const i = Math.min(79, Math.floor(idx));
      return refNorm[i] + (idx - i) * (refNorm[i + 1] - refNorm[i]);
    };
    for (let i = 1; i < wls.length; i++) {
      const x1 = xOf(wls[i - 1]), x2 = xOf(wls[i]);
      const frac = (vals[i] + vals[i - 1]) / (2 * maxV);
      const mid = (wls[i] + wls[i - 1]) / 2;
      let rgb: number[];
      if (mid < 440) { const t = (mid - 380) / 60; rgb = [0, 0, Math.round(100 + 155 * t)]; }
      else if (mid < 490) { const t = (mid - 440) / 50; rgb = [0, Math.round(200 * t), 220]; }
      else if (mid < 510) { const t = (mid - 490) / 20; rgb = [0, 200, Math.round(220 * (1 - t))]; }
      else if (mid < 580) { const t = (mid - 510) / 70; rgb = [Math.round(220 * t), Math.round(170 + 50 * (1 - t)), 0]; }
      else if (mid < 645) { const t = (mid - 580) / 65; rgb = [220, Math.round(150 * (1 - t)), 0]; }
      else { rgb = [Math.round(220 * (1 - ((mid - 645) / 135) * 0.4)), 0, 0]; }
      const top = yOf(frac);
      o.push(rect(x1, top, Math.max(0.5, x2 - x1), 273 - top, `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`, ' fill-opacity="0.55"'));
    }
    o.push(`<polyline fill="none" stroke="rgba(80,80,80,0.5)" stroke-width="1" stroke-dasharray="3 3" points="${wls.map((w) => `${n2(xOf(w))},${n2(yOf(refAt(w)))}`).join(' ')}"/>`);
    o.push(`<polyline fill="none" stroke="rgba(160,15,15,0.85)" stroke-width="1.6" stroke-linejoin="round" points="${wls.map((w, i) => `${n2(xOf(w))},${n2(yOf(vals[i] / maxV))}`).join(' ')}"/>`);
    const ticks = xTicks(minWl, maxWl);
    ticks.forEach((w, i) => {
      o.push(text(Math.round(w), xOf(w), 276, { size: 7.5, color: COL.dim, anchor: i === 0 ? 'start' : i === ticks.length - 1 ? 'end' : 'middle', base: 'top' }));
    });
    o.push(text('Wavelength (nm)', 571.5, 285, { size: 7.5, color: COL.dim, anchor: 'middle', base: 'top' }));
    o.push(line(717, 168, 731, 168, 'rgba(160,15,15,0.85)', 1.5));
    o.push(text('Test', 734, 168, { size: 8, color: '#666', base: 'middle' }));
    o.push(line(755, 168, 769, 168, 'rgba(80,80,80,0.5)', 1, ' stroke-dasharray="3 3"'));
    o.push(text('Ref.', 772, 168, { size: 8, color: '#666', base: 'middle' }));
  }

  // ── Hue-bin panels ──
  const binPanel = (values: number[], y: number, h: number, lo: number, hi: number, refLine: number | null, label: string, axisFmt: (v: number) => string, barFmt: (v: number) => string) => {
    const p0 = y + 13, p1 = y + h - 14, binW = 471 / 16;
    const zeroY = p1 - ((0 - lo) / (hi - lo)) * (p1 - p0);
    o.push(sectionLabel(label, 308, y));
    const gridVals = lo < 0 ? [lo, lo / 2, 0, hi / 2, hi] : [0, 25, 50, 75, 100];
    gridVals.forEach((v) => {
      const gy = p1 - ((v - lo) / (hi - lo)) * (p1 - p0);
      o.push(line(336, gy, 807, gy, 'rgba(0,0,0,0.06)', 0.4));
      o.push(text(axisFmt(v), 332, gy, { size: 7.5, color: COL.dim, anchor: 'end', base: 'middle' }));
    });
    if (lo < 0) o.push(line(336, zeroY, 807, zeroY, 'rgba(0,0,0,0.25)', 0.7));
    if (refLine != null) {
      const ry = p1 - ((refLine - lo) / (hi - lo)) * (p1 - p0);
      o.push(line(336, ry, 807, ry, COL.accent, 0.8, ' stroke-dasharray="3 2"'));
    }
    values.forEach((raw, i) => {
      const [rr, gg, bb] = hueToRGB(i * 22.5 + 11.25);
      const clamped = Math.max(lo, Math.min(hi, raw));
      const top = clamped >= 0 ? p1 - (clamped / (hi - lo)) * (p1 - p0) : zeroY;
      const x = 336 + i * binW + 1;
      const hh = clamped >= 0 ? p1 - top : (top - zeroY) || 1;
      // Canvas quirk kept as-is: for negative bars `top` is zeroY, so the bar height there is (zeroY - zeroY) || 1.
      const barTop = clamped >= 0 ? top : zeroY;
      const negH = clamped < 0 ? Math.abs(((clamped - 0) / (hi - lo)) * (p1 - p0)) : hh;
      o.push(rect(x, barTop, binW - 2, clamped >= 0 ? hh : negH, `rgb(${rr},${gg},${bb})`, ' fill-opacity="0.88"'));
      const lab = barFmt(raw);
      if (lab) {
        const ly = clamped >= 0 ? top - 1 : zeroY + negH + 1;
        o.push(text(lab, x + binW / 2 - 0.5, ly, { size: 7, bold: true, color: COL.strong, anchor: 'middle', base: clamped >= 0 ? 'bottom' : 'top' }));
      }
      o.push(text(i + 1, x + binW / 2 - 0.5, p1 + 2, { size: 7, color: COL.dim, anchor: 'middle', base: 'top' }));
    });
    o.push(boxBorder(336, 807, p0, p1));
    o.push(text('Hue-Angle Bin (j)', 571.5, p1 + 12, { size: 7.5, color: COL.dim, anchor: 'middle', base: 'top' }));
  };
  binPanel(rcsBins, 284, 102, -0.4, 0.4, null, 'Local Chroma Shift, Rcs,hj', (v) => `${Math.round(v * 100)}%`, (v) => { const p = Math.round(v * 100); return Math.abs(p) >= 2 ? `${p > 0 ? '+' : ''}${p}%` : ''; });
  binPanel(rhsBins.map((v) => v / 50), 394, 102, -0.5, 0.5, null, 'Local Hue Shift, Rhs,hj', (v) => v.toFixed(2), (v) => { const p = v * 50; return Math.abs(p) >= 2 ? p.toFixed(2) : ''; });
  binPanel(rfBins, 504, 118, 0, 100, Rf, 'Local Color Fidelity, Rf,hj', (v) => String(v), (v) => String(Math.round(v)));

  // ── Color vector graphic ──
  o.push(sectionLabel('Color Vector Graphic (CVG)', 18, 148));
  {
    const A = 244 * 0.4, wcx = 156, wcy = 390;
    for (let i = 0; i < 16; i++) {
      const a1 = ((90 - i * 22.5) * Math.PI) / 180, a2 = ((90 - (i + 1) * 22.5) * Math.PI) / 180;
      const [rr, gg, bb] = hueToRGB(i * 22.5 + 11.25);
      const R = A * 1.09;
      // Canvas arc(a2 -> a1) with y flipped: sweeps from a2 to a1, i.e. counter-clockwise on screen.
      const x2 = wcx + R * Math.cos(a2), y2 = wcy - R * Math.sin(a2);
      const x1 = wcx + R * Math.cos(a1), y1 = wcy - R * Math.sin(a1);
      o.push(`<path d="M${n2(wcx)},${n2(wcy)}L${n2(x2)},${n2(y2)}A${n2(R)},${n2(R)} 0 0 0 ${n2(x1)},${n2(y1)}Z" fill="rgb(${rr},${gg},${bb})" fill-opacity="0.22"/>`);
    }
    [0.25, 0.5, 0.75, 1].forEach((f) => {
      o.push(`<circle cx="${wcx}" cy="${wcy}" r="${n2(A * f)}" fill="none" stroke="${f === 1 ? 'rgba(0,0,0,0.35)' : 'rgba(0,0,0,0.08)'}" stroke-width="${f === 1 ? 1 : 0.4}"/>`);
    });
    for (let i = 0; i < 16; i++) {
      const a = ((90 - i * 22.5) * Math.PI) / 180;
      o.push(line(wcx + A * 0.05 * Math.cos(a), wcy - A * 0.05 * Math.sin(a), wcx + A * Math.cos(a), wcy - A * Math.sin(a), 'rgba(0,0,0,0.06)', 0.4));
    }
    o.push(`<circle cx="${wcx}" cy="${wcy}" r="${n2(A)}" fill="rgba(255,255,255,0.82)"/>`);
    const poly = d.cvgTest.map((p) => {
      const r = Math.max(0.05, Math.min(1.45, Math.hypot(p[0], p[1])));
      const a = Math.atan2(p[1], p[0]);
      return [wcx + A * r * Math.cos(a), wcy - A * r * Math.sin(a)];
    });
    if (poly.length) {
      o.push(`<polygon points="${poly.map((p) => `${n2(p[0])},${n2(p[1])}`).join(' ')}" fill="rgba(175,12,12,0.10)" stroke="rgba(165,10,10,0.88)" stroke-width="1.8" stroke-linejoin="round"/>`);
      poly.forEach((p) => o.push(`<circle cx="${n2(p[0])}" cy="${n2(p[1])}" r="2.2" fill="rgba(150,8,8,0.9)"/>`));
    }
    o.push(`<circle cx="${wcx}" cy="${wcy}" r="${n2(A)}" fill="none" stroke="rgba(0,0,0,0.5)" stroke-width="1.1"/>`);
    for (let i = 0; i < 16; i++) {
      const a = ((90 - i * 22.5) * Math.PI) / 180, lr = A * 1.18;
      o.push(text(i + 1, wcx + lr * Math.cos(a), wcy - lr * Math.sin(a), { size: 8, bold: true, color: 'rgba(40,40,60,0.7)', anchor: 'middle', base: 'middle' }));
    }
    // Rf / Rg above the wheel
    o.push(text(Rf, 22, 162, { size: 24, bold: true, color: fidelityColor(Rf), base: 'top' }));
    o.push(text('Rf', 22, 188, { size: 9, color: COL.dim, base: 'top' }));
    o.push(text(Rg, 290, 162, { size: 24, bold: true, color: rgColor, anchor: 'end', base: 'top' }));
    o.push(text('Rg', 290, 188, { size: 9, color: COL.dim, anchor: 'end', base: 'top' }));
    const M = 434.896;
    o.push(text(`${cct} K`, 156, M, { size: 11, bold: true, color: COL.text, anchor: 'middle' }));
    o.push(text('CCT', 156, M - 13, { size: 8, color: COL.dim, anchor: 'middle' }));
    o.push(text(`${duv >= 0 ? '+' : ''}${duv.toFixed(4)}`, 156, 450.896, { size: 10, bold: true, color: duvColor, anchor: 'middle' }));
    o.push(text('Duv', 156, 459.896, { size: 8, color: COL.dim, anchor: 'middle' }));
  }

  // ── 99 color samples ──
  {
    const N = 765 / 99;
    o.push(sectionLabel('Color Sample Fidelity, Rf,CES', 18, 636));
    [0, 25, 50, 75, 100].forEach((v) => {
      const y = 756 - (v / 100) * 108;
      o.push(line(42, y, 807, y, 'rgba(0,0,0,0.06)', 0.4));
      o.push(text(v, 38, y, { size: 7.5, color: COL.dim, anchor: 'end', base: 'middle' }));
    });
    for (let i = 0; i < 99; i++) {
      const n = (i / 99) * 16, b0 = Math.floor(n) % 16, b1 = (b0 + 1) % 16, frac = n - Math.floor(n);
      const v = rfBins[b0] * (1 - frac) + rfBins[b1] * frac;
      const [rr, gg, bb] = hueToRGB((i / 99) * 360);
      const h = (Math.max(0, v) / 100) * 108;
      o.push(rect(42 + i * N + 0.3, 756 - h, 7.427272727272728, h, `rgb(${rr},${gg},${bb})`, ' fill-opacity="0.85"'));
    }
    [1, 9, 17, 25, 33, 41, 49, 57, 65, 73, 81, 89, 97].forEach((n) => {
      o.push(text(n, 42 + (n - 0.5) * N, 759, { size: 7.5, color: COL.dim, anchor: 'middle', base: 'top' }));
    });
    o.push(text('CES Color', 424.5, 769, { size: 8, color: COL.dim, anchor: 'middle', base: 'top' }));
    o.push(boxBorder(42, 807, 648, 756));
  }

  // ── Chromaticity + CRI mini-panel ──
  {
    o.push(rect(607, 771, 200, 76, '#f4f7fb'));
    o.push(`<rect x="607" y="771" width="200" height="76" fill="none" stroke="${COL.border}" stroke-width="0.5"/>`);
    o.push(line(607, 771, 607, 847, COL.text, 2));
    o.push(text('CIE Chromaticity', 621, 779, { size: 8.5, bold: true, color: COL.text, base: 'top' }));
    const { x, y } = input;
    const den = -2 * x + 12 * y + 3;
    ([['x', x.toFixed(4)], ['y', y.toFixed(4)], ["u'", ((4 * x) / den).toFixed(4)], ["v'", ((9 * y) / den).toFixed(4)]] as [string, string][]).forEach(([k, v], i) => {
      o.push(text(k, 621, 793 + i * 15, { size: 8, color: COL.dim, base: 'top' }));
      o.push(text(v, 637, 793 + i * 15, { size: 8.5, bold: true, color: COL.strong, base: 'top', mono: true }));
    });
    o.push(text('CIE 13.3-1995 (CRI)', 715, 779, { size: 8.5, bold: true, color: COL.text, base: 'top' }));
    ([['Ra', String(Math.round(ra)), fidelityColor(ra)], ['R9', String(Math.round(r9)), r9Color]] as [string, string, string][]).forEach(([k, v, col], i) => {
      o.push(text(k, 715, 793 + i * 30, { size: 8, color: COL.dim, base: 'top' }));
      o.push(text(v, 733, 791 + i * 30, { size: 16, bold: true, color: col, base: 'top' }));
    });
    const notes = (input.notes ?? '').trim();
    if (notes) {
      o.push(text('Notes:', 18, 779, { size: 8, bold: true, color: COL.dim, base: 'top' }));
      o.push(text(notes.slice(0, 80), 18, 791, { size: 9, color: COL.strong, base: 'top' }));
    }
  }

  // ── Footer ──
  o.push(line(18, ANNEX_H - 24, 807, ANNEX_H - 24, COL.border, 0.5));
  o.push(text('Colors are for visual orientation purposes only.', 18, 1054, { size: 8, color: COL.faint, base: 'middle' }));
  o.push(text(input.generatedBy ?? 'Generated by hcri.io  ·  IES TM-30-18', 807, 1054, { size: 8, color: COL.faint, anchor: 'end', base: 'middle' }));

  o.push('</svg>');
  return o.join('');
}
