// src/components/SpectrumGrid.tsx
//
// The wide-layout replacement for SpectrumTab's swipeable pager: every graph at once, with one of them large and
// the others small. Used by MainTab on tablets and unfolded foldables (see layout.ts).
//
//   landscape  the big chart across the top; the others side by side underneath.
//   portrait   the big chart on the left, in proportion rather than ultra-wide; the others stacked down the right.
//
// Any small chart can be dragged (or tapped by its ⠿ handle) onto the big slot. The chosen chart becomes big and
// the rest keep a fixed order -- spectrum, CIE, R1-R15, flicker -- so promoting the R-bars gives
// R-bars / spectrum, CIE, flicker; promoting CIE then gives CIE / spectrum, R-bars, flicker. The choice is saved.
//
// It takes the exact pixel size of the region it fills, and positions every card itself (absolute rectangles), so
// nothing scrolls, nothing is clipped, and a card being dragged can float over the others.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, Animated, PanResponder, Pressable } from 'react-native';
import SpectrumChart, { SPECTRUM_HEADER_H } from './SpectrumChart';
import ChromaticityChart from './ChromaticityChart';
import RValuesBarChart from './RValuesBarChart';
import FlickerChart from './FlickerChart';
import { useTheme } from '../contexts/ThemeContext';
import { MeterResult } from '../ble/parseResult';
import { SpectralAnalysis } from '../utils/spectralAnalysis';
import type { FlickerReading } from '../ble/liveSessions';
import type { FlickerSettingsApi } from './FlickerSettingsModal';
import type { FlickerUploadApi } from './FlickerChart';
import { chartOrder, gridRects, CHART_IDS, ChartId, Rect } from '../chartGrid';
import { loadChartTopPreference, saveChartTopPreference } from '../storage/preferences';

type FlickerProps = {
  reading: FlickerReading | null;
  running: boolean;
  history: { f: number; p: number }[];
  settings?: FlickerSettingsApi;
  upload?: FlickerUploadApi;
  target?: 'reading' | 'new' | null;
  onStart?: (target: 'reading' | 'new') => void;
  onStop?: () => void;
  canSampleReading?: boolean;
  redoLabel?: string;
  readingNote?: string;
  fromReading?: boolean;
};

export type { ChartId } from '../chartGrid';

interface Props {
  result: MeterResult;
  analysis: SpectralAnalysis;
  sampleLabel?: string;
  flicker?: FlickerProps;
  /** 'landscape': big chart on top, others underneath. 'portrait': big chart left, others down the right. */
  layout?: 'landscape' | 'portrait';
  /** Whether the chosen big chart is remembered between launches. The main page: yes. A saved reading opened from
   *  History: no -- it always starts with the spectrum big and never changes what the main page remembers. */
  persist?: boolean;
  /** Called while a chart is being dragged (so a parent ScrollView can stop scrolling meanwhile). */
  onDragChange?: (dragging: boolean) => void;
  /** Exact size of the region to fill. */
  width: number;
  height: number;
}

// Each card has padding 10 and a 1px border on every side.
const CARD_CHROME = 22;

function DraggableCard({ id, rect, bigRect, onPromote, onDragChange, children, style, handleColor }: {
  id: ChartId; rect: Rect; bigRect: Rect; onPromote: (id: ChartId) => void; onDragChange: (dragging: boolean) => void;
  children: React.ReactNode; style: any; handleColor: string;
}) {
  const pan = useRef(new Animated.ValueXY()).current;
  const [dragging, setDragging] = useState(false);
  // The responder is created once; keep the latest geometry and callbacks where it can read them.
  const live = useRef({ rect, bigRect, onPromote, onDragChange, id });
  live.current = { rect, bigRect, onPromote, onDragChange, id };

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => { setDragging(true); live.current.onDragChange(true); },
      onPanResponderMove: Animated.event([null, { dx: pan.x, dy: pan.y }], { useNativeDriver: false }),
      onPanResponderRelease: (_e, g) => {
        const { rect: r, bigRect: b, onPromote: promote, id: cid } = live.current;
        const cx = r.x + r.w / 2 + g.dx;
        const cy = r.y + r.h / 2 + g.dy;
        const moved = Math.hypot(g.dx, g.dy) > 8;
        const inBig = cx >= b.x && cx <= b.x + b.w && cy >= b.y && cy <= b.y + b.h;
        setDragging(false);
        live.current.onDragChange(false);
        pan.setValue({ x: 0, y: 0 });
        if (inBig || !moved) promote(cid);   // dropped on the big chart, or just tapped the handle
      },
      onPanResponderTerminate: () => { setDragging(false); live.current.onDragChange(false); pan.setValue({ x: 0, y: 0 }); },
    }),
  ).current;

  return (
    <Animated.View
      style={[
        { position: 'absolute', left: rect.x, top: rect.y, width: rect.w, height: rect.h },
        dragging && { zIndex: 20, elevation: 12, shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } },
        { transform: pan.getTranslateTransform() },
      ]}
    >
      <View style={[style, { width: rect.w, height: rect.h }, dragging && { opacity: 0.92 }]}>{children}</View>
      <View
        {...responder.panHandlers}
        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
        accessibilityRole="button"
        accessibilityLabel="Drag to the large chart to enlarge this chart"
        style={handleStyles.handle}
      >
        {/* Drawn from Views, not a glyph: the braille character has no font on iOS and the handle vanished. */}
        <View style={handleStyles.dots}>
          {[0, 1, 2].map((r) => (
            <View key={r} style={handleStyles.dotRow}>
              <View style={[handleStyles.dot, { backgroundColor: handleColor }]} />
              <View style={[handleStyles.dot, { backgroundColor: handleColor }]} />
            </View>
          ))}
        </View>
      </View>
    </Animated.View>
  );
}

function DotsGlyph({ color }: { color: string }) {
  return (
    <View style={handleStyles.dots}>
      {[0, 1, 2].map((r) => (
        <View key={r} style={handleStyles.dotRow}>
          <View style={[handleStyles.dot, { backgroundColor: color }]} />
          <View style={[handleStyles.dot, { backgroundColor: color }]} />
        </View>
      ))}
    </View>
  );
}

const handleStyles = StyleSheet.create({
  handle: { position: 'absolute', top: 2, right: 2, width: 34, height: 30, alignItems: 'center', justifyContent: 'center' },
  dots: { gap: 3 },
  dotRow: { flexDirection: 'row', gap: 3 },
  dot: { width: 4, height: 4, borderRadius: 2 },
});

export default function SpectrumGrid({ result, analysis, sampleLabel, flicker, layout = 'landscape', persist = true, onDragChange, width, height }: Props) {
  const { colors } = useTheme();
  const hasReading = analysis.x > 0 || analysis.y > 0;
  const [topPref, setTopPref] = useState<ChartId>('spectrum');
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!persist) return;
    loadChartTopPreference().then((v) => { if (v && CHART_IDS.has(v)) setTopPref(v as ChartId); }).catch(() => {});
  }, [persist]);

  const available: ChartId[] = useMemo(
    // Before the first reading there is only the spectrum, plus the (blank) flicker chart when the connected meter can do flicker.
    () => (hasReading ? (['spectrum', 'cie', 'rvalues', ...(flicker ? ['flicker'] : [])] as ChartId[]) : (['spectrum', ...(flicker ? ['flicker'] : [])] as ChartId[])),
    [hasReading, flicker],
  );
  const order = useMemo(() => chartOrder(topPref, available), [topPref, available]);
  const rects = useMemo(() => gridRects(order, width, height, layout), [order, width, height, layout]);
  const bigId = order[0];

  const promote = (id: ChartId) => {
    if (id === bigId) return;
    setTopPref(id);
    if (persist) saveChartTopPreference(id).catch(() => {});
  };

  const styles = StyleSheet.create({
    card: {
      backgroundColor: colors.card,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      padding: 10,
      overflow: 'hidden',
    },
    // The CIE diagram and the flicker chart are drawn for a white backdrop in either theme.
    whiteCard: { backgroundColor: '#ffffff' },
    dropHint: { borderColor: colors.accent, borderWidth: 2 },
    title: { color: colors.muted, fontSize: 11, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', height: 14, marginBottom: 2 },
  });

  const details = sampleLabel
    ? { showRelative: true }
    : result.source === 'torchbearer'
    ? { integrationMs: result.integrationTimeMs, integrationDecimals: 1, showSpectral: true, showRelative: true }
    : { integrationMs: result.integrationTimeMs, peakSignal: result.peakSignal, darkSignal: result.darkSignal, showSpectral: true };

  const body = (id: ChartId, r: Rect, isBig: boolean) => {
    const w = Math.max(0, r.w - CARD_CHROME);
    const h = Math.max(60, r.h - CARD_CHROME);
    switch (id) {
      case 'spectrum':
        return <SpectrumChart spectrum={result.spectrum} width={w} height={Math.max(60, h - SPECTRUM_HEADER_H)} details={isBig ? details : undefined} />;
      case 'cie':
        return <ChromaticityChart x={analysis.x} y={analysis.y} cct={analysis.cct} height={Math.max(60, h - 16)} width={w} />;
      case 'rvalues':
        return (
          <>
            <Text style={styles.title} allowFontScaling={false} numberOfLines={1}>CRI R1-R15</Text>
            <RValuesBarChart ri={analysis.ri} height={Math.max(60, h - 16)} width={w} />
          </>
        );
      case 'flicker':
        return flicker ? (
          <FlickerChart
            reading={flicker.reading}
            running={flicker.running}
            history={flicker.history}
            settings={flicker.settings}
            upload={flicker.upload}
            target={flicker.target}
            onStart={flicker.onStart}
            onStop={flicker.onStop}
            canSampleReading={flicker.canSampleReading}
            redoLabel={flicker.redoLabel}
            readingNote={flicker.readingNote}
            fromReading={flicker.fromReading}
            reserveRight={36}
            width={w}
            height={h}
          />
        ) : null;
    }
  };

  const cardStyle = (id: ChartId) => [styles.card, (id === 'cie' || id === 'flicker') && styles.whiteCard];
  const bigRect = rects[bigId];

  return (
    <View style={{ width, height }}>
      <View
        style={[{ position: 'absolute', left: bigRect.x, top: bigRect.y, width: bigRect.w, height: bigRect.h }, ...(cardStyle(bigId) as any[]), { padding: 10 }, dragging && styles.dropHint]}
      >
        {body(bigId, bigRect, true)}
        {/* The big chart gets a handle too: tap it to swap in the next chart. */}
        {order.length > 1 && (
          <Pressable
            onPress={() => promote(order[1])}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel="Swap to the next chart"
            style={handleStyles.handle}
          >
            <DotsGlyph color={bigId === 'cie' || bigId === 'flicker' ? '#666' : colors.muted} />
          </Pressable>
        )}
      </View>
      {order.slice(1).map((id) => (
        <DraggableCard
          key={id}
          id={id}
          rect={rects[id]}
          bigRect={bigRect}
          onPromote={promote}
          onDragChange={(d) => { setDragging(d); onDragChange?.(d); }}
          style={cardStyle(id)}
          handleColor={id === 'cie' || id === 'flicker' ? '#666' : colors.muted}
        >
          {body(id, rects[id], false)}
        </DraggableCard>
      ))}
    </View>
  );
}
