// src/components/SpectrumChart.tsx
//
// Draws the meter's spectral power distribution as a filled, wavelength-
// colored area chart -- matching the look of the vendor app's own spectrum
// graph (and the kind of chart hCRI.io renders): violet/blue on the left
// shading through green, yellow, orange to red on the right, following the
// actual wavelength at each point rather than a single flat line color.
//
// Also draws a touch/drag-able crosshair -- a vertical red line plus a
// "Wavelength: XXXnm   Value: X.XXXX" readout above the chart, matching
// the vendor app's own Spec. tab (which shows the same line+readout for
// wherever you've touched its chart). Starts on the curve's peak point
// (its most informative point untouched) and moves to the nearest real
// point as you touch or drag anywhere on the chart.
//
// Requires react-native-svg:
//   npm install react-native-svg
// It has a small native module, so a JS-only Fast Refresh isn't enough the
// first time it's added -- a full rebuild (npx react-native run-android, or
// the Android Studio Run button) is needed after installing it.

import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, GestureResponderEvent } from 'react-native';
import Svg, { Path, Line, Circle, Text as SvgText, Defs, LinearGradient, Stop } from 'react-native-svg';
import { useTheme } from '../contexts/ThemeContext';

interface Props {
  spectrum: { nm: number; value: number }[];
  height?: number;
  /** The chart's actual available content width (inside SpectrumTab's chartCard padding), computed once by SpectrumTab -- see its own comment for why this moved there instead of staying a hardcoded chrome constant in each chart file. */
  width: number;
}

const PADDING = { top: 10, right: 10, bottom: 22, left: 28 };

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

export default function SpectrumChart({ spectrum, height = 200, width }: Props) {
  // `width` is computed once by SpectrumTab (the window width minus
  // whatever chrome actually wraps it on THIS host screen) and handed
  // down as a plain prop -- no onLayout, no estimate-then-correct shift.
  // See SpectrumTab.tsx's own comment for why this moved out of a
  // hardcoded per-chart chrome constant: MainTab wraps SpectrumTab in an
  // extra card of its own that a constant living here could never know
  // about, which is what caused charts to render wider than their actual
  // box on that screen.
  const { colors } = useTheme();

  // Which point the wavelength/value readout above the chart (and the
  // vertical crosshair line on it) is currently showing -- null means "no
  // touch yet this reading, fall back to the peak point" (see
  // defaultIndex below), matching the vendor app's own Spec. tab, which
  // always has SOME line showing rather than nothing until you first touch
  // the chart. Reset back to that default whenever a new spectrum comes in
  // (a new reading, or MainTab's placeholder-vs-real swap) -- a touch
  // position from a previous reading's curve has no meaning on this one.
  const [touchedIndex, setTouchedIndex] = useState<number | null>(null);
  useEffect(() => {
    setTouchedIndex(null);
  }, [spectrum]);

  if (spectrum.length < 2) {
    return <View style={{ height }} />;
  }

  const values = spectrum.map((p) => p.value);
  const maxValue = Math.max(...values, 0.0001);
  const minNm = spectrum[0].nm;
  const maxNm = spectrum[spectrum.length - 1].nm;
  const nmRange = maxNm - minNm || 1;

  const chartWidth = Math.max(width - PADDING.left - PADDING.right, 0);
  const chartHeight = height - PADDING.top - PADDING.bottom;
  const baselineY = PADDING.top + chartHeight;

  const xFor = (nm: number) => PADDING.left + ((nm - minNm) / nmRange) * chartWidth;
  const yFor = (value: number) => PADDING.top + chartHeight - (value / maxValue) * chartHeight;

  // Default crosshair position before any touch: the peak point -- the
  // single most informative point on an untouched curve, and the same
  // point the vendor app's own "Peak(nm)" stat tile calls out.
  let defaultIndex = 0;
  for (let i = 1; i < spectrum.length; i++) {
    if (spectrum[i].value > spectrum[defaultIndex].value) defaultIndex = i;
  }
  const activeIndex = touchedIndex !== null ? Math.min(touchedIndex, spectrum.length - 1) : defaultIndex;
  const activePoint = spectrum[activeIndex];

  // Finds the spectrum point nearest an x touched inside the chart's own
  // plot area (in the Svg's own coordinate space, same origin as xFor/
  // yFor above -- see the wrapping View's style below for why a touch's
  // locationX lines up with that directly, no extra offset needed).
  const handleTouch = (evt: GestureResponderEvent) => {
    const touchX = evt.nativeEvent.locationX;
    const touchNm = minNm + ((touchX - PADDING.left) / chartWidth) * nmRange;
    let nearest = 0;
    let bestDiff = Infinity;
    for (let i = 0; i < spectrum.length; i++) {
      const diff = Math.abs(spectrum[i].nm - touchNm);
      if (diff < bestDiff) {
        bestDiff = diff;
        nearest = i;
      }
    }
    setTouchedIndex(nearest);
  };

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

  return (
    <View style={styles.container}>
      {/* Wavelength/value readout for the crosshair below -- "like the
          stock app": a plain text line above the chart naming the nm
          you're on and the value there, rather than a tooltip you'd have
          to hold a finger down to keep seeing. */}
      <Text style={[styles.readout, { color: colors.muted }]}>
        Wavelength: {activePoint.nm}nm   Value: {activePoint.value.toFixed(4)}
      </Text>
      {width > 0 && (
        <Svg
          width={width}
          height={height}
          // Touch (and drag) anywhere on the chart moves the crosshair to
          // the nearest point -- onResponderMove (not just Grant) is what
          // makes this a drag rather than a tap-only control, matching the
          // vendor app's own touch/drag behavior on its Spec. tab.
          onStartShouldSetResponder={() => true}
          onMoveShouldSetResponder={() => true}
          onResponderGrant={handleTouch}
          onResponderMove={handleTouch}
        >
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
                <SvgText x={x} y={height - 6} fontSize={8} fill={colors.muted} textAnchor="middle">
                  {nm}
                </SvgText>
              </React.Fragment>
            );
          })}

          {/* The filled, wavelength-colored spectrum curve itself */}
          <Path d={areaPath} fill="url(#spectrumGradient)" stroke="rgba(0,0,0,0.25)" strokeWidth={1} />

          {/* The crosshair itself -- a vertical red line at the active
              point's wavelength (matching the vendor app's own red
              indicator line), plus a small dot marking exactly where it
              meets the curve. */}
          <Line
            x1={xFor(activePoint.nm)}
            y1={PADDING.top}
            x2={xFor(activePoint.nm)}
            y2={baselineY}
            stroke="#e53935"
            strokeWidth={1.2}
          />
          <Circle cx={xFor(activePoint.nm)} cy={yFor(activePoint.value)} r={4} fill="#e53935" stroke="#fff" strokeWidth={1} />
        </Svg>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { width: '100%' },
  readout: { fontSize: 11, fontFamily: 'monospace', marginBottom: 4 },
});
