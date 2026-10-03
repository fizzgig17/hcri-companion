// src/components/RValuesBarChart.tsx
//
// The CRI R1-R15 horizontal bar chart -- a faithful port of hCRI.io's own
// report page chart (CRIBars() in spd/frontend/src/components/
// ReportView.jsx, the <canvas>-drawn version), redrawn as react-native-svg
// geometry instead of 2D canvas calls so it composes with the rest of this
// app's SVG-based charts (SpectrumChart, ChromaticityChart) rather than
// needing a <canvas> polyfill RN doesn't have.
//
// Same visual language as the original: one pill-shaped bar per R-value,
// each in that sample's own fixed TCS color (TCS_COLORS below, copied
// verbatim from ReportView.jsx so a given Ri always reads as the same
// color on hcri.io's own website and in this app), baseline at 0 (or
// below 0 if any value is actually negative -- rare, but some meters do
// report a negative Ri for a badly-rendered sample), scaled so 100 is the
// right edge, with gridlines every 20 and the numeric value drawn either
// inside the bar (light-on-dark or dark-on-light, whichever reads better
// against that bar's own color) or just past its end when the bar itself
// is too short to hold the label.
//
// `ri` is analysis.ri from spectralAnalysis.ts -- index 0 is R1, index 14
// is R15, exactly like every other place in this app that reads R-values.

import React from 'react';
import { View, StyleSheet } from 'react-native';
import Svg, { Rect, Line, Text as SvgText } from 'react-native-svg';
import { useTheme } from '../contexts/ThemeContext';

interface Props {
  ri: number[];
  height?: number;
  /** The chart's actual available content width (inside SpectrumTab's chartCard padding), computed once by SpectrumTab -- see its own comment and SpectrumChart.tsx's matching Props for why this is a plain prop now instead of a hardcoded per-chart chrome constant. */
  width: number;
}

// Copied verbatim from hcri.io's ReportView.jsx (TCS_COLORS) -- one fixed
// color per TCS sample (1-15), not derived from the value itself, so Ri's
// color never changes reading to reading, only its bar length does.
const TCS_COLORS: Record<number, string> = {
  1: '#c08878',
  2: '#b09858',
  3: '#8a9a60',
  4: '#4a7848',
  5: '#60989a',
  6: '#6890b8',
  7: '#8878a8',
  8: '#c07898',
  9: '#cc2828',
  10: '#d4b424',
  11: '#3e8850',
  12: '#1e3ea8',
  13: '#d49878',
  14: '#4e6030',
  15: '#c08868',
};

const PADDING = { top: 18, right: 10, bottom: 6 };
const LEFT_LABEL_WIDTH = 34; // room for "R15" right-aligned, monospace

/** Relative-luminance check (same formula as ReportView.jsx's readableOn) -- decides whether a value label drawn ON TOP of a bar needs light or dark text to stay legible against that bar's own fixed color. */
function readableTextOn(hex: string): string {
  const m = hex.replace('#', '');
  const r = parseInt(m.slice(0, 2), 16);
  const g = parseInt(m.slice(2, 4), 16);
  const b = parseInt(m.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? 'rgba(0,0,0,0.85)' : 'rgba(255,255,255,0.96)';
}

export default function RValuesBarChart({ ri, height, width }: Props) {
  const { colors } = useTheme();
  // `width` arrives as a plain prop from SpectrumTab now -- see
  // SpectrumChart.tsx's matching comment for why.

  const items = ri
    .map((v, i) => ({ i: i + 1, v }))
    .filter((d) => d.v !== null && d.v !== undefined && !Number.isNaN(d.v));

  const rowCount = items.length || 15;
  const chartHeight = height ?? Math.max(220, rowCount * 22 + 28);

  if (items.length === 0) {
    return <View style={{ height: chartHeight }} />;
  }

  const lo = Math.min(0, ...items.map((d) => d.v));
  const hi = 100;

  const chartLeft = LEFT_LABEL_WIDTH;
  const chartWidth = Math.max(width - chartLeft - PADDING.right, 0);
  const plotTop = PADDING.top;
  const plotHeight = chartHeight - PADDING.top - PADDING.bottom;

  const xFor = (v: number) => chartLeft + ((v - lo) / (hi - lo)) * chartWidth;

  const gridTicks: number[] = [];
  for (let t = Math.ceil(lo / 20) * 20; t <= hi; t += 20) gridTicks.push(t);

  const rowHeight = plotHeight / items.length;
  const barHeight = Math.min(rowHeight * 0.62, 16);
  const x0 = xFor(lo);

  const styles = StyleSheet.create({
    container: { width: '100%' },
  });

  return (
    <View style={styles.container}>
      {width > 0 && (
        <Svg width={width} height={chartHeight}>
          {/* Gridlines every 20, with the tick value labeled above the plot area. */}
          {gridTicks.map((t) => {
            const gx = xFor(t);
            return (
              <React.Fragment key={t}>
                <Line x1={gx} y1={plotTop} x2={gx} y2={plotTop + plotHeight} stroke={colors.cardBorder} strokeWidth={0.5} />
                <SvgText x={gx} y={plotTop - 6} fontSize={9} fill={colors.muted} textAnchor="middle" fontFamily="monospace">
                  {t}
                </SvgText>
              </React.Fragment>
            );
          })}

          {items.map((d, idx) => {
            const cy = plotTop + rowHeight * (idx + 0.5);
            const by = cy - barHeight / 2;
            const barEndX = Math.max(x0 + barHeight, xFor(d.v));
            const barW = barEndX - x0;
            const color = TCS_COLORS[d.i] ?? '#888';
            const label = String(Math.round(d.v));
            // Rough label-width estimate (monospace, ~6.5px/char at this
            // font size) -- RN's SVG Text has no measureText, so this
            // stands in for the canvas original's exact ctx.measureText()
            // check deciding "does the label fit inside the bar".
            const labelWidthEstimate = label.length * 7 + 10;
            const fitsInside = barW > labelWidthEstimate + 10;

            return (
              <React.Fragment key={d.i}>
                <SvgText
                  x={chartLeft - 6}
                  y={cy + 4}
                  fontSize={12}
                  fontWeight="bold"
                  fill={colors.muted}
                  textAnchor="end"
                  fontFamily="monospace"
                >
                  {`R${d.i}`}
                </SvgText>
                <Rect x={x0} y={by} width={barW} height={barHeight} rx={barHeight / 2} fill={color} />
                {fitsInside ? (
                  <SvgText
                    x={barEndX - 9}
                    y={cy + 4}
                    fontSize={11}
                    fill={readableTextOn(color)}
                    textAnchor="end"
                    fontFamily="monospace"
                  >
                    {label}
                  </SvgText>
                ) : (
                  <SvgText x={barEndX + 6} y={cy + 4} fontSize={11} fill={colors.text} textAnchor="start" fontFamily="monospace">
                    {label}
                  </SvgText>
                )}
              </React.Fragment>
            );
          })}
        </Svg>
      )}
    </View>
  );
}
