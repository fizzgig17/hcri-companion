// src/screens/tabs/SpectrumTab.tsx
//
// The "Spectrum" tab: three swipeable sub-pages sharing one top-level tab --
// the wavelength-colored SPD graph (+ raw per-nm values), the CIE 1931
// chromaticity diagram, and the CRI R1-R15 bar chart, matching how the
// vendor app visually groups Spec./Chrom. as adjacent tabs (R-Values is
// this app's own addition, ported from hCRI.io's own report page -- see
// RValuesBarChart.tsx). Swipe between them, or tap the dot indicator.
// Chrom used to be its own top-level tab; merged in here since all three
// are "what does this reading's color/spectrum look like" views on the
// exact same result, not separate concerns the way Data/Logs are.
//
// This same component is reused, unchanged, by ReadingDetailScreen (the
// History tab's "View" -> past-reading detail screen) -- a saved
// reading's result/analysis are the exact same shape as a live one, so
// there's exactly one implementation of "Spectrum/Chrom/R-Values" to keep
// in sync rather than two that could drift apart.

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import SpectrumChart from '../../components/SpectrumChart';
import ChromaticityChart from '../../components/ChromaticityChart';
import RValuesBarChart from '../../components/RValuesBarChart';
import CollapsibleSection from '../../components/CollapsibleSection';
import StatCard from '../../components/StatCard';
import SwipablePages from '../../components/SwipablePages';
import { colors } from '../../theme';
import { MeterResult } from '../../ble/parseResult';
import { SpectralAnalysis } from '../../utils/spectralAnalysis';

interface Props {
  result: MeterResult | null;
  /** Spectrum-derived x/y/CCT/Duv/Ra/R9 for `result`, computed once in HomeScreen via analyzeSpectrum() -- the exact port of hCRI.io's own algorithm, so this matches what hCRI.io itself will show for the same upload. */
  analysis: SpectralAnalysis | null;
}

export default function SpectrumTab({ result, analysis }: Props) {
  if (!result || !analysis) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>Take a reading to see its spectrum here.</Text>
      </View>
    );
  }

  return (
    <SwipablePages
      pages={[
        {
          key: 'spectrum',
          label: 'Spectrum',
          content: (
            <View>
              <View style={styles.chartCard}>
                <SpectrumChart spectrum={result.spectrum} />
              </View>

              <CollapsibleSection title="Raw Values" count={result.spectrum.length}>
                {result.spectrum.map((p) => (
                  <View key={p.nm} style={styles.spectrumRow}>
                    <Text style={styles.spectrumNm}>{p.nm}nm</Text>
                    <Text style={styles.spectrumValue}>{p.value.toFixed(4)}</Text>
                  </View>
                ))}
              </CollapsibleSection>
            </View>
          ),
        },
        {
          key: 'chrom',
          label: 'Chrom',
          content: (
            <View style={styles.chartCard}>
              <ChromaticityChart x={analysis.x} y={analysis.y} cct={analysis.cct} height={280} />
              <View style={styles.statGrid}>
                <StatCard label="x" value={analysis.x.toFixed(4)} />
                <StatCard label="y" value={analysis.y.toFixed(4)} />
                <StatCard label="CCT" value={analysis.cct.toFixed(0)} unit="K" />
                <StatCard label="Duv" value={analysis.duv.toFixed(5)} />
                <StatCard label="Ra (CRI)" value={analysis.ra.toFixed(1)} />
                <StatCard label="R9" value={analysis.r9.toFixed(1)} />
              </View>
            </View>
          ),
        },
        {
          key: 'rvalues',
          label: 'R-Values',
          content: (
            <View style={styles.chartCard}>
              <Text style={styles.rvaluesTitle}>CRI R1-R15</Text>
              <RValuesBarChart ri={analysis.ri} />
            </View>
          ),
        },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  empty: { paddingVertical: 40, alignItems: 'center' },
  emptyText: { color: colors.muted, fontSize: 13 },

  chartCard: {
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    padding: 10,
    marginBottom: 12,
  },
  spectrumRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  spectrumNm: { color: colors.muted, fontSize: 12, fontFamily: 'monospace' },
  spectrumValue: { color: colors.text, fontSize: 12, fontFamily: 'monospace' },

  statGrid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -6, marginTop: 10 },
  rvaluesTitle: { color: colors.muted, fontSize: 11, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 2 },
});
