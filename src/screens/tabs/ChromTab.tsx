// src/screens/tabs/ChromTab.tsx
//
// The "Chrom" tab: the CIE 1931 chromaticity diagram for the latest
// reading -- where its (x, y) color point falls relative to the visible
// spectrum's outline and the blackbody curve, matching the vendor app's
// own Chrom. tab. Read-only, like Spectrum/Data/Logs.

import React from 'react';
import { View, Text, StyleSheet, useWindowDimensions } from 'react-native';
import ChromaticityChart from '../../components/ChromaticityChart';
import StatCard from '../../components/StatCard';
import { useTheme } from '../../contexts/ThemeContext';
import { MeterResult } from '../../ble/parseResult';

interface Props {
  result: MeterResult | null;
}

export default function ChromTab({ result }: Props) {
  const { colors } = useTheme();
  // Not actually mounted anywhere any more (SpectrumTab.tsx's "Chrom" page
  // superseded this standalone tab) -- ChromaticityChart just needs a
  // `width` prop now instead of measuring itself (see its own comment),
  // so this keeps compiling with a reasonable stand-in rather than the
  // real per-host chrome math SpectrumTab.tsx now owns.
  const { width: windowWidth } = useWindowDimensions();
  const chartWidth = Math.max(windowWidth - 32 - 28, 0);

  const styles = StyleSheet.create({
    empty: { paddingVertical: 40, alignItems: 'center' },
    emptyText: { color: colors.muted, fontSize: 13 },

    card: {
      backgroundColor: colors.card,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      padding: 14,
    },
    statGrid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -6, marginTop: 10 },
  });

  if (!result) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>Take a reading to see its chromaticity here.</Text>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <ChromaticityChart x={result.x} y={result.y} cct={result.cct} height={280} width={chartWidth} />
      <View style={styles.statGrid}>
        <StatCard label="x" value={result.x.toFixed(4)} />
        <StatCard label="y" value={result.y.toFixed(4)} />
        <StatCard label="CCT" value={result.cct.toFixed(0)} unit="K" />
        <StatCard label="Duv" value={result.duv.toFixed(5)} />
      </View>
    </View>
  );
}
