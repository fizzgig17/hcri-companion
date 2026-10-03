// src/screens/tabs/AboutTab.tsx
//
// Lists exactly which meter models this app has real, verified support
// for (and what's different/notable about each one), plus which name
// pattern is used to detect each one. Pulls from supportedDevices.ts,
// which is the single place to update when a new model gets added --
// this tab just renders whatever's in there, so it never needs its own
// changes when the device list grows.

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../../contexts/ThemeContext';
import { SUPPORTED_DEVICES } from '../../ble/supportedDevices';

export default function AboutTab() {
  const { colors } = useTheme();

  const styles = StyleSheet.create({
    card: {
      backgroundColor: colors.card,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      padding: 14,
      marginBottom: 12,
    },
    heading: { color: colors.text, fontSize: 15, fontWeight: '700', marginBottom: 4 },
    subheading: { color: colors.muted, fontSize: 12, lineHeight: 17 },

    headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    model: { color: colors.text, fontSize: 15, fontWeight: '700' },
    matchedBy: { color: colors.muted, fontSize: 11, fontFamily: 'monospace', marginTop: 3, marginBottom: 6 },
    verifiedDate: { color: colors.mutedFaint, fontSize: 11, marginBottom: 6 },
    note: { color: colors.muted, fontSize: 12, lineHeight: 17, marginTop: 2 },

    badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
    badgeVerified: { backgroundColor: 'rgba(47,168,122,0.18)' },
    badgeUnverified: { backgroundColor: 'rgba(209,85,74,0.18)' },
    badgeText: { fontSize: 10, fontWeight: '700', color: colors.text },
  });

  return (
    <View>
      <View style={styles.card}>
        <Text style={styles.heading}>Supported Meters</Text>
        <Text style={styles.subheading}>
          This app auto-detects which model you're connected to from its advertised Bluetooth name, and reads its
          data using that model's own field layout.
        </Text>
      </View>

      {SUPPORTED_DEVICES.map((d) => (
        <View key={d.model} style={styles.card}>
          <View style={styles.headerRow}>
            <Text style={styles.model}>{d.model}</Text>
            <View style={[styles.badge, d.verified ? styles.badgeVerified : styles.badgeUnverified]}>
              <Text style={styles.badgeText}>{d.verified ? 'Verified' : 'Unverified'}</Text>
            </View>
          </View>
          <Text style={styles.matchedBy}>{d.matchedBy}</Text>
          {d.verifiedDate && <Text style={styles.verifiedDate}>Verified against a real reading on {d.verifiedDate}</Text>}
          {d.notes.map((note, i) => (
            <Text key={i} style={styles.note}>
              •  {note}
            </Text>
          ))}
        </View>
      ))}
    </View>
  );
}
