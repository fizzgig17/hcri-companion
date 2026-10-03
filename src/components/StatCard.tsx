// src/components/StatCard.tsx
//
// One tile in the stat grid (CCT, Ra, Lux, R9, Duv, ...). Pulled out on
// its own since the Main, Data, and Spectrum/Chrom tabs all need it.
//
// `compact` is a smaller, tighter-spaced rendering -- used by MainTab's
// result card, which can show anywhere from a handful to over 20 tiles
// (the person's own customized measurement list; see utils/statMetrics.ts
// and SettingsScreen), so it needs to stay reasonably short even with a
// long list. Data/Spectrum/Chrom's own fixed, short stat grids keep the
// original, larger sizing.

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../contexts/ThemeContext';

interface Props {
  label: string;
  value: string;
  unit?: string;
  compact?: boolean;
}

export default function StatCard({ label, value, unit, compact }: Props) {
  const { colors } = useTheme();

  const styles = StyleSheet.create({
    statCard: { width: '50%', paddingHorizontal: 6, marginBottom: 12 },
    statValue: { color: colors.text, fontSize: 22, fontWeight: '700' },
    statUnit: { color: colors.muted, fontSize: 14, fontWeight: '400' },
    statLabel: { color: colors.muted, fontSize: 12, marginTop: 2 },

    // Three columns instead of two, and smaller text/spacing throughout --
    // what actually keeps a long, customized list from making the result
    // card towering: at 7 tiles (the default set) this is 3 rows instead
    // of 4, and each row itself is shorter.
    statCardCompact: { width: '33.33%', paddingHorizontal: 5, marginBottom: 8 },
    statValueCompact: { fontSize: 17 },
    statUnitCompact: { fontSize: 11 },
    statLabelCompact: { fontSize: 10.5, marginTop: 1 },
  });

  return (
    <View style={[styles.statCard, compact && styles.statCardCompact]}>
      <Text style={[styles.statValue, compact && styles.statValueCompact]}>
        {value}
        {unit ? <Text style={[styles.statUnit, compact && styles.statUnitCompact]}> {unit}</Text> : null}
      </Text>
      <Text style={[styles.statLabel, compact && styles.statLabelCompact]}>{label}</Text>
    </View>
  );
}
