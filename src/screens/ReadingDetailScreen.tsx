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

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, useWindowDimensions, TouchableOpacity, Alert } from 'react-native';
import { SavedReading, loadHistory } from '../storage/readingHistory';
import CategorizeModal from '../components/CategorizeModal';
import { Icon, ICON_SIZE } from '../components/icons';
import { applyCategories, CategoryValues, loadLastCategorize, otherCategoriesLine, saveLastCategorize, valuesOfReading } from '../hcri/categorize';
import { EMPTY_LED_LISTS, getCachedLedLists, LedLists, refreshLedLists } from '../hcri/ledLists';
import { ledsLine, ledsOfReading } from '../hcri/leds';
import { analyzeSpectrum } from '../utils/spectralAnalysis';
import { loadStatDisplayPrefs, visibleStatIds, defaultStatDisplayPrefs } from '../storage/statDisplayPrefs';
import { STAT_METRIC_BY_ID } from '../utils/statMetrics';
import SpectrumTab from './tabs/SpectrumTab';
import SpectrumGrid from '../components/SpectrumGrid';
import { useContentWidth, useLayoutMode, MIN_GRID_WIDTH } from '../layout';
import StatCard from '../components/StatCard';
import { useTheme } from '../contexts/ThemeContext';

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
  const [dragging, setDragging] = useState(false);
  const { colors } = useTheme();
  // The reading as it was when this page opened; re-read from History after Categorize so its categories show here.
  const [reading, setReading] = useState<SavedReading>(route.params.reading);
  const [catOpen, setCatOpen] = useState(false);
  const [lastCat, setLastCat] = useState<CategoryValues | undefined>(undefined);
  const [lists, setLists] = useState<LedLists>(EMPTY_LED_LISTS);
  useEffect(() => {
    let live = true;
    getCachedLedLists().then((l) => live && setLists(l));
    refreshLedLists().then((l) => live && setLists(l));
    return () => { live = false; };
  }, []);
  const openCategorize = useCallback(() => {
    loadLastCategorize().then(setLastCat).catch(() => {});
    setCatOpen(true);
  }, []);
  const applyCategorize = useCallback(async (values: CategoryValues) => {
    setCatOpen(false);
    try {
      await saveLastCategorize(values);
      const res = await applyCategories([reading.id], values, true);
      const fresh = (await loadHistory()).find((x) => x.id === reading.id);
      if (fresh) setReading(fresh);
      if (res.pendingSend) Alert.alert('Saved on this phone', 'It will be sent to hCRI.io once the reading is uploaded, or when you are online.');
    } catch (e: any) {
      Alert.alert('Not categorized', String(e?.message ?? e));
    }
  }, [reading.id]);
  // Tablets: every graph at once (spectrum, CIE, R1-R15 and, when the reading has one, flicker), like Home.
  const layoutMode = useLayoutMode();
  // Landscape dashboards get the draggable grid; portrait/compact swipe through the charts in their original order.
  const contentWidth = useContentWidth();
  // Narrow dashboards (square foldables) can't fit the grid -> tall pager instead.
  const wide = layoutMode === 'dashboard' && contentWidth - 32 >= MIN_GRID_WIDTH;
  const { height: winH } = useWindowDimensions();

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

  const catSummary = [ledsOfReading(reading).length ? ledsLine(ledsOfReading(reading)) : '', otherCategoriesLine(reading)].filter(Boolean).join('  ·  ');

  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { padding: 16, paddingBottom: 32 },

    savedRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
    savedAt: { color: colors.muted, fontSize: 12, fontFamily: 'monospace', flexShrink: 1 },
    catButton: { marginLeft: 12 },
    catSummaryRow: { marginTop: -4, marginBottom: 12 },
    catText: { color: colors.muted, fontSize: 13 },

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

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} scrollEnabled={!dragging}>
      <View style={styles.savedRow}>
        <Text style={styles.savedAt}>{formatSavedAt(reading.savedAt)}</Text>
        {!reading.result.sampleLabel && (
          <TouchableOpacity
            onPress={openCategorize}
            accessibilityRole="button"
            accessibilityLabel="Categorize this reading"
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            style={styles.catButton}
          >
            <Icon name="tag" color={catSummary ? colors.accent : colors.text} size={ICON_SIZE.row} />
          </TouchableOpacity>
        )}
      </View>
      {!!catSummary && !reading.result.sampleLabel && (
        <TouchableOpacity onPress={openCategorize} accessibilityRole="button" accessibilityLabel="Categories. Tap to edit." style={styles.catSummaryRow}>
          <Text style={styles.catText} numberOfLines={3}>{catSummary}</Text>
        </TouchableOpacity>
      )}

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
        {/* numberOfLines + adjustsFontSizeToFit + the shortened text itself
            -- see MainTab.tsx's identical copy of this hint for why. */}
        <Text style={styles.customizeHint} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>
          Open Settings to customize these measurements.
        </Text>
      </View>

      {wide ? (
        <SpectrumGrid
          result={reading.result}
          analysis={analysis}
          flicker={reading.result.flicker ? { reading: reading.result.flicker, running: false, history: [], fromReading: true } : undefined}
          layout="landscape"
          persist={false}
          onDragChange={setDragging}
          width={Math.max(0, contentWidth - 32)}
          height={Math.max(380, Math.min(580, Math.round(winH * 0.55)))}
        />
      ) : (
        <SpectrumTab
          // Upright tablet window: tall pages instead of the phone's short fixed ones.
          {...(layoutMode !== 'compact' ? { tall: true, regionHeight: Math.max(480, Math.min(820, Math.round(winH * 0.62))) } : {})}
          result={reading.result}
          analysis={analysis}
          flicker={reading.result.flicker ? { reading: reading.result.flicker, running: false, focusNonce: 0, history: [] } : undefined}
        />
      )}
      <CategorizeModal
        visible={catOpen}
        title="Categorize"
        lists={lists}
        initial={valuesOfReading(reading)}
        remembered={lastCat}
        onApply={applyCategorize}
        onCancel={() => setCatOpen(false)}
      />
    </ScrollView>
  );
}
