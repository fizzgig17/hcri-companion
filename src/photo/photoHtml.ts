// src/photo/photoHtml.ts
//
// The page behind "See it on a photo" (PhotoScreen): hcri.io's photo tool plus the reading's TM-30 per-hue shifts.

import { calcTm30, interpolateSpd5nm } from '../utils/rfRg';
import type { Tm30Input } from '../utils/tm30Report';
import { PHOTO_SCRIPT } from './photoScript';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function buildPhotoHtml(input: Tm30Input, c: { bg: string; text: string; dim: string; border: string; accent: string }): string {
  const pts = input.spectrum.filter((p) => isFinite(p.nm) && isFinite(p.value));
  if (pts.length < 2) throw new Error('This reading has no spectrum, so it can’t be shown on a photo.');
  const spd = interpolateSpd5nm(pts.map((p) => p.nm), pts.map((p) => Math.max(0, p.value)));
  const d = calcTm30(spd, input.cct);
  const data = {
    theme: { dim: c.dim, text: c.text, border: c.border, accent: c.accent },
    rfBins: d.rfBins, rcsBins: d.rcsBins, rhsBins: d.rhsBins,
    Rf: d.rf, Rg: d.rg, cct: input.cct, duv: input.duv,
  };
  const summary = `${Math.round(input.cct)} K · Rf ${Math.round(d.rf)} · Rg ${Math.round(d.rg)}`;
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover">
<style>
  html,body{margin:0;background:${c.bg};color:${c.text};font-family:-apple-system,Roboto,Helvetica,Arial,sans-serif;-webkit-text-size-adjust:100%}
  .page{max-width:1100px;margin:0 auto;padding:18px 20px 40px}
  h1{font-size:20px;margin:0 0 4px}
  .sub{font-size:14px;color:${c.dim};margin:0 0 6px;text-align:center}
  .help{font-size:13px;line-height:1.55;color:${c.dim};margin:0 auto 16px;max-width:760px;text-align:center}
</style></head><body><div class="page">
<p class="sub">${esc(input.title || 'Reading')} · ${esc(summary)}</p>
<p class="help">The left side of each swatch is the true (reference) colour; the right side is how this light renders it. Drag the divider to compare, or load your own photo. Photos stay on this device.</p>
<div id="root"></div></div>
<script>${PHOTO_SCRIPT}</script>
<script>window.HCRIPhoto.attach(document.getElementById('root'), function(){ return ${JSON.stringify(data)}; });</script>
</body></html>`;
}
