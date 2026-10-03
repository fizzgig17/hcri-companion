// src/components/ChromaticityChart.tsx
//
// A CIE 1931 chromaticity diagram, styled to match the reference image the
// user provided directly (a filled rainbow horseshoe, "CIE 1931" title,
// dotted gridlines, plain white background, a plain stacked list of CCT
// values in the right margin with no leader lines, and wavelength numbers
// along the locus border in their own hue).
//
// The x/y/CCT/Duv this chart is handed come from analyzeSpectrum() in
// ../utils/spectralAnalysis.ts -- a line-for-line port of hCRI.io's own
// production algorithm (spd.php), computed once per reading in
// HomeScreen.tsx and passed down -- never from the device's own onboard
// x/y/cct/duv fields, and never a separate local approximation of them.
// That's deliberate: it's the same trust boundary hCRI.io itself has always
// had (it only ever receives the raw spectrum, see buildCsv.ts), so this
// chart can't be thrown off by a wrong field offset on any given
// model/firmware state the way the old device-reported numbers could, and
// it can't quietly disagree with what hCRI.io itself will compute for the
// same upload either.
//
// The horseshoe/locus shape itself now comes from exactSpectralLocus5nm()
// in ../utils/spectralAnalysis.ts -- the real CIE 1931 spectral locus,
// computed directly from the exact tabulated CMF_X/CMF_Y/CMF_Z data ported
// verbatim from hCRI.io's own spd.php (the same tables analyzeSpectrum()
// itself integrates against), not a closed-form approximation of their
// shape.
//
// The fill itself is no longer drawn as a fan of gradient triangles at all.
// It turns out hCRI.io's OWN frontend does draw a filled 2D chromaticity
// chart -- just not in ReportView.jsx/ThreeViewer.jsx (those are a
// different, 3D wireframe-only view). The real one is in assets/app.js
// (function L(), the report page's "CIE 1931" canvas card): it renders into
// an offscreen <canvas>, computing a genuine PER-PIXEL raster -- for every
// pixel inside the horseshoe polygon, it inverse-maps screen position back
// to (x, y), runs that through a closed-form xy->sRGB conversion (function
// ee(): xyY with Y=1 -> linear sRGB via the CIE XYZ matrix -> desaturate
// out-of-gamut colors by shifting the most-negative channel to 0 ->
// normalize so the brightest channel hits 1 -> sRGB gamma encode), and
// writes that pixel directly via putImageData. That's fundamentally
// different from -- and doesn't share any of the failure modes of -- a
// small number of gradient triangles fanned from a shared center point,
// which is exactly why this app's old approach kept showing seams, a
// washed-out interior, and a broken-looking edge in tightly-curved regions
// no matter how it was subdivided or reordered.
//
// A true per-pixel raster isn't something to redo every frame on a phone
// screen the way hCRI.io's own JS does on page load, though -- and it
// doesn't need to be: the horseshoe's shape and colors never depend on any
// particular reading (only the Planckian curve, ticks, and the reading's
// own dot do). So it's baked ONCE, offline, using hCRI.io's own ee(x,y)
// formula and a point-in-polygon mask against the exact locus
// (scripts/bakeCieChart.js -> src/assets/cie1931_fill.png, 512x576,
// anti-aliased, domain [0,0.8]x[0,0.9] matching X_DOMAIN/Y_DOMAIN below
// exactly so it stretches onto the plot box with zero distortion), and
// rendered here as a plain <Image>, with the Planckian curve, gridlines,
// ticks, and the reading's dot still drawn as live SVG geometry on top.
//
// The Planckian (blackbody) curve is a separate concern -- still
// cieChromaticity.ts's closed-form xy approximation (planckianLocusXy,
// planckianTick, CCT_TICKS_K), which is fine here: it's pure SVG geometry
// for where to draw the blackbody line, not a colorimetric result, and
// it's the same approximation spd.php's own non-hires cct_to_xy() uses.
// Only the actual reading's marker position and the numbers shown
// alongside it need to match hCRI.io's real computation exactly (see
// analyzeSpectrum(), which is what feeds x/y/cct into this component).
//
// Requires react-native-svg (already a dependency -- see SpectrumChart.tsx).

import React, { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Polygon, Polyline, Circle, Line, Rect, Text as SvgText, Image as SvgImage } from 'react-native-svg';
import { planckianLocusXy, planckianTick, CCT_TICKS_K, XY } from '../utils/cieChromaticity';
import { exactSpectralLocus5nm } from '../utils/spectralAnalysis';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const CIE_FILL_IMAGE = require('../assets/cie1931_fill.png');
// The baked PNG's own domain -- must match X_DOMAIN/Y_DOMAIN below and
// scripts/bakeCieChart.js's X_DOMAIN/Y_DOMAIN, or the raster will land in
// the wrong place (or be visibly stretched) relative to the live-drawn
// locus/Planckian curve/dot on top of it.
const FILL_IMAGE_DOMAIN = { x: [0.0, 0.8] as [number, number], y: [0.0, 0.9] as [number, number] };

interface Props {
  x: number;
  y: number;
  cct?: number;
  height?: number;
}

// Extra room on the right for the plain stacked CCT-label column, and a
// little extra on top for the "CIE 1931" title.
const PADDING = { top: 26, right: 34, bottom: 24, left: 32 };

const X_DOMAIN: [number, number] = [0.0, 0.8];
const Y_DOMAIN: [number, number] = [0.0, 0.9];

// Only every-other 0.1 gridline gets a label, matching the reference image
// (0.1, 0.3, 0.5, 0.7) -- gridlines themselves are still drawn at every 0.1.
const ALL_TICKS = [0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8];
const LABELED_X_TICKS = new Set([0.1, 0.3, 0.5, 0.7]);
const LABELED_Y_TICKS = new Set([0.1, 0.2, 0.4, 0.6, 0.8]);

const LOCUS_LABEL_NM = [470, 480, 500, 520, 540, 560, 570, 580, 600, 620, 700];

/** Same wavelength->RGB approximation used elsewhere for coloring by wavelength -- only used for the labels' own text color now, the fill itself comes from the baked raster (see the top-of-file comment). */
function wavelengthToColor(wavelengthNm: number): string {
  const wl = Math.max(380, Math.min(780, wavelengthNm));
  let r = 0;
  let g = 0;
  let b = 0;
  if (wl < 440) {
    r = -(wl - 440) / (440 - 380);
    b = 1;
  } else if (wl < 490) {
    g = (wl - 440) / (490 - 440);
    b = 1;
  } else if (wl < 510) {
    g = 1;
    b = -(wl - 510) / (510 - 490);
  } else if (wl < 580) {
    r = (wl - 510) / (580 - 510);
    g = 1;
  } else if (wl < 645) {
    r = 1;
    g = -(wl - 645) / (645 - 580);
  } else {
    r = 1;
  }
  const to255 = (c: number) => Math.round(Math.max(0, Math.min(1, c)) * 255);
  return `rgb(${to255(r)}, ${to255(g)}, ${to255(b)})`;
}

export default function ChromaticityChart({ x, y, cct, height = 300 }: Props) {
  const [width, setWidth] = useState(0);

  const chartWidth = Math.max(width - PADDING.left - PADDING.right, 0);
  const chartHeight = height - PADDING.top - PADDING.bottom;

  const xFor = (dx: number) => PADDING.left + ((dx - X_DOMAIN[0]) / (X_DOMAIN[1] - X_DOMAIN[0])) * chartWidth;
  const yFor = (dy: number) => PADDING.top + chartHeight - ((dy - Y_DOMAIN[0]) / (Y_DOMAIN[1] - Y_DOMAIN[0])) * chartHeight;

  // The real CIE 1931 locus is only tabulated every 5nm (81 points,
  // 380-780nm). That's accurate but visually a bit faceted for a filled
  // fan of triangles, so it's densified by linearly interpolating between
  // each pair of real points -- each subdivided point still carries its
  // own (linearly-interpolated) nm for coloring, it's just extra
  // resolution on an already-correct curve, not a re-approximation of it.
  function densifyLocus(points: { nm: number; x: number; y: number }[], subdivisions: number) {
    const out: { nm: number; x: number; y: number }[] = [];
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i];
      const b = points[i + 1];
      for (let s = 0; s < subdivisions; s++) {
        const t = s / subdivisions;
        out.push({ nm: a.nm + (b.nm - a.nm) * t, x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      }
    }
    out.push(points[points.length - 1]);
    return out;
  }
  // Cap at 700nm, matching the reference image (it only labels/shows up to
  // 700). Past that the real locus has essentially converged to a single
  // point (the tabulated x/y barely move at all from 700-780nm), so the
  // last few points differ from each other only by the table's own
  // rounding -- carrying them through would add angular jitter from that
  // rounding noise for zero visible benefit (they're indistinguishable
  // from the 700nm point on screen anyway).
  const locusNm = densifyLocus(exactSpectralLocus5nm().filter((p) => p.nm <= 700), 3);

  const planckianPoints: XY[] = [];
  for (let t = 1667; t <= 15000; t += t < 4000 ? 40 : 150) {
    planckianPoints.push(planckianLocusXy(t));
  }

  const cctLabelX = PADDING.left + chartWidth + 4;

  // Approximate centroid in screen space, used to push wavelength labels
  // outward from the curve rather than inward over the fill.
  const centroidPx = { x: xFor(0.33), y: yFor(0.33) };

  return (
    <View style={styles.container} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      <Text style={styles.title}>CIE 1931</Text>
      {width > 0 && (
        <Svg width={width} height={height}>
          {/* Plain white background, dotted gridlines at every 0.1, labels
              at every other tick -- matching the reference image. */}
          <Polygon
            points={`${PADDING.left},${PADDING.top} ${PADDING.left + chartWidth},${PADDING.top} ${
              PADDING.left + chartWidth
            },${PADDING.top + chartHeight} ${PADDING.left},${PADDING.top + chartHeight}`}
            fill="#ffffff"
          />
          {ALL_TICKS.map((t) => (
            <React.Fragment key={`x${t}`}>
              <Line
                x1={xFor(t)}
                y1={PADDING.top}
                x2={xFor(t)}
                y2={PADDING.top + chartHeight}
                stroke="#d8d8d8"
                strokeWidth={0.5}
                strokeDasharray="1,2"
              />
              {LABELED_X_TICKS.has(t) && (
                <SvgText x={xFor(t)} y={height - 8} fontSize={9} fill="#888" textAnchor="middle">
                  {t.toFixed(1)}
                </SvgText>
              )}
            </React.Fragment>
          ))}
          {ALL_TICKS.map((t) => (
            <React.Fragment key={`y${t}`}>
              <Line
                x1={PADDING.left}
                y1={yFor(t)}
                x2={PADDING.left + chartWidth}
                y2={yFor(t)}
                stroke="#d8d8d8"
                strokeWidth={0.5}
                strokeDasharray="1,2"
              />
              {LABELED_Y_TICKS.has(t) && (
                <SvgText x={PADDING.left - 5} y={yFor(t) + 3} fontSize={9} fill="#888" textAnchor="end">
                  {t.toFixed(1)}
                </SvgText>
              )}
            </React.Fragment>
          ))}

          {/* The filled horseshoe: a single baked per-pixel raster (see the
              top-of-file comment), stretched over the plot box. Its own
              domain (FILL_IMAGE_DOMAIN) matches X_DOMAIN/Y_DOMAIN exactly,
              so mapping its four corners through the same xFor/yFor used
              for every other point on this chart lands it in exactly the
              right place with no separate scale/offset math to keep in
              sync by hand. preserveAspectRatio="none" stretches it to fill
              that box exactly -- correct even when the box itself isn't
              equal-scale on x vs y, which matches how every other point on
              this chart (locus, Planckian curve, dot) is already mapped. */}
          <SvgImage
            href={CIE_FILL_IMAGE}
            x={xFor(FILL_IMAGE_DOMAIN.x[0])}
            y={yFor(FILL_IMAGE_DOMAIN.y[1])}
            width={xFor(FILL_IMAGE_DOMAIN.x[1]) - xFor(FILL_IMAGE_DOMAIN.x[0])}
            height={yFor(FILL_IMAGE_DOMAIN.y[0]) - yFor(FILL_IMAGE_DOMAIN.y[1])}
            preserveAspectRatio="none"
          />

          {/* Wavelength numbers along the locus border, in each wavelength's
              own hue, placed just outside the curve. */}
          {LOCUS_LABEL_NM.map((wl) => {
            // Find the densified locus point closest to this label's
            // wavelength -- no longer a fixed-step index lookup, since
            // densifyLocus's spacing isn't a round number of nm per index.
            let idx = 0;
            let bestDiff = Infinity;
            for (let i = 0; i < locusNm.length; i++) {
              const diff = Math.abs(locusNm[i].nm - wl);
              if (diff < bestDiff) {
                bestDiff = diff;
                idx = i;
              }
            }
            const prev = locusNm[Math.max(0, idx - 1)];
            const next = locusNm[Math.min(locusNm.length - 1, idx + 1)];
            const p = locusNm[Math.min(locusNm.length - 1, Math.max(0, idx))];
            const px = xFor(p.x);
            const py = yFor(p.y);
            const tx = xFor(next.x) - xFor(prev.x);
            const ty = yFor(next.y) - yFor(prev.y);
            const tlen = Math.hypot(tx, ty) || 1;
            let nx = -ty / tlen;
            let ny = tx / tlen;
            const outward = (px - centroidPx.x) * nx + (py - centroidPx.y) * ny;
            if (outward < 0) {
              nx = -nx;
              ny = -ny;
            }
            const labelX = px + nx * 10;
            const labelY = py + ny * 10;
            return (
              <SvgText key={wl} x={labelX} y={labelY + 3} fontSize={8} fill={wavelengthToColor(wl)} textAnchor="middle">
                {wl}
              </SvgText>
            );
          })}

          {/* Planckian (blackbody) locus, with small perpendicular tick
              marks at each round CCT value -- no leader lines out to the
              label column, matching the reference image's plain look.
              Deliberately a Polyline, not a Polygon: Polygon auto-closes
              by drawing a straight line from the last point back to the
              first, which is exactly the stray straight line that was
              cutting across the bottom of this curve (from the 15000K end
              back to the 1667K end) -- the curve was never meant to be a
              closed shape at all, just an open line. */}
          <Polyline
            points={planckianPoints.map((p) => `${xFor(p.x).toFixed(1)},${yFor(p.y).toFixed(1)}`).join(' ')}
            fill="none"
            stroke="#333"
            strokeWidth={1.2}
          />
          {CCT_TICKS_K.map((t) => {
            const [a, b] = planckianTick(t, 0.01);
            return (
              <Line
                key={t}
                x1={xFor(a.x)}
                y1={yFor(a.y)}
                x2={xFor(b.x)}
                y2={yFor(b.y)}
                stroke="#333"
                strokeWidth={1}
              />
            );
          })}

          {/* Current reading's chromaticity point */}
          {Number.isFinite(x) && Number.isFinite(y) && (
            <Circle cx={xFor(x)} cy={yFor(y)} r={6} fill="#1e5fd9" stroke="#fff" strokeWidth={1.5} />
          )}

          {/* Plain stacked CCT-value list in the right margin -- just a
              legend, no leader lines back to the curve, matching the
              reference image exactly. Evenly spaced top to bottom rather
              than pinned to each value's real position on the curve, since
              that's what the reference actually shows. */}
          {CCT_TICKS_K.map((t, i) => {
            const label = t >= 1000 ? `${t % 1000 === 0 ? t / 1000 : (t / 1000).toFixed(1)}k` : `${t}`;
            const listY = PADDING.top + 4 + i * ((chartHeight - 8) / (CCT_TICKS_K.length - 1));
            return (
              <SvgText key={`list${t}`} x={cctLabelX} y={listY} fontSize={9} fill="#888" textAnchor="start">
                {label}
              </SvgText>
            );
          })}

          {/* The reading's own x/y, pinned to the top-left corner of the
              plot box -- drawn last (on top of the fill/locus/dot) so it's
              always legible regardless of what's directly underneath that
              corner for a given reading's color. A small translucent
              backing card, same spirit as the dot's white stroke, rather
              than a second stat-card row below the chart (SpectrumTab.tsx
              used to show one here) -- the measurement grid above this
              whole swipeable section already covers CCT/Duv/Ra/R9/etc. for
              whichever the person has chosen to see; x/y specifically only
              ever showed up here, so they stay on the chart itself. */}
          {Number.isFinite(x) && Number.isFinite(y) && (
            <>
              <Rect
                x={PADDING.left + 4}
                y={PADDING.top + 4}
                width={64}
                height={30}
                rx={4}
                fill="#ffffff"
                opacity={0.85}
              />
              <SvgText x={PADDING.left + 9} y={PADDING.top + 16} fontSize={10} fill="#333" fontFamily="monospace">
                x {x.toFixed(4)}
              </SvgText>
              <SvgText x={PADDING.left + 9} y={PADDING.top + 28} fontSize={10} fill="#333" fontFamily="monospace">
                y {y.toFixed(4)}
              </SvgText>
            </>
          )}
        </Svg>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { width: '100%', backgroundColor: '#ffffff', borderRadius: 8, paddingTop: 6 },
  title: { textAlign: 'center', color: '#1a3d7c', fontSize: 14, fontWeight: '700', marginBottom: 2 },
});
