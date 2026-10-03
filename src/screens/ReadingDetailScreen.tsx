// src/screens/ReadingDetailScreen.tsx
//
// Opened from the History tab's "View" link on a saved reading -- shows
// that one reading exactly the way the Main tab would have shown it at
// the moment it was taken (same compact measurement grid, same person's
// own Settings customization of which measurements and what order --
// see statMetrics.ts/statDisplayPrefs.ts) plus the full swipeable
// Spectrum/Chrom/R-Values pages (SpectrumTab.tsx, unchanged -- a saved
// reading's result/analysis are the exact same shape a live one is, so
// this screen is just SpectrumTab fed a past reading instead of the
// current one, not a second implementation of those charts).
//
// Reached via navigation.navigate('ReadingDetail', { reading }) -- the
// whole SavedReading travels as a route param rather than an id this
// screen re-reads from storage, since HistoryTab already has it in memory
// and there's no deep-linking concern here that would need it to be
// JSON-serializable-only.

import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SavedReading } from '../storage/readingHistory';
import { analyzeSpectrum } from '../utils/spectralAnalysis';
import { loadStatDisplayPrefs, visibleStatIds, defaultStatDisplayPrefs } from '../storage/statDisplayPrefs';
import { STAT_METRIC_BY_ID } from '../utils/statMetrics';
import SpectrumTab from './tabs/SpectrumTab';
import StatCard from '../components/StatCard';
import { colors } from '../theme';

function formatSavedAt(ms: number): string {
  return new Date(ms).toLocaleString();
}

// Typed as `any`, matching HomeScreen's own convention for its navigator-
// supplied props -- React Navigation's generic ParamListBase typing for
// Stack.Screen's `component` doesn't play well with a named Props
// interface here (it wants something assignable from `{}`), and the real
// shape (route.params.reading: SavedReading) is still enforced where it
// matters, at the one call site that navigates here (HomeScreen.tsx).
export default function ReadingDetailScreen({ route, navigation }: any) {
  const reading: SavedReading = route.params.reading;

  // Same fallback readingHistory.ts's own SavedReading.analysis comment
  // describes: readings saved before `analysis` existed on disk don't have
  // it, so it's recomputed from the stored spectrum in that case -- same
  // one-time-per-reading cost HistoryTab's row summary already accepts.
  const analysis = useMemo(() => reading.analysis ?? analyzeSpectrum(reading.result.spectrum), [reading]);

  // Which measurements to show, and in what order -- the person's own
  // Settings choice, same statIds Main tab reads (see HomeScreen.tsx) --
  // loaded fresh here since this screen can be reached without HomeScreen
  // having loaded first (e.g. a cold app restart straight into History,
  // in principle) and should reflect whatever's current, not a stale copy.
  const [statIds, setStatIds] = useState<string[]>(() => visibleStatIds(defaultStatDisplayPrefs()));
  useEffect(() => {
    loadStatDisplayPrefs().then((prefs) => setStatIds(visibleStatIds(prefs))).catch(() => {});
  }, []);

  useEffect(() => {
    navigation.setOptions({ title: reading.label });
    // Intentionally run once -- the title is this reading's label as it
    // was when the screen opened; a rename back on the History tab while
    // this screen is already open doesn't need to chase it live here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.savedAt}>{formatSavedAt(reading.savedAt)}</Text>

      <View style={styles.resultCard}>
        <View style={styles.statGrid}>
          {statIds.map((id) => {
            const metric = STAT_METRIC_BY_ID[id];
            if (!metric) return null;
            const out = metric.format(reading.result, analysis);
            if (!out) return null;
            return <StatCard key={id} label={metric.label} value={out.value} unit={out.unit} compact />;
          })}
        </View>
        <Text style={styles.customizeHint}>Tap ⚙ Settings to customize which measurements show here, and in what order.</Text>
      </View>

      <SpectrumTab result={reading.result} analysis={analysis} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#111' },
  content: { padding: 16, paddingBottom: 32 },

  savedAt: { color: colors.muted, fontSize: 12, fontFamily: 'monospace', marginBottom: 10 },

  resultCard: {
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    padding: 14,
    marginBottom: 16,
  },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -5, marginBottom: 2 },
  customizeHint: { color: colors.mutedFaint, fontSize: 10.5, marginBottom: 2, textAlign: 'center' },
});
