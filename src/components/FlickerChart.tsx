// src/components/FlickerChart.tsx
//
// The Flicker page: four headline numbers (Hz, flicker %, flicker index,
// cycle ms), the stock app's risk tip, and the waveform. The waveform uses
// the stock app's own scale: samples are divided by the largest sample, the
// vertical axis runs from (min/max * 0.8) up to 1.2, and the horizontal axis
// is just the sample number (0-400). Always drawn on white, like the stock
// app and the Chrom page, in the stock line colour #204687.

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Line, Polyline, Text as SvgText } from 'react-native-svg';
import { flickerRisk, type FlickerReading } from '../ble/liveSessions';

interface Props {
  reading: FlickerReading | null;
  running: boolean;
  width: number;
  height: number;
}

const LINE = '#204687';
const STATS_H = 38;
const RISK_H = 16;

const RISK_TEXT = { none: 'No Risk', low: 'Low Risk', high: 'High Risk' } as const;
const RISK_COLOR = { none: '#2e8b4f', low: '#c47f00', high: '#cc2828' } as const;

export default function FlickerChart({ reading, running, width, height }: Props) {
  const styles = StyleSheet.create({
    statsRow: { flexDirection: 'row', height: STATS_H },
    stat: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    statVal: { color: '#111', fontSize: 16, fontWeight: '700' },
    statLabel: { color: '#666', fontSize: 9.5, marginTop: 1 },
    riskRow: { height: RISK_H, flexDirection: 'row', justifyContent: 'center', alignItems: 'center' },
    riskText: { fontSize: 12, fontWeight: '700' },
    hint: { color: '#666', fontSize: 12.5, textAlign: 'center' },
  });

  if (!reading) {
    return (
      <View style={{ height, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 }}>
        <Text style={styles.hint}>
          {running ? 'Waiting for the meter…' : 'Tap Flicker below to measure this light’s flicker.'}
        </Text>
      </View>
    );
  }

  const wf = reading.waveform;
  const n = wf.length;
  const max = Math.max(...wf);
  const min = Math.min(...wf);
  // Stock scale: y = value / max; axis min = (min/max*0.8) to one decimal, axis max = 1.2 (1 if all zero).
  const norm = wf.map((v) => (v === 0 || max === 0 ? 0 : v / max));
  const yMax = max === 0 ? 1 : 1.2;
  const yMin = max === 0 ? 0 : Math.round((min / max) * 0.8 * 10) / 10;

  const risk = flickerRisk(reading.frequencyHz, reading.percentFlicker);

  const chartH = Math.max(40, height - STATS_H - RISK_H - 4);
  const padL = 30;
  const padR = 8;
  const padT = 6;
  const padB = 28;
  const plotW = Math.max(10, width - padL - padR);
  const plotH = Math.max(10, chartH - padT - padB);
  const x = (i: number) => padL + (i / Math.max(1, n - 1)) * plotW;
  const y = (v: number) => padT + (1 - (v - yMin) / (yMax - yMin)) * plotH;

  const ticks: number[] = [];
  const step = (yMax - yMin) > 0.8 ? 0.2 : 0.1;
  for (let t = Math.ceil(yMin / step) * step; t <= yMax + 1e-9; t += step) ticks.push(Math.round(t * 100) / 100);
  const xTicks = [0, 100, 200, 300, 400].filter((t) => t <= n);

  const points = norm.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const fmt = (v: number) => (Number.isFinite(v) ? v : 0);

  return (
    <View style={{ height }}>
      <View style={styles.statsRow}>
        <View style={styles.stat}>
          <Text style={styles.statVal} allowFontScaling={false}>{fmt(reading.frequencyHz).toFixed(1)}</Text>
          <Text style={styles.statLabel} allowFontScaling={false}>Freq (Hz)</Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.statVal} allowFontScaling={false}>{fmt(reading.percentFlicker).toFixed(1)}</Text>
          <Text style={styles.statLabel} allowFontScaling={false}>Flicker %</Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.statVal} allowFontScaling={false}>{fmt(reading.flickerIndex).toFixed(3)}</Text>
          <Text style={styles.statLabel} allowFontScaling={false}>Index</Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.statVal} allowFontScaling={false}>{fmt(reading.cycleMs).toFixed(1)}</Text>
          <Text style={styles.statLabel} allowFontScaling={false}>Cycle (ms)</Text>
        </View>
      </View>
      <View style={styles.riskRow}>
        <Text style={[styles.riskText, { color: RISK_COLOR[risk] }]} allowFontScaling={false} numberOfLines={1}>
          Risk tip: {RISK_TEXT[risk]}
        </Text>
      </View>
      <Svg width={width} height={chartH}>
        {ticks.map((t) => (
          <React.Fragment key={t}>
            <Line x1={padL} x2={padL + plotW} y1={y(t)} y2={y(t)} stroke="#e3e5ea" strokeWidth={1} />
            <SvgText x={padL - 4} y={y(t) + 3} fontSize={9} fill="#666" textAnchor="end">{t.toFixed(1)}</SvgText>
          </React.Fragment>
        ))}
        {xTicks.map((t) => (
          <React.Fragment key={t}>
            <Line x1={x(Math.min(t, n - 1))} x2={x(Math.min(t, n - 1))} y1={padT} y2={padT + plotH} stroke="#eef0f3" strokeWidth={1} />
            <SvgText x={x(Math.min(t, n - 1))} y={padT + plotH + 12} fontSize={9} fill="#666" textAnchor="middle">{t}</SvgText>
          </React.Fragment>
        ))}
        <Line x1={padL} x2={padL} y1={padT} y2={padT + plotH} stroke="#C5C9D3" strokeWidth={1} />
        <Line x1={padL} x2={padL + plotW} y1={padT + plotH} y2={padT + plotH} stroke="#C5C9D3" strokeWidth={1} />
        <Polyline points={points} fill="none" stroke={LINE} strokeWidth={1.6} strokeLinejoin="round" />
        <SvgText x={padL + plotW / 2} y={chartH - 2} fontSize={9} fill="#666" textAnchor="middle">Sample</SvgText>
      </Svg>
    </View>
  );
}
