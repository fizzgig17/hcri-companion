// src/components/FlickerCompareChart.tsx
//
// Several readings' flicker on one chart, for the Compare window. Wave view: every waveform drawn in its reading's
// colour, each divided by its own peak (so you compare shape and depth, not brightness), with the same zoom / pan
// buttons the single flicker chart has. Risk view: each reading is a coloured dot on the IEEE-1789-style bands
// (frequency vs percent flicker). Drawn on white, like FlickerChart.

import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Svg, { Line, Polyline, Polygon, Circle, Text as SvgText } from 'react-native-svg';
import HintPressable from './HintPressable';
import { HIGH_LINE, LOW_LINE, RISK_TINT, fmtMs } from './FlickerChart';
import type { FlickerReading } from '../ble/liveSessions';

const LINE = '#204687';

export interface FlickerSeries {
  id: string;
  label: string;
  color: string;
  flicker: FlickerReading | null;
}

interface Props {
  series: FlickerSeries[];
  width: number;
  height: number;
}

export default function FlickerCompareChart({ series, width, height }: Props) {
  const [view, setView] = useState<'wave' | 'risk'>('wave');
  const [zoom, setZoom] = useState(1);
  const [start, setStart] = useState(0);

  const withData = series.filter((s) => s.flicker && s.flicker.waveform && s.flicker.waveform.length > 0);
  const missing = series.filter((s) => !s.flicker);
  const HEAD_H = 28;
  const FOOT_H = missing.length ? 18 : 0;
  const bodyH = Math.max(80, height - HEAD_H - FOOT_H);

  const styles = StyleSheet.create({
    wrap: { backgroundColor: '#fff', borderRadius: 8, overflow: 'hidden' },
    head: { flexDirection: 'row', alignItems: 'center', height: HEAD_H, paddingHorizontal: 6 },
    seg: { flexDirection: 'row', borderWidth: 1, borderColor: '#C5C9D3', borderRadius: 6, overflow: 'hidden' },
    segBtn: { paddingHorizontal: 8, paddingVertical: 3 },
    segOn: { backgroundColor: LINE },
    segTxt: { fontSize: 11, fontWeight: '700', color: LINE },
    segTxtOn: { color: '#fff' },
    pill: { marginLeft: 5, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6, borderWidth: 1, borderColor: '#C5C9D3' },
    pillOn: { backgroundColor: LINE, borderColor: LINE },
    pillTxt: { fontSize: 11, fontWeight: '700', color: LINE },
    pillTxtOn: { color: '#fff' },
    foot: { height: FOOT_H, textAlign: 'center', fontSize: 10, color: '#777' },
    empty: { color: '#666', fontSize: 13, textAlign: 'center', padding: 24 },
  });

  if (!withData.length) {
    return (
      <View style={[styles.wrap, { height }]}>
        <Text style={styles.empty}>None of these readings has a flicker sample.</Text>
      </View>
    );
  }

  // Shared horizontal axis: real time when every reading knows its capture span, otherwise sample numbers.
  const allTimed = withData.every((s) => !!s.flicker!.spanMs);
  const unitsOf = (f: FlickerReading) => (allTimed ? f.spanMs! : f.waveform.length);
  const total = Math.max(...withData.map((s) => unitsOf(s.flicker!)));
  const win = total / zoom;
  const s0 = Math.min(Math.max(0, start), total - win);
  const setZoomLevel = (z: number) => { setZoom(z); setStart(0); };
  const pan = (dir: number) => setStart((s) => Math.min(Math.max(0, s + (dir * win) / 2), total - win));

  const renderWave = () => {
    const padL = 30, padR = 8, padT = 10, padB = 18;
    const plotW = Math.max(10, width - padL - padR);
    const plotH = Math.max(10, bodyH - padT - padB);
    // Common vertical range from the lowest valley across readings, same rule as the single chart.
    const mins = withData.map((s) => {
      const wf = s.flicker!.waveform;
      const mx = Math.max(...wf);
      return mx === 0 ? 0 : Math.min(...wf) / mx;
    });
    const yMax = 1.2;
    const yMin = Math.round(Math.min(...mins) * 0.8 * 10) / 10;
    const x = (u: number) => padL + ((u - s0) / win) * plotW;
    const y = (v: number) => padT + (1 - (v - yMin) / (yMax - yMin)) * plotH;
    const step = yMax - yMin > 0.8 ? 0.2 : 0.1;
    const yTicks: number[] = [];
    for (let t = Math.ceil(yMin / step) * step; t <= yMax + 1e-9; t += step) yTicks.push(Math.round(t * 100) / 100);
    const xTicks = [0, 1, 2, 3, 4].map((k) => s0 + (k / 4) * win);
    const label = (u: number) => (allTimed ? fmtMs(u) : String(Math.round(u)));
    return (
      <Svg width={width} height={bodyH}>
        {yTicks.map((t) => (
          <React.Fragment key={t}>
            <Line x1={padL} x2={padL + plotW} y1={y(t)} y2={y(t)} stroke="#e3e5ea" strokeWidth={1} />
            <SvgText x={padL - 4} y={y(t) + 3} fontSize={9} fill="#666" textAnchor="end">{t.toFixed(1)}</SvgText>
          </React.Fragment>
        ))}
        {xTicks.map((u, k) => (
          <React.Fragment key={k}>
            <Line x1={x(u)} x2={x(u)} y1={padT} y2={padT + plotH} stroke="#eef0f3" strokeWidth={1} />
            <SvgText x={x(u)} y={padT + plotH + 12} fontSize={9} fill="#666" textAnchor={k === 0 ? 'start' : k === 4 ? 'end' : 'middle'}>{label(u)}</SvgText>
          </React.Fragment>
        ))}
        <Line x1={padL} x2={padL} y1={padT} y2={padT + plotH} stroke="#C5C9D3" strokeWidth={1} />
        <Line x1={padL} x2={padL + plotW} y1={padT + plotH} y2={padT + plotH} stroke="#C5C9D3" strokeWidth={1} />
        {withData.map((s) => {
          const f = s.flicker!;
          const wf = f.waveform;
          const n = wf.length;
          const mx = Math.max(...wf) || 1;
          const perSample = unitsOf(f) / n;
          const lo = Math.max(0, Math.floor(s0 / perSample) - 1);
          const hi = Math.min(n - 1, Math.ceil((s0 + win) / perSample) + 1);
          const pts: string[] = [];
          for (let i = lo; i <= hi; i++) pts.push(`${x(i * perSample).toFixed(1)},${y(wf[i] / mx).toFixed(1)}`);
          return <Polyline key={s.id} points={pts.join(' ')} fill="none" stroke={s.color} strokeWidth={1.6} strokeLinejoin="round" />;
        })}
      </Svg>
    );
  };

  const renderRisk = () => {
    const padL = 34, padR = 10, padT = 8, padB = 28;
    const plotW = Math.max(10, width - padL - padR);
    const plotH = Math.max(10, bodyH - padT - padB);
    const X0 = Math.log10(1), X1 = Math.log10(2000), Y0 = Math.log10(0.01), Y1 = Math.log10(100);
    const clampY = (v: number) => Math.min(Y1, Math.max(Y0, Math.log10(Math.max(v, 1e-9))));
    const px = (f: number) => padL + ((Math.log10(Math.max(f, 1)) - X0) / (X1 - X0)) * plotW;
    const py = (p: number) => padT + (1 - (clampY(p) - Y0) / (Y1 - Y0)) * plotH;
    const line = (pts: [number, number][]) => pts.map(([f, p]) => `${px(f).toFixed(1)},${py(p).toFixed(1)}`);
    const redPoly = [...line(HIGH_LINE), `${px(2000)},${py(100)}`, `${px(1)},${py(100)}`].join(' ');
    const greenPoly = [...line(LOW_LINE), `${px(2000)},${py(0.01)}`, `${px(1)},${py(0.01)}`].join(' ');
    const amberPoly = [...line(HIGH_LINE), ...line([...LOW_LINE].reverse())].join(' ');
    return (
      <Svg width={width} height={bodyH}>
        <Polygon points={redPoly} fill={RISK_TINT.high} />
        <Polygon points={amberPoly} fill={RISK_TINT.low} />
        <Polygon points={greenPoly} fill={RISK_TINT.none} />
        {[0.01, 0.1, 1, 10, 100].map((t) => (
          <React.Fragment key={t}>
            <Line x1={padL} x2={padL + plotW} y1={py(t)} y2={py(t)} stroke="#d7dae0" strokeWidth={0.8} />
            <SvgText x={padL - 4} y={py(t) + 3} fontSize={9} fill="#666" textAnchor="end">{`${t}%`}</SvgText>
          </React.Fragment>
        ))}
        {[1, 10, 100, 1000].map((t) => (
          <React.Fragment key={t}>
            <Line x1={px(t)} x2={px(t)} y1={padT} y2={padT + plotH} stroke="#d7dae0" strokeWidth={0.8} />
            <SvgText x={px(t)} y={padT + plotH + 12} fontSize={9} fill="#666" textAnchor="middle">{t}</SvgText>
          </React.Fragment>
        ))}
        <Polyline points={line(HIGH_LINE).join(' ')} fill="none" stroke="#cc2828" strokeWidth={1.2} />
        <Polyline points={line(LOW_LINE).join(' ')} fill="none" stroke="#2e8b4f" strokeWidth={1.2} />
        {withData.map((s) => (
          <Circle key={s.id} cx={px(s.flicker!.frequencyHz)} cy={py(s.flicker!.percentFlicker)} r={6} fill={s.color} stroke="#fff" strokeWidth={1.5} />
        ))}
        <SvgText x={padL + plotW / 2} y={bodyH - 2} fontSize={9} fill="#666" textAnchor="middle">Frequency (Hz) vs flicker (%)</SvgText>
      </Svg>
    );
  };

  return (
    <View style={[styles.wrap, { height }]}>
      <View style={styles.head}>
        <View style={styles.seg}>
          <TouchableOpacity style={[styles.segBtn, view === 'wave' && styles.segOn]} onPress={() => setView('wave')}>
            <Text style={[styles.segTxt, view === 'wave' && styles.segTxtOn]} allowFontScaling={false}>Wave</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.segBtn, view === 'risk' && styles.segOn]} onPress={() => setView('risk')}>
            <Text style={[styles.segTxt, view === 'risk' && styles.segTxtOn]} allowFontScaling={false}>Risk</Text>
          </TouchableOpacity>
        </View>
        <View style={{ flex: 1 }} />
        {view === 'wave' && (
          <>
            {zoom > 1 && (
              <>
                <HintPressable hint="Pan left" style={styles.pill} onPress={() => pan(-1)}><Text style={styles.pillTxt} allowFontScaling={false}>◀</Text></HintPressable>
                <HintPressable hint="Pan right" style={styles.pill} onPress={() => pan(1)}><Text style={styles.pillTxt} allowFontScaling={false}>▶</Text></HintPressable>
              </>
            )}
            <HintPressable hint="Zoom (tap to cycle)" style={[styles.pill, zoom > 1 && styles.pillOn]} onPress={() => setZoomLevel(zoom === 1 ? 2 : zoom === 2 ? 4 : zoom === 4 ? 8 : 1)}>
              <Text style={[styles.pillTxt, zoom > 1 && styles.pillTxtOn]} allowFontScaling={false}>{zoom}×</Text>
            </HintPressable>
          </>
        )}
      </View>
      {view === 'wave' ? renderWave() : renderRisk()}
      {missing.length > 0 && <Text style={styles.foot} allowFontScaling={false} numberOfLines={1}>No flicker sample: {missing.map((m) => m.label).join(', ')}</Text>}
    </View>
  );
}
