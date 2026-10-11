// src/screens/CompareScreen.tsx
//
// Compare 2-6 saved readings: each reading as its own card (stats plus a spectrum / flicker chart you can switch),
// the spectra or flicker waves overlaid (spectra scaled to their own peak, so lights of very different brightness
// compare by shape), and a table of the main metrics with the difference from the first reading. Opened from
// History's Select mode (Compare button) with navigation.navigate('Compare', { readings }); on tablets it's a
// window with an X (see App.tsx's overlayScreen). Cards run 3 across in landscape, 2 in portrait, 1 on a phone.

import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import Svg, { Line, Path, Text as SvgText } from 'react-native-svg';
import { useTheme } from '../contexts/ThemeContext';
import { SavedReading } from '../storage/readingHistory';
import { analyzeSpectrum } from '../utils/spectralAnalysis';
import SpectrumChart from '../components/SpectrumChart';
import FlickerChart from '../components/FlickerChart';
import FlickerCompareChart from '../components/FlickerCompareChart';
import type { FlickerReading } from '../ble/liveSessions';
import { useContentWidth, useLayoutMode } from '../layout';

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
  flicker: FlickerReading | null;
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

function Toggle<T extends string>({ value, options, onChange, colors }: { value: T; options: { key: T; label: string; disabled?: boolean }[]; onChange: (v: T) => void; colors: any }) {
  return (
    <View style={{ flexDirection: 'row', borderWidth: 1, borderColor: colors.cardBorder, borderRadius: 7, overflow: 'hidden' }}>
      {options.map((o) => {
        const on = o.key === value;
        return (
          <TouchableOpacity
            key={o.key}
            disabled={o.disabled}
            onPress={() => onChange(o.key)}
            style={{ paddingHorizontal: 10, paddingVertical: 4, backgroundColor: on ? colors.accent : 'transparent', opacity: o.disabled ? 0.35 : 1 }}
            accessibilityRole="button"
            accessibilityState={{ selected: on, disabled: o.disabled }}
          >
            <Text style={{ fontSize: 12, fontWeight: '700', color: on ? '#fff' : colors.text }} allowFontScaling={false}>{o.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function fmtStat(it: Item, key: string): string {
  const row = ROWS.find((r) => r.key === key)!;
  const v = row.get(it);
  return v === null ? '–' : fmt(v, row.dp);
}

function ReadingCard({ item, color, width, colors }: { item: Item; color: string; width: number; colors: any }) {
  const [chart, setChart] = useState<'spd' | 'flicker'>('spd');
  const inner = Math.max(0, width - 26);
  return (
    <View style={{ width, backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.cardBorder, padding: 12, marginBottom: 14 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
        <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: color, marginRight: 8 }} />
        <Text style={{ color: colors.text, fontSize: 14, fontWeight: '700', flex: 1 }} numberOfLines={1}>{item.label}</Text>
        <Toggle
          colors={colors}
          value={chart}
          onChange={setChart}
          options={[{ key: 'spd', label: 'SPD' }, { key: 'flicker', label: 'Flicker', disabled: !item.flicker }]}
        />
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 8 }}>
        {[['cct', 'CCT'], ['ra', 'Ra'], ['duv', 'Duv'], ['lux', 'Lux'], ['rf', 'Rf'], ['rg', 'Rg'], ['r9', 'R9']].map(([k, l]) => (
          <View key={k} style={{ width: '25%', paddingVertical: 3 }}>
            <Text style={{ color: colors.muted, fontSize: 10.5 }}>{l}</Text>
            <Text style={{ color: colors.text, fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{fmtStat(item, k)}</Text>
          </View>
        ))}
      </View>
      {chart === 'flicker' && item.flicker ? (
        <View style={{ backgroundColor: '#fff', borderRadius: 8, overflow: 'hidden' }}>
          <FlickerChart reading={item.flicker} running={false} history={[]} fromReading width={inner} height={280} />
        </View>
      ) : (
        <SpectrumChart spectrum={item.spectrum} width={inner} height={200} />
      )}
    </View>
  );
}

export default function CompareScreen({ route }: any) {
  const { colors, scheme } = useTheme();
  const layoutMode = useLayoutMode();
  const contentWidth = useContentWidth();
  const [overlayChart, setOverlayChart] = useState<'spd' | 'flicker'>('spd');
  const readings: SavedReading[] = route.params.readings;
  const palette = scheme === 'light' ? SERIES_LIGHT : SERIES_DARK;
  const [plotW, setPlotW] = useState(0);

  const items: Item[] = useMemo(
    () =>
      readings.map((r) => {
        const a = r.analysis ?? analyzeSpectrum(r.result.spectrum);
        return { id: r.id, label: r.label, cct: a.cct, ra: a.ra, duv: a.duv, rf: a.rf, rg: a.rg, r9: a.r9, lux: r.result.lux ?? null, spectrum: r.result.spectrum, flicker: r.result.flicker ?? null };
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
  const wide = layoutMode !== 'compact';
  const anyFlicker = items.some((it) => !!it.flicker);
  // Same landscape / portrait / phone arrangement as the main page.
  const cols = layoutMode === 'dashboard' ? Math.min(3, items.length) : layoutMode === 'stacked' ? Math.min(2, items.length) : 1;
  const GAP = 14;
  const areaW = Math.max(0, contentWidth - 32);
  const cardW = Math.floor((areaW - GAP * (cols - 1)) / cols);

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

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' }}>
        {items.map((it, i) => (
          <ReadingCard key={it.id} item={it} color={palette[i % palette.length]} width={cols === 1 ? areaW : cardW} colors={colors} />
        ))}
      </View>

      <View style={styles.card}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={styles.cardTitle}>{overlayChart === 'spd' ? 'Spectra overlay' : 'Flicker overlay'}</Text>
          <Toggle
            colors={colors}
            value={overlayChart}
            onChange={setOverlayChart}
            options={[{ key: 'spd', label: 'SPD' }, { key: 'flicker', label: 'Flicker', disabled: !anyFlicker }]}
          />
        </View>
        <Text style={styles.cardNote}>
          {overlayChart === 'spd'
            ? 'Each curve is scaled to its own peak, so you compare shape, not brightness.'
            : 'Each wave is scaled to its own peak. Wave shows the shapes (zoom to see detail); Risk places each reading on the IEEE 1789 bands.'}
        </Text>
        <View onLayout={(e) => setPlotW(Math.floor(e.nativeEvent.layout.width))}>
          {W > 0 && overlayChart === 'flicker' && (
            <FlickerCompareChart
              width={W}
              height={wide ? 340 : H + 40}
              series={items.map((it, i) => ({ id: it.id, label: it.label, color: palette[i % palette.length], flicker: it.flicker }))}
            />
          )}
          {W > 0 && overlayChart === 'spd' && (
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
