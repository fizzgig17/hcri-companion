// src/utils/shareCard.ts
//
// The "share card": one PNG summary of a reading (Rf/Rg tiles, CCT/Duv/Ra/R9, the spectrum, the color vector graphic,
// local fidelity bars), laid out like the card hCRI.io makes (frontend/src/components/ShareCardModal.jsx).
//
// Every number comes from the same place the report screen uses: the reading's spectrum and the app's own analysis
// (cct, duv, ra, r9), with Rf/Rg/bins/CVG from calcTm30 -- so the card always shows the values the app shows.
// buildShareCardModel() does that (pure, tested); buildShareCardHtml() wraps the model in a page whose script draws it
// on a canvas inside a hidden WebView and posts the PNG back as base64 (same approach as the TM-30 "Save image").

import { Buffer } from 'buffer';
import { calcTm30, interpolateSpd5nm, tm30ReferenceSpd } from './rfRg';
import type { Tm30Input } from './tm30Report';

export const SHARE_CARD_W = 540;

export interface ShareCardModel {
  dark: boolean;
  accent: string;
  /** Page text color in the light theme (the dark theme is always white). */
  text: string;
  dim: string;
  title: string;
  dateText: string;
  notes: string;
  source: string;
  Rf: number;
  Rg: number;
  cct: number;
  duv: number;
  ra: number;
  r9: number;
  bins: number[];
  wls: number[];
  vals: number[];
  /** Reference illuminant at the same wavelengths (same scale as the measured curve is drawn against its own peak). */
  refVals: number[];
  /** 16 color-vector-graphic points, reference normalised to a unit circle. */
  cvg: [number, number][];
  /** Reference illuminant's 16 points (the arrows start here). */
  cvgRef: [number, number][];
  footer: string;
}

export interface ShareCardLook {
  dark: boolean;
  accent: string;
  text: string;
  dim: string;
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** "2026-10-22 18:17", local time, like the date in the card header. */
export function cardDateText(takenAt?: number): string {
  const d = new Date(takenAt ?? Date.now());
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function ledText(input: Tm30Input): string {
  const list = input.leds && input.leds.length ? input.leds : input.led ? [input.led] : [];
  return list
    .map((l) => [[l.brand, l.model].filter(Boolean).join(' '), l.cct ? `${String(l.cct).replace(/\s*k$/i, '')}K` : ''].filter(Boolean).join(' · '))
    .filter(Boolean)
    .join(' / ');
}

/** File name for the saved/shared PNG: "<title>_hcri.png", safe characters only. */
export function shareCardFileName(title: string): string {
  const base = (title || 'reading').replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'reading';
  return `${base}_hcri.png`;
}

/** Rf word under the big number (thresholds as on hCRI.io). */
/** Width / height of a PNG from its base64 (IHDR chunk), or null if it isn't one. */
export function pngAspect(base64: string): number | null {
  try {
    const b = Buffer.from(base64.slice(0, 48), 'base64');
    if (b.length < 24 || b.readUInt32BE(0) !== 0x89504e47) return null;
    const w = b.readUInt32BE(16), h = b.readUInt32BE(20);
    return w > 0 && h > 0 ? w / h : null;
  } catch { return null; }
}

export function rfLabel(rf: number): string {
  return rf >= 90 ? 'Excellent' : rf >= 80 ? 'Good' : rf >= 70 ? 'Moderate' : 'Low';
}

/** Rg word under the big number (thresholds as on hCRI.io). */
export function rgLabel(rg: number): string {
  return rg > 110 ? 'Expanded' : rg >= 98 ? 'Normal' : 'Compressed';
}

export function buildShareCardModel(input: Tm30Input, look: ShareCardLook, version: string): ShareCardModel {
  const pts = input.spectrum.filter((p) => isFinite(p.nm) && isFinite(p.value));
  if (pts.length < 2) throw new Error('The reading has no spectrum to draw.');
  const wls = pts.map((p) => p.nm);
  const vals = pts.map((p) => Math.max(0, p.value));
  const d = calcTm30(interpolateSpd5nm(wls, vals), input.cct);
  // Reference illuminant sampled at the measured wavelengths (tm30ReferenceSpd is 380-780 nm in 5 nm steps).
  const ref5 = tm30ReferenceSpd(input.cct);
  const refVals = wls.map((w) => {
    const f = Math.max(0, Math.min(80, (w - 380) / 5));
    const i = Math.floor(f);
    const j = Math.min(80, i + 1);
    return ref5[i] + (ref5[j] - ref5[i]) * (f - i);
  });
  return {
    dark: look.dark,
    accent: look.accent,
    text: look.text,
    dim: look.dim,
    title: input.title || '',
    dateText: cardDateText(input.takenAt),
    notes: input.notes || '',
    source: ledText(input),
    Rf: d.rf,
    Rg: d.rg,
    cct: Math.round(input.cct),
    duv: input.duv,
    ra: input.ra,
    r9: input.r9,
    bins: d.rfBins,
    wls,
    vals,
    refVals,
    cvg: d.cvgTest,
    cvgRef: d.cvgRef,
    footer: `hcri.io  ·  LED Color Rendering Analysis  ·  Companion v${version}`,
  };
}

/** A page that draws the card and posts 'png:<base64>' (or 'err:<message>') to the app. */
export function buildShareCardHtml(m: ShareCardModel): string {
  const json = JSON.stringify(m).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return `<!doctype html><html><head><meta charset="utf-8"></head><body><script>
(function(){
  function send(s){ try { window.ReactNativeWebView.postMessage(s); } catch (e) {} }
  try {
    var D = ${json};
    var W = ${SHARE_CARD_W}, S = 2;
    function hueToRGB(h){ function f(a){ return Math.max(30, Math.min(240, Math.round(128 + 127 * Math.cos(a * Math.PI / 180)))); } return [f(h), f(h - 120), f(h + 120)]; }
    function wlToRGB(wl){
      if (wl < 440) { var t = (wl - 380) / 60; return [0, 0, Math.min(255, Math.round(130 + 125 * t))]; }
      if (wl < 490) { var t2 = (wl - 440) / 50; return [0, Math.round(255 * t2), 255]; }
      if (wl < 510) { var t3 = (wl - 490) / 20; return [0, 255, Math.round(255 * (1 - t3))]; }
      if (wl < 580) { var t4 = (wl - 510) / 70; return [Math.round(255 * t4), Math.round(200 + 55 * (1 - t4)), 0]; }
      if (wl < 645) { var t5 = (wl - 580) / 65; return [255, Math.round(180 * (1 - t5)), 0]; }
      return [Math.round(255 * (1 - ((wl - 645) / 135) * 0.3)), 0, 0];
    }
    function rr(ctx, x, y, w, h, r, mode){
      ctx.beginPath(); ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.arcTo(x + w, y, x + w, y + r, r);
      ctx.lineTo(x + w, y + h - r); ctx.arcTo(x + w, y + h, x + w - r, y + h, r); ctx.lineTo(x + r, y + h);
      ctx.arcTo(x, y + h, x, y + h - r, r); ctx.lineTo(x, y + r); ctx.arcTo(x, y, x + r, y, r); ctx.closePath();
      if (mode === 'fill') ctx.fill(); else ctx.stroke();
    }
    function clip(ctx, s, maxW){ if (ctx.measureText(s).width <= maxW) return s; while (s.length > 1 && ctx.measureText(s + '…').width > maxW) s = s.slice(0, -1); return s + '…'; }

    var dark = D.dark, accent = D.accent;
    var Rf = D.Rf, Rg = D.Rg, cct = D.cct, duv = D.duv, ra = D.ra, r9 = D.r9, bins = D.bins;
    var bgTop = dark ? '#0a1628' : '#f0f4f8', bgBot = dark ? '#060a0f' : '#e4eaf2';
    var gridLine = dark ? 'rgba(255,255,255,0.025)' : 'rgba(0,0,80,0.04)';
    var headerBg = accent + (dark ? '14' : '12'), headerBorder = accent + (dark ? '35' : '45');
    var tileBg = dark ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.85)';
    var tileBorder = dark ? 'rgba(80,140,200,0.18)' : 'rgba(40,90,160,0.22)';
    var textCol = dark ? '#ffffff' : D.text;
    var dimCol = dark ? 'rgba(140,190,230,0.75)' : D.dim;
    var rfCol = Rf >= 85 ? (dark ? '#00e888' : '#007a3a') : Rf >= 70 ? (dark ? '#ffcc33' : '#996600') : (dark ? '#ff4466' : '#cc1133');
    var rgCol = Math.abs(Rg - 100) <= 8 ? (dark ? '#00e888' : '#007a3a') : (dark ? '#ffcc33' : '#996600');
    var rfWord = Rf >= 90 ? 'Excellent' : Rf >= 80 ? 'Good' : Rf >= 70 ? 'Moderate' : 'Low';
    var rgWord = Rg > 110 ? 'Expanded' : Rg >= 98 ? 'Normal' : 'Compressed';
    var rfTileBg = dark ? 'rgba(0,232,136,0.08)' : 'rgba(0,180,100,0.08)', rfTileBorder = dark ? 'rgba(0,232,136,0.22)' : 'rgba(0,160,80,0.3)', rfTileText = dark ? 'rgba(180,255,220,0.95)' : 'rgba(0,100,50,0.9)';
    var rgTileBg = dark ? 'rgba(120,80,220,0.1)' : 'rgba(100,60,200,0.07)', rgTileBorder = dark ? 'rgba(160,120,255,0.22)' : 'rgba(120,80,220,0.3)', rgTileText = dark ? 'rgba(220,200,255,0.95)' : 'rgba(80,40,160,0.9)';
    var fidelityLabelCol = dark ? 'rgba(240,240,240,0.9)' : 'rgba(10,10,10,0.8)';
    var footerBg = accent + (dark ? '08' : '10'), footerBorder = accent + (dark ? '20' : '40');
    var MONO = 'monospace';

    var hasSource = !!D.source, hasNotes = !!D.notes;
    var cardH = 944;
    if (hasSource || hasNotes) cardH += 16 + (hasSource ? 34 : 0) + (hasNotes ? 28 : 0);

    var canvas = document.createElement('canvas');
    canvas.width = W * S; canvas.height = cardH * S;
    var ctx = canvas.getContext('2d'); ctx.scale(S, S);
    var y = 0;
    var grad = ctx.createLinearGradient(0, 0, 0, cardH); grad.addColorStop(0, bgTop); grad.addColorStop(1, bgBot);
    ctx.fillStyle = grad; ctx.fillRect(0, 0, W, cardH);
    ctx.strokeStyle = gridLine; ctx.lineWidth = 1;
    for (var gy = 0; gy < cardH; gy += 36) { ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke(); }

    // Header
    ctx.fillStyle = headerBg; ctx.fillRect(0, 0, W, 80);
    ctx.strokeStyle = headerBorder; ctx.beginPath(); ctx.moveTo(0, 80); ctx.lineTo(W, 80); ctx.stroke();
    ctx.textBaseline = 'middle'; ctx.fillStyle = textCol; ctx.font = 'bold 30px ' + MONO; ctx.textAlign = 'left';
    ctx.fillText('hCRI', 20, 30);
    var logoW = ctx.measureText('hCRI').width;
    ctx.fillStyle = accent; ctx.fillText('.io', 20 + logoW, 30);
    ctx.fillStyle = dimCol; ctx.font = '10px ' + MONO; ctx.fillText('LED  ·  TM-30  ·  COLOR RENDERING', 20, 56);
    ctx.textAlign = 'right'; ctx.font = '11px ' + MONO; ctx.fillText(D.dateText, 524, 28);
    ctx.fillStyle = textCol; ctx.font = 'bold 13px ' + MONO; ctx.fillText(clip(ctx, D.title, 300), 524, 50);

    // Rf / Rg tiles
    y = 90;
    function bigTile(x, bg, border, tcol, head, val, vcol, word){
      ctx.fillStyle = 'rgba(0,0,0,0.15)'; rr(ctx, x, y, 252, 108, 8, 'fill');
      ctx.fillStyle = bg; rr(ctx, x, y, 252, 108, 8, 'fill');
      ctx.strokeStyle = border; ctx.lineWidth = 0.8; rr(ctx, x, y, 252, 108, 8, 'stroke');
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillStyle = tcol; ctx.font = 'bold 11px ' + MONO; ctx.fillText(head, x + 10, y + 10);
      ctx.fillStyle = vcol; ctx.font = 'bold 52px ' + MONO; ctx.fillText(String(val), x + 10, y + 24);
      ctx.fillStyle = tcol; ctx.font = 'bold 12px ' + MONO; ctx.fillText(word, x + 10, y + 86);
    }
    bigTile(16, rfTileBg, rfTileBorder, rfTileText, 'Rf  FIDELITY', Rf, rfCol, rfWord);
    bigTile(272, rgTileBg, rgTileBorder, rgTileText, 'Rg  GAMUT', Rg, rgCol, rgWord);
    y += 120;

    // CCT / Duv / Ra / R9
    var duvTxt = (duv >= 0 ? '+' : '') + duv.toFixed(4);
    [['CCT', cct + 'K', accent], ['Duv', duvTxt, Math.abs(duv) < 0.006 ? '#00e888' : '#ffcc33'], ['Ra (CRI)', String(Math.round(ra)), textCol],
     ['R9', String(Math.round(r9)), r9 >= 50 ? '#00e888' : r9 >= 0 ? '#ffcc33' : '#ff4466']].forEach(function(t, i){
      var x = 16 + i * 127;
      ctx.fillStyle = tileBg; rr(ctx, x + 1, y, 125, 52, 5, 'fill');
      ctx.strokeStyle = tileBorder; ctx.lineWidth = 0.5; rr(ctx, x + 1, y, 125, 52, 5, 'stroke');
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillStyle = dimCol; ctx.font = '9px ' + MONO; ctx.fillText(t[0], x + 7, y + 7);
      ctx.fillStyle = t[2]; ctx.font = 'bold ' + (t[1].length > 6 ? 15 : 19) + 'px ' + MONO; ctx.fillText(t[1], x + 7, y + 20);
    });
    y += 60;

    // SPD
    ctx.fillStyle = dimCol; ctx.font = '10px ' + MONO; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillText('SPECTRAL POWER DISTRIBUTION', 16, y + 12);
    y += 16;
    ctx.fillStyle = tileBg; rr(ctx, 16, y, 508, 134, 6, 'fill');
    (function(){
      var wls = D.wls, vals = D.vals, maxV = 0, minWl = wls[0], maxWl = wls[0], i;
      for (i = 0; i < vals.length; i++) { if (vals[i] > maxV) maxV = vals[i]; if (wls[i] < minWl) minWl = wls[i]; if (wls[i] > maxWl) maxWl = wls[i]; }
      if (!(maxV > 0)) maxV = 1;
      var span = Math.max(1, maxWl - minWl);
      var cTop = y + 10, cBot = y + 134 - 12, cH = cBot - cTop;
      function px(wl){ return 24 + ((wl - minWl) / span) * 492; }
      ctx.strokeStyle = gridLine; ctx.lineWidth = 0.5;
      [450, 500, 550, 600, 650, 700].forEach(function(wl){ ctx.beginPath(); ctx.moveTo(px(wl), cTop); ctx.lineTo(px(wl), cBot); ctx.stroke(); });
      for (i = 1; i < wls.length; i++) {
        var x1 = px(wls[i - 1]), x2 = px(wls[i]);
        var avgH = ((vals[i - 1] + vals[i]) / 2 / maxV) * cH * 0.92;
        var c = wlToRGB(Math.round((wls[i] + wls[i - 1]) / 2));
        var r1 = Math.max(0, Math.min(255, Math.round(185 + (c[0] - 185) * 0.55))), g1 = Math.max(0, Math.min(255, Math.round(185 + (c[1] - 185) * 0.55))), b1 = Math.max(0, Math.min(255, Math.round(185 + (c[2] - 185) * 0.55)));
        ctx.fillStyle = 'rgba(' + r1 + ',' + g1 + ',' + b1 + ',' + (dark ? 0.9 : 0.85) + ')';
        ctx.fillRect(x1, cBot - avgH, Math.max(0.5, x2 - x1), avgH);
      }
      ctx.beginPath();
      for (i = 0; i < wls.length; i++) { var yy = cBot - (vals[i] / maxV) * cH * 0.92; if (i === 0) ctx.moveTo(px(wls[i]), yy); else ctx.lineTo(px(wls[i]), yy); }
      ctx.strokeStyle = dark ? 'rgba(210,30,30,0.85)' : 'rgba(170,10,10,0.9)'; ctx.lineWidth = 1.8; ctx.stroke();
      var ref = D.refVals, refMax = 0;
      for (i = 0; i < ref.length; i++) if (ref[i] > refMax) refMax = ref[i];
      if (refMax > 0) {
        ctx.beginPath();
        for (i = 0; i < wls.length; i++) { var ry = cBot - (ref[i] / refMax) * cH * 0.92; if (i === 0) ctx.moveTo(px(wls[i]), ry); else ctx.lineTo(px(wls[i]), ry); }
        ctx.strokeStyle = dark ? 'rgba(180,180,180,0.5)' : 'rgba(80,80,80,0.45)'; ctx.lineWidth = 1.2;
        ctx.setLineDash([4, 3]); ctx.stroke(); ctx.setLineDash([]);
      }
      ctx.fillStyle = dimCol; ctx.font = '9px ' + MONO; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      [400, 500, 600, 700].forEach(function(wl){ if (wl >= minWl && wl <= maxWl) ctx.fillText(String(wl), px(wl), cBot + 3); });
    })();
    y += 134;

    // Color vector graphic
    ctx.fillStyle = dimCol; ctx.font = '10px ' + MONO; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillText('COLOR VECTOR GRAPHIC', 16, y + 12);
    y += 18;
    // Wheel: the same drawing as the TM-30 report (utils/tm30Report.ts cvgWheel), scaled from its 108 radius to R.
    var R = 84, k = R / 108;
    ctx.textBaseline = 'top';
    ctx.fillStyle = rfCol; ctx.font = 'bold 25px ' + MONO; ctx.textAlign = 'left'; ctx.fillText(String(Rf), 16, y);
    ctx.fillStyle = dimCol; ctx.font = '11px ' + MONO; ctx.fillText('Rf', 16, y + 27);
    ctx.fillStyle = rgCol; ctx.font = 'bold 25px ' + MONO; ctx.textAlign = 'right'; ctx.fillText(String(Rg), 524, y);
    ctx.fillStyle = dimCol; ctx.font = '11px ' + MONO; ctx.fillText('Rg', 524, y + 27);
    var cx = 270, cvgCy = y + 1.25 * R + 12;
    function pt(r, aDeg){ var a = aDeg * Math.PI / 180; return [cx + r * Math.cos(a), cvgCy - r * Math.sin(a)]; }
    for (var h = 0; h < 16; h++) {
      var hc = hueToRGB(h * 22.5 + 11.25), mix = 0.45;
      var p1 = pt(R + 16 * k, h * 22.5), p2 = pt(R + 16 * k, h * 22.5 + 22.5);
      ctx.beginPath(); ctx.moveTo(cx, cvgCy); ctx.lineTo(p1[0], p1[1]);
      ctx.arc(cx, cvgCy, R + 16 * k, -(h * 22.5) * Math.PI / 180, -(h * 22.5 + 22.5) * Math.PI / 180, true);
      ctx.closePath();
      ctx.fillStyle = 'rgb(' + Math.trunc(170 + (hc[0] - 170) * mix) + ',' + Math.trunc(170 + (hc[1] - 170) * mix) + ',' + Math.trunc(170 + (hc[2] - 170) * mix) + ')';
      ctx.fill();
    }
    ctx.beginPath(); ctx.arc(cx, cvgCy, R, 0, Math.PI * 2); ctx.fillStyle = '#f8f9fc'; ctx.fill();
    [0.25, 0.5, 0.75, 1].forEach(function(f){
      ctx.beginPath(); ctx.arc(cx, cvgCy, R * f, 0, Math.PI * 2);
      ctx.strokeStyle = f === 1 ? '#1e1e1e' : '#b4bed2'; ctx.lineWidth = (f === 1 ? 1.6 : 0.6) * k; ctx.stroke();
    });
    ctx.strokeStyle = '#c8d2dc'; ctx.lineWidth = 0.5 * k;
    for (h = 0; h < 16; h++) { var s1 = pt(17 * k, h * 22.5), s2 = pt(R, h * 22.5); ctx.beginPath(); ctx.moveTo(s1[0], s1[1]); ctx.lineTo(s2[0], s2[1]); ctx.stroke(); }
    function mapPt(p){
      var r = Math.max(0.05, Math.min(1.45, Math.sqrt(p[0] * p[0] + p[1] * p[1]))), a = Math.atan2(p[1], p[0]);
      return [cx + R * r * Math.cos(a), cvgCy - R * r * Math.sin(a)];
    }
    var tp = D.cvg.map(mapPt), rp = D.cvgRef.map(mapPt);
    if (tp.length) {
      ctx.beginPath(); ctx.moveTo(tp[0][0], tp[0][1]);
      tp.slice(1).forEach(function(q){ ctx.lineTo(q[0], q[1]); });
      ctx.closePath(); ctx.fillStyle = 'rgba(190,25,25,0.12)'; ctx.fill();
      ctx.strokeStyle = '#be1919'; ctx.lineWidth = 2 * k; ctx.lineJoin = 'round'; ctx.stroke();
      rp.forEach(function(r0, i){
        var t = tp[i], dx = t[0] - r0[0], dy = t[1] - r0[1], len = Math.sqrt(dx * dx + dy * dy);
        if (len < 1.2 * k) return;
        var ux = dx / len, uy = dy / len, hd = 4 * k, hw = 1.6 * k;
        ctx.strokeStyle = '#1e3c96'; ctx.lineWidth = 1 * k;
        ctx.beginPath(); ctx.moveTo(r0[0], r0[1]); ctx.lineTo(t[0], t[1]); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(t[0], t[1]); ctx.lineTo(t[0] - ux * hd - uy * hw, t[1] - uy * hd + ux * hw); ctx.lineTo(t[0] - ux * hd + uy * hw, t[1] - uy * hd - ux * hw); ctx.closePath();
        ctx.fillStyle = '#1e3c96'; ctx.fill();
      });
      tp.forEach(function(q){ ctx.beginPath(); ctx.arc(q[0], q[1], 2.6 * k, 0, Math.PI * 2); ctx.fillStyle = '#aa0f0f'; ctx.fill(); });
    }
    ctx.beginPath(); ctx.arc(cx, cvgCy, R, 0, Math.PI * 2); ctx.strokeStyle = '#141414'; ctx.lineWidth = 1.6 * k; ctx.stroke();
    ctx.font = 'bold 10px ' + MONO; ctx.fillStyle = '#141414'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (h = 0; h < 16; h++) { var lp = pt(R + 27 * k, h * 22.5 + 11.25); ctx.fillText(String(h + 1), lp[0], lp[1]); }
    // CCT / Duv stacked in the middle of the wheel.
    ctx.textBaseline = 'alphabetic';
    var line1 = cvgCy + R * 0.34, line2 = cvgCy + R * 0.56;
    ctx.font = 'bold 13px ' + MONO;
    [['CCT', cct + ' K', line1], ['Duv', duvTxt, line2]].forEach(function(t){
      var wl = ctx.measureText(t[0] + '  ').width, wv = ctx.measureText(t[1]).width, x0 = cx - (wl + wv) / 2;
      ctx.textAlign = 'left';
      ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillText(t[0], x0, t[2]);
      ctx.fillStyle = '#0a0a0a'; ctx.fillText(t[1], x0 + wl, t[2]);
    });
    y = cvgCy + 1.25 * R + 14;

    // Source / notes
    if (hasSource || hasNotes) {
      y += 10;
      if (hasSource) {
        ctx.fillStyle = tileBg; rr(ctx, 16, y, 508, 32, 5, 'fill');
        ctx.strokeStyle = tileBorder; ctx.lineWidth = 0.5; rr(ctx, 16, y, 508, 32, 5, 'stroke');
        ctx.fillStyle = dimCol; ctx.font = '10px ' + MONO; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText('LED', 24, y + 10);
        ctx.fillStyle = textCol; ctx.font = 'bold 12px ' + MONO; ctx.fillText(clip(ctx, D.source, 490), 24, y + 24);
      }
      if (hasNotes) {
        var ny = hasSource ? y + 36 : y;
        ctx.fillStyle = tileBg; rr(ctx, 16, ny, 508, 26, 5, 'fill');
        ctx.fillStyle = dimCol; ctx.font = '10px ' + MONO; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        ctx.fillText(clip(ctx, 'NOTES  ' + D.notes, 490), 24, ny + 13);
      }
      y += hasSource && hasNotes ? 62 : hasSource ? 32 : 26;
    }

    // Local fidelity
    y += 10;
    ctx.fillStyle = dimCol; ctx.font = '10px ' + MONO; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillText('LOCAL COLOR FIDELITY  (Rf,hj)', 16, y + 12);
    y += 16;
    ctx.fillStyle = tileBg; rr(ctx, 16, y, 508, 74, 5, 'fill');
    var binW = 508 / 16;
    bins.forEach(function(v, hh){
      var barH = (Math.max(0, Math.min(100, v)) / 100) * 58 * 0.95, hc2 = hueToRGB(hh * 22.5 + 11.25);
      ctx.fillStyle = 'rgb(' + hc2[0] + ',' + hc2[1] + ',' + hc2[2] + ')';
      ctx.fillRect(16 + hh * binW + 1, y + 74 - 8 - barH, binW - 2, barH);
      ctx.fillStyle = fidelityLabelCol; ctx.font = 'bold 8px ' + MONO; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.fillText(String(Math.round(v)), 16 + hh * binW + binW / 2, y + 74 - 10 - barH);
    });
    y += 74;

    // Footer
    y += 10;
    ctx.fillStyle = footerBg; ctx.fillRect(0, y, W, 36);
    ctx.strokeStyle = footerBorder; ctx.lineWidth = 0.5; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    ctx.fillStyle = accent; ctx.font = 'bold 12px ' + MONO; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(D.footer, W / 2, y + 18);

    var finalH = Math.min(cardH, Math.ceil(y + 36));
    var out = document.createElement('canvas'); out.width = W * S; out.height = finalH * S;
    out.getContext('2d').drawImage(canvas, 0, 0);
    send('png:' + out.toDataURL('image/png').split(',')[1]);
  } catch (e) { send('err:' + (e && e.message ? e.message : e)); }
})();
</script></body></html>`;
}
