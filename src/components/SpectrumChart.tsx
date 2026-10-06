// src/components/SpectrumChart.tsx
//
// Draws the meter's spectral power distribution as a filled, wavelength-
// colored area chart -- matching the look of the vendor app's own spectrum
// graph (and the kind of chart hCRI.io renders): violet/blue on the left
// shading through green, yellow, orange to red on the right, following the
// actual wavelength at each point rather than a single flat line color.
//
// Requires react-native-svg:
//   npm install react-native-svg
// It has a small native module, so a JS-only Fast Refresh isn't enough the
// first time it's added -- a full rebuild (npx react-native run-android, or
// the Android Studio Run button) is needed after installing it.

import React, { useContext, useEffect, useRef, useState } from 'react';
import { PagerLockContext } from './PagerLock';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Path, Line, Text as SvgText, Defs, LinearGradient, Stop } from 'react-native-svg';
import { useTheme } from '../contexts/ThemeContext';

interface Props {
  spectrum: { nm: number; value: number }[];
  height?: number;
  /** The chart's actual available content width (inside SpectrumTab's chartCard padding), computed once by SpectrumTab -- see its own comment for why this moved there instead of staying a hardcoded chrome constant in each chart file. */
  width: number;
  /** Reading details shown above the plot, like the vendor app: peak wavelength and its spectral value, plus the meter's integration time and peak/dark signal. Any piece that's missing is left out. */
  details?: { integrationMs?: number; peakSignal?: number; darkSignal?: number; showSpectral?: boolean };
}

const PADDING = { top: 8, right: 8, bottom: 24, left: 24 };
/** Height of the two-line details header drawn above the plot (when `details` is given). */
export const SPECTRUM_HEADER_H = 34;
// The vendor app's own full-scale for its Peak/Dark percentages.
const SIGNAL_FULL_SCALE = 64500;
/** Half-width (px) of the touch strip around the red line. */
const LINE_GRAB_PX = 22;

/**
 * Approximates the perceived color of a wavelength in the visible spectrum
 * (~380-780nm), using the standard piecewise-linear approximation (after
 * Dan Bruton's well-known conversion). Wavelengths outside the visible
 * range (this meter's range can start as low as 340nm, into near-UV) are
 * clamped to the nearest visible edge color and dimmed, rather than left
 * undefined -- there's no "correct" color for invisible light, but showing
 * a dim violet/red at the edges reads better than a hard color cutoff.
 */
function wavelengthToColor(wavelengthNm: number): string {
  let wl = wavelengthNm;
  let factor = 1;
  if (wl < 380) {
    wl = 380;
    factor = 0.35;
  } else if (wl > 780) {
    wl = 780;
    factor = 0.35;
  }

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

  const to255 = (c: number) => Math.round(Math.max(0, Math.min(1, c)) * 255 * factor);
  return `rgb(${to255(r)}, ${to255(g)}, ${to255(b)})`;
}

export default function SpectrumChart({ spectrum, height = 200, width, details }: Props) {
  // `width` is computed once by SpectrumTab (the window width minus
  // whatever chrome actually wraps it on THIS host screen) and handed
  // down as a plain prop -- no onLayout, no estimate-then-correct shift.
  // See SpectrumTab.tsx's own comment for why this moved out of a
  // hardcoded per-chart chrome constant: MainTab wraps SpectrumTab in an
  // extra card of its own that a constant living here could never know
  // about, which is what caused charts to render wider than their actual
  // box on that screen.
  const { colors } = useTheme();
  const lockPager = useContext(PagerLockContext);
  // The red line's wavelength; null = at the peak (reset on every new spectrum).
  const [selectedNm, setSelectedNm] = useState<number | null>(null);
  const grabTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const grabbed = useRef(false);
  const startPt = useRef({ x: 0, y: 0 });
  const lineStartX = useRef(0);
  useEffect(() => {
    setSelectedNm(null);
  }, [spectrum]);
  useEffect(
    () => () => {
      if (grabTimer.current) clearTimeout(grabTimer.current);
      lockPager(false);
    },
    [lockPager],
  );

  if (spectrum.length < 2) {
    return <View style={{ height }} />;
  }

  const values = spectrum.map((p) => p.value);
  const maxValue = Math.max(...values, 0.0001);
  const minNm = spectrum[0].nm;
  const maxNm = spectrum[spectrum.length - 1].nm;
  const nmRange = maxNm - minNm || 1;
  const peakIndex = values.indexOf(Math.max(...values));
  const peakNm = spectrum[Math.max(0, peakIndex)].nm;
  const lineNm = selectedNm !== null && selectedNm >= minNm && selectedNm <= maxNm ? selectedNm : peakNm;
  const lineValue = spectrum.find((p) => p.nm === lineNm)?.value ?? maxValue;
  const hasData = Math.max(...values) > 0;

  const chartWidth = Math.max(width - PADDING.left - PADDING.right, 0);
  const chartHeight = height - PADDING.top - PADDING.bottom;
  const baselineY = PADDING.top + chartHeight;

  const xFor = (nm: number) => PADDING.left + ((nm - minNm) / nmRange) * chartWidth;
  const yFor = (value: number) => PADDING.top + chartHeight - (value / maxValue) * chartHeight;

  // Filled area path: baseline -> up to the first point -> along the curve
  // -> back down to baseline -> closed. This is what gets filled with the
  // wavelength gradient, instead of just an outlined line.
  let areaPath = `M ${xFor(minNm).toFixed(1)},${baselineY.toFixed(1)} `;
  areaPath += `L ${xFor(spectrum[0].nm).toFixed(1)},${yFor(spectrum[0].value).toFixed(1)} `;
  for (let i = 1; i < spectrum.length; i++) {
    areaPath += `L ${xFor(spectrum[i].nm).toFixed(1)},${yFor(spectrum[i].value).toFixed(1)} `;
  }
  areaPath += `L ${xFor(maxNm).toFixed(1)},${baselineY.toFixed(1)} Z`;

  // Gradient stops sampled evenly across the wavelength range (not pixel
  // range) so the color at each x position matches that x's real
  // wavelength -- enough stops for a smooth transition without bloating
  // the SVG.
  const STOP_COUNT = 24;
  const gradientStops = Array.from({ length: STOP_COUNT + 1 }, (_, i) => {
    const t = i / STOP_COUNT;
    const nm = minNm + t * nmRange;
    return { offset: t, color: wavelengthToColor(nm) };
  });

  // Y-axis gridlines at 0/0.2/0.4/0.6/0.8/1.0 of the max reading, matching
  // the vendor app's normalized 0-1 axis.
  const yTicks = [0, 0.2, 0.4, 0.6, 0.8, 1.0];

  // X-axis wavelength gridlines at round 50nm marks across the visible range.
  const nmTicks: number[] = [];
  const firstTick = Math.ceil(minNm / 50) * 50;
  for (let nm = firstTick; nm < maxNm; nm += 50) nmTicks.push(nm);

  const pct = (v: number) => Math.round((v / SIGNAL_FULL_SCALE) * 100);
  const num = (v: number | undefined) => (hasData && v !== undefined && Number.isFinite(v) ? v.toFixed(0) : null);
  const line1 =
    hasData
      ? `Wavelength:${lineNm}nm` + (details?.showSpectral ? ` Spectral:${(lineValue * 0.1).toFixed(3)}uw/cm²/nm` : '')
      : '';
  const integ = num(details?.integrationMs);
  const peakS = num(details?.peakSignal);
  const darkS = num(details?.darkSignal);

  return (
    <View style={styles.container}>
      {details && (
        <View style={{ height: SPECTRUM_HEADER_H, justifyContent: 'center' }}>
          <Text style={{ color: colors.text, fontSize: 11, textAlign: 'center' }} numberOfLines={1} adjustsFontSizeToFit>
            {line1}
          </Text>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 4, marginTop: 2 }}>
            <Text style={{ color: colors.text, fontSize: 10 }}>{integ !== null ? `Integration Time:${integ}ms` : ''}</Text>
            <Text style={{ color: colors.text, fontSize: 10 }}>{peakS !== null ? `Peak:${peakS}(${pct(Number(peakS))}%)` : ''}</Text>
            <Text style={{ color: colors.text, fontSize: 10 }}>{darkS !== null ? `Dark:${darkS}(${pct(Number(darkS))}%)` : ''}</Text>
          </View>
        </View>
      )}
      {width > 0 && (
        <Svg width={width} height={height}>
          <Defs>
            <LinearGradient
              id="spectrumGradient"
              x1={xFor(minNm)}
              y1={0}
              x2={xFor(maxNm)}
              y2={0}
              gradientUnits="userSpaceOnUse"
            >
              {gradientStops.map((s, i) => (
                <Stop key={i} offset={s.offset} stopColor={s.color} />
              ))}
            </LinearGradient>
          </Defs>

          {/* Horizontal gridlines + y-axis labels */}
          {yTicks.map((t) => {
            const y = yFor(t * maxValue);
            return (
              <React.Fragment key={t}>
                <Line
                  x1={PADDING.left}
                  y1={y}
                  x2={PADDING.left + chartWidth}
                  y2={y}
                  stroke={colors.cardBorder}
                  strokeWidth={0.5}
                />
                <SvgText x={PADDING.left - 4} y={y + 3} fontSize={8} fill={colors.muted} textAnchor="end">
                  {t === 1 ? '1' : t === 0 ? '0' : t.toFixed(1)}
                </SvgText>
              </React.Fragment>
            );
          })}

          {/* Vertical wavelength gridlines + x-axis labels */}
          {nmTicks.map((nm) => {
            const x = xFor(nm);
            return (
              <React.Fragment key={nm}>
                <Line
                  x1={x}
                  y1={PADDING.top}
                  x2={x}
                  y2={baselineY}
                  stroke={colors.cardBorder}
                  strokeWidth={0.5}
                />
                <Line x1={x} y1={baselineY} x2={x} y2={baselineY + 4} stroke={colors.muted} strokeWidth={1} />
                <SvgText x={x} y={height - 6} fontSize={8} fill={colors.muted} textAnchor="middle">
                  {nm}
                </SvgText>
              </React.Fragment>
            );
          })}

          {/* The filled, wavelength-colored spectrum curve itself */}
          <Path d={areaPath} fill="url(#spectrumGradient)" stroke="rgba(0,0,0,0.25)" strokeWidth={1} />
          {/* Draggable wavelength marker (starts at the peak), like the vendor app's red line */}
          {hasData && (
            <Line x1={xFor(lineNm)} y1={PADDING.top} x2={xFor(lineNm)} y2={baselineY} stroke="#d92b2b" strokeWidth={1} />
          )}
        </Svg>
      )}
      {width > 0 && hasData && (
        // Touch target is only a narrow strip around the red line, so a press
        // anywhere else on the chart is ignored by it (and just belongs to the pager).
        <View
          style={{ position: 'absolute', left: xFor(lineNm) - LINE_GRAB_PX, width: LINE_GRAB_PX * 2, bottom: 0, height }}
          onTouchStart={(e) => {
            const { pageX, pageY } = e.nativeEvent;
            startPt.current = { x: pageX, y: pageY };
            lineStartX.current = xFor(lineNm);
            grabbed.current = false;
            if (grabTimer.current) clearTimeout(grabTimer.current);
            // Only a finger resting on the line (not a quick swipe) grabs it.
            grabTimer.current = setTimeout(() => {
              grabbed.current = true;
              lockPager(true);
            }, 180);
          }}
          onTouchMove={(e) => {
            const { pageX, pageY } = e.nativeEvent;
            if (!grabbed.current) {
              // Moved before the line was grabbed: it's a swipe, leave it to the pager.
              if (
                grabTimer.current &&
                (Math.abs(pageX - startPt.current.x) > 6 || Math.abs(pageY - startPt.current.y) > 6)
              ) {
                clearTimeout(grabTimer.current);
                grabTimer.current = null;
              }
              return;
            }
            // The strip moves with the line, so track the finger's movement from where it started.
            const x = lineStartX.current + (pageX - startPt.current.x);
            const raw = minNm + ((x - PADDING.left) / (chartWidth || 1)) * nmRange;
            setSelectedNm(Math.round(Math.max(minNm, Math.min(maxNm, raw))));
          }}
          onTouchEnd={() => {
            if (grabTimer.current) clearTimeout(grabTimer.current);
            grabTimer.current = null;
            if (grabbed.current) {
              grabbed.current = false;
              lockPager(false);
            }
          }}
          onTouchCancel={() => {
            if (grabTimer.current) clearTimeout(grabTimer.current);
            grabTimer.current = null;
            grabbed.current = false;
            lockPager(false);
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { width: '100%' },
});
