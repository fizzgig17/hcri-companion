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

import React, { useState } from 'react';
import { View, StyleSheet, Dimensions } from 'react-native';
import Svg, { Path, Line, Text as SvgText, Defs, LinearGradient, Stop } from 'react-native-svg';
import { useTheme } from '../contexts/ThemeContext';

interface Props {
  spectrum: { nm: number; value: number }[];
  height?: number;
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

export default function SpectrumChart({ spectrum, height = 200 }: Props) {
  // SVG needs a concrete pixel width, but this component doesn't know its
  // own width until React Native lays it out -- onLayout gives us that on
  // first render, and every render after just reuses it.
  //
  // Confirmed 2026-10-02: starting this at 0 and waiting purely on onLayout
  // meant nothing drew at all until that native layout round-trip actually
  // completed through the bridge. This component only ever MOUNTS fresh
  // once -- the very first time a reading lands and MainTab's/SpectrumTab's
  // `result && ...` goes from false to true for the first time in a
  // session; every later reading just re-renders this same already-mounted
  // instance, reusing its already-resolved width. Right at that first-
  // mount moment the JS thread is also busy (addReading() writing to
  // AsyncStorage, the success haptic, several screens re-rendering off the
  // new `result`), which can delay onLayout's delivery long enough that the
  // chart area sat visibly blank for that one reading -- exactly the "the
  // graph doesn't show" report, and only ever on the first reading of a
  // session. Seeding this with the window's own width as a same-screen
  // estimate means a chart is drawn immediately on mount; onLayout still
  // corrects it to the exact measured value the moment it arrives, same as
  // before.
  const { colors } = useTheme();
  const [width, setWidth] = useState(() => Dimensions.get('window').width);

  if (spectrum.length < 2) {
    return <View style={{ height }} onLayout={(e) => setWidth(e.nativeEvent.layout.width)} />;
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
    <View style={styles.container} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
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
                <SvgText x={x} y={height - 6} fontSize={8} fill={colors.muted} textAnchor="middle">
                  {nm}
                </SvgText>
              </React.Fragment>
            );
          })}

          {/* The filled, wavelength-colored spectrum curve itself */}
          <Path d={areaPath} fill="url(#spectrumGradient)" stroke="rgba(0,0,0,0.25)" strokeWidth={1} />
        </Svg>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { width: '100%' },
});
