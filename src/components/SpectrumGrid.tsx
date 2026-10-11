// src/components/SpectrumGrid.tsx
//
// The wide-layout replacement for SpectrumTab's swipeable pager: every graph at once. The spectrum fills the
// top; CIE 1931, CRI R1-R15 and (when the meter supports it) Flicker sit side by side underneath. Used by
// MainTab on tablets and unfolded foldables (see layout.ts). Takes the exact pixel size of the region it fills,
// so nothing scrolls and nothing is clipped.

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
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

interface Props {
  result: MeterResult;
  analysis: SpectralAnalysis;
  sampleLabel?: string;
  flicker?: FlickerProps;
  /** Exact size of the region to fill. */
  width: number;
  height: number;
}

// Each card has padding 10 and a 1px border on every side.
const CARD_CHROME = 22;
const GAP = 12;

export default function SpectrumGrid({ result, analysis, sampleLabel, flicker, width, height }: Props) {
  const { colors } = useTheme();
  const hasReading = analysis.x > 0 || analysis.y > 0;
  const lowerH = hasReading ? Math.max(150, Math.min(240, Math.round(height * 0.4))) : 0;
  const topH = Math.max(120, height - (hasReading ? lowerH + GAP : 0));

  const styles = StyleSheet.create({
    card: {
      backgroundColor: colors.card,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      padding: 10,
      overflow: 'hidden',
    },
    // The CIE diagram is drawn for a white backdrop in either theme (see SpectrumTab's chromCard).
    chromCard: { backgroundColor: '#ffffff' },
    title: { color: colors.muted, fontSize: 11, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', height: 14, marginBottom: 2 },
    row: { flexDirection: 'row', marginTop: GAP },
  });

  const cardsInRow = flicker ? 3 : 2;
  const weights = flicker ? [1, 1.5, 1.15] : [1, 1.6];
  const totalW = width - GAP * (cardsInRow - 1);
  const wsum = weights.reduce((a, b) => a + b, 0);
  const cardW = weights.map((w) => Math.floor((totalW * w) / wsum));
  const innerH = Math.max(60, lowerH - CARD_CHROME);

  const details = sampleLabel
    ? { showRelative: true }
    : result.source === 'torchbearer'
    ? { integrationMs: result.integrationTimeMs, integrationDecimals: 1, showSpectral: true, showRelative: true }
    : { integrationMs: result.integrationTimeMs, peakSignal: result.peakSignal, darkSignal: result.darkSignal, showSpectral: true };

  const spectrumW = Math.max(0, width - CARD_CHROME);
  const spectrumPlotH = Math.max(60, topH - CARD_CHROME - SPECTRUM_HEADER_H);

  return (
    <View style={{ width, height }}>
      <View style={[styles.card, { height: topH, justifyContent: 'center' }]}>
        <SpectrumChart spectrum={result.spectrum} width={spectrumW} height={spectrumPlotH} details={details} />
      </View>
      {hasReading && (
        <View style={[styles.row, { height: lowerH }]}>
          <View style={[styles.card, styles.chromCard, { width: cardW[0], height: lowerH, marginRight: GAP }]}>
            <ChromaticityChart x={analysis.x} y={analysis.y} cct={analysis.cct} height={Math.max(60, innerH - 16)} width={Math.max(0, cardW[0] - CARD_CHROME)} />
          </View>
          <View style={[styles.card, { width: cardW[1], height: lowerH, marginRight: flicker ? GAP : 0 }]}>
            <Text style={styles.title} allowFontScaling={false} numberOfLines={1}>CRI R1-R15</Text>
            <RValuesBarChart ri={analysis.ri} height={Math.max(60, innerH - 16)} width={Math.max(0, cardW[1] - CARD_CHROME)} />
          </View>
          {flicker && (
            <View style={[styles.card, styles.chromCard, { width: cardW[2], height: lowerH }]}>
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
                width={Math.max(0, cardW[2] - CARD_CHROME)}
                height={innerH}
              />
            </View>
          )}
        </View>
      )}
    </View>
  );
}
