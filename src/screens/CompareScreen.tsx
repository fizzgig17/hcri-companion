// src/screens/CompareScreen.tsx
//
// Compare 2-6 saved readings: their spectra overlaid (each scaled to its own peak, so lights of very different
// brightness can be compared by shape) and a table of the main metrics with the difference from the first
// reading. Opened from History's Select mode (Compare button) with navigation.navigate('Compare', { readings }).
// Works at any width; on a tablet it simply has more room.

import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, useWindowDimensions } from 'react-native';
import Svg, { Line, Path, Text as SvgText } from 'react-native-svg';
import { useTheme } from '../contexts/ThemeContext';
import { SavedReading } from '../storage/readingHistory';
import { analyzeSpectrum } from '../utils/spectralAnalysis';

const SERIES_DARK = ['#f0a03c', '#5aa3ff', '#d56ad8', '#3fc293', '#e8e052', '#ff7b7b'];
const SERIES_LIGHT = ['#b86a0c', '#2f6fd1', '#a23a9d', '#1f7a56', '#8a7f00', '#c1443a'];
const MIN_NM = 380;
const MAX_NM = 780;

type Row = { key: string; label: string; dp: number; unit?: string; get: (r: Item) => number | null };
interface Item {
  id: string;
  label: string;
  cct: number; ra: number; duv: number; rf: number; rg: number; r9: number; lux: number | null;
  spectrum: { nm: number; value: number }[];
}

const ROWS: Row[] = [
  { key: 'cct', label: 'CCT', dp: 0, unit: ' K', get: (r) => r.cct },
  { key: 'ra', label: 'Ra', dp: 0, get: (r) => r.ra },
  { key: 'duv', label: 'Duv', dp: 5, get: (r) => r.duv },
  { key: 'lux', label: 'Lux', dp: 0, get: (r) => r.lux },
  { key: 'rf', label: 'Rf', dp: 0, get: (r) => r.rf },
  { key: 'rg', label: 'Rg', dp: 0, get: (r) => r.rg },
  { key: 'r9', label: 'R9', dp: 1, get: (r) => r.r9 },
];

function fmt(v: number, dp: number): string {
  return (v < 0 ? '−' : '') + Math.abs(v).toFixed(dp);
}
function fmtDelta(d: number, dp: number): string {
  if (Math.abs(d) < Math.pow(10, -dp) / 2) return '±0';
  return (d > 0 ? '+' : '−') + Math.abs(d).toFixed(dp);
}

export default function CompareScreen({ route }: any) {
  const { colors, scheme } = useTheme();
  const { width: winW } = useWindowDimensions();
  const readings: SavedReading[] = route.params.readings;
  const palette = scheme === 'light' ? SERIES_LIGHT : SERIES_DARK;
  const [plotW, setPlotW] = useState(0);

  const items: Item[] = useMemo(
    () =>
      readings.map((r) => {
        const a = r.analysis ?? analyzeSpectrum(r.result.spectrum);
        return { id: r.id, label: r.label, cct: a.cct, ra: a.ra, duv: a.duv, rf: a.rf, rg: a.rg, r9: a.r9, lux: r.result.lux ?? null, spectrum: r.result.spectrum };
      }),
    [readings]
  );

  const H = 260;
  const PAD = { top: 10, right: 12, bottom: 30, left: 38 };
  const W = Math.max(0, plotW);
  const pw = Math.max(0, W - PAD.left - PAD.right);
  const ph = H - PAD.top - PAD.bottom;
  const paths = useMemo(() => {
    if (pw <= 0) return [];
    return items.map((it) => {
      const pts = it.spectrum.filter((p) => p.nm >= MIN_NM && p.nm <= MAX_NM);
      const mx = pts.reduce((m, p) => Math.max(m, p.value), 0) || 1;
      return pts.map((p, i) => `${i ? 'L' : 'M'}${(PAD.left + ((p.nm - MIN_NM) / (MAX_NM - MIN_NM)) * pw).toFixed(1)},${(PAD.top + ph * (1 - p.value / mx)).toFixed(1)}`).join('');
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- PAD/ph are constants
  }, [items, pw]);

  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { padding: 16, paddingBottom: 40 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 12 },
    chip: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: colors.cardBorder, backgroundColor: colors.card, borderRadius: 17, paddingHorizontal: 12, height: 34, marginRight: 8, marginBottom: 8, maxWidth: '100%' },
    dot: { width: 10, height: 10, borderRadius: 5, marginRight: 8 },
    chipText: { color: colors.text, fontSize: 13, fontWeight: '600', flexShrink: 1 },
    card: { backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.cardBorder, padding: 12, marginBottom: 14 },
    cardTitle: { color: colors.text, fontSize: 15, fontWeight: '700' },
    cardNote: { color: colors.muted, fontSize: 12, marginBottom: 6 },
    tHead: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: colors.cardBorder, paddingBottom: 8 },
    tRow: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: colors.cardBorder, minHeight: 40 },
    metric: { width: 64, color: colors.muted, fontSize: 13 },
    cell: { width: 118 },
    cellValue: { color: colors.text, fontSize: 16, fontWeight: '700', fontVariant: ['tabular-nums'] },
    cellDelta: { color: colors.muted, fontSize: 12, fontVariant: ['tabular-nums'] },
    headCell: { width: 118, flexDirection: 'row', alignItems: 'center', paddingRight: 8 },
    headText: { color: colors.text, fontSize: 12, fontWeight: '700', flexShrink: 1 },
    axis: { color: colors.muted },
  });

  const ticks = [400, 450, 500, 550, 600, 650, 700, 750];
  const wide = winW >= 900;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.chips}>
        {items.map((it, i) => (
          <View key={it.id} style={styles.chip}>
            <View style={[styles.dot, { backgroundColor: palette[i % palette.length] }]} />
            <Text style={styles.chipText} numberOfLines={1}>{it.label}</Text>
          </View>
        ))}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Spectra overlay</Text>
        <Text style={styles.cardNote}>Each curve is scaled to its own peak, so you compare shape, not brightness.</Text>
        <View onLayout={(e) => setPlotW(Math.floor(e.nativeEvent.layout.width))}>
          {W > 0 && (
            <Svg width={W} height={wide ? 340 : H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
              {[0, 0.25, 0.5, 0.75, 1].map((f) => {
                const y = PAD.top + ph * (1 - f);
                return (
                  <React.Fragment key={f}>
                    <Line x1={PAD.left} y1={y} x2={W - PAD.right} y2={y} stroke={colors.cardBorder} strokeWidth={1} />
                    <SvgText x={PAD.left - 6} y={y + 3} fontSize={10} fill={colors.muted} textAnchor="end">{`${Math.round(f * 100)}%`}</SvgText>
                  </React.Fragment>
                );
              })}
              {paths.map((d, i) => (
                <Path key={items[i].id} d={d} fill="none" stroke={palette[i % palette.length]} strokeWidth={2} strokeLinejoin="round" />
              ))}
              {ticks.map((nm) => (
                <SvgText key={nm} x={PAD.left + ((nm - MIN_NM) / (MAX_NM - MIN_NM)) * pw} y={H - 12} fontSize={10} fill={colors.muted} textAnchor="middle">{String(nm)}</SvgText>
              ))}
            </Svg>
          )}
        </View>
      </View>

      <View style={styles.card}>
        <Text style={[styles.cardTitle, { marginBottom: 8 }]}>Metrics</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View>
            <View style={styles.tHead}>
              <Text style={styles.metric}>{''}</Text>
              {items.map((it, i) => (
                <View key={it.id} style={styles.headCell}>
                  <View style={[styles.dot, { backgroundColor: palette[i % palette.length] }]} />
                  <Text style={styles.headText} numberOfLines={1}>{it.label}</Text>
                </View>
              ))}
            </View>
            {ROWS.map((row) => {
              const first = row.get(items[0]);
              return (
                <View key={row.key} style={styles.tRow}>
                  <Text style={styles.metric}>{row.label}</Text>
                  {items.map((it, i) => {
                    const v = row.get(it);
                    return (
                      <View key={it.id} style={styles.cell}>
                        <Text style={styles.cellValue}>
                          {v === null ? '–' : fmt(v, row.dp) + (row.unit ?? '')}
                          {i > 0 && v !== null && first !== null ? <Text style={styles.cellDelta}>{`  ${fmtDelta(v - first, row.dp)}`}</Text> : null}
                        </Text>
                      </View>
                    );
                  })}
                </View>
              );
            })}
          </View>
        </ScrollView>
        <Text style={[styles.cardNote, { marginTop: 8, marginBottom: 0 }]}>Differences are from the first reading.</Text>
      </View>
    </ScrollView>
  );
}
