// src/components/StatCard.tsx
//
// One tile in the 2-column stat grid (CCT, Ra, Lux, R9, Duv, ...). Pulled
// out on its own since both the Data tab and (previously) the main screen
// need it.

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors } from '../theme';

interface Props {
  label: string;
  value: string;
  unit?: string;
}

export default function StatCard({ label, value, unit }: Props) {
  return (
    <View style={styles.statCard}>
      <Text style={styles.statValue}>
        {value}
        {unit ? <Text style={styles.statUnit}> {unit}</Text> : null}
      </Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  statCard: { width: '50%', paddingHorizontal: 6, marginBottom: 12 },
  statValue: { color: colors.text, fontSize: 22, fontWeight: '700' },
  statUnit: { color: colors.muted, fontSize: 14, fontWeight: '400' },
  statLabel: { color: colors.muted, fontSize: 12, marginTop: 2 },
});
