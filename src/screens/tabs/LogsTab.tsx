// src/screens/tabs/LogsTab.tsx
//
// The "Logs" tab: the running debug log (including raw hex dumps from
// takeMeasurement.ts) and the Share Debug Log button.
//
// The log lines live in their own fixed-height, independently-scrolling
// box rather than just being laid out inline in HomeScreen's outer
// ScrollView. With up to 100 lines (see appendLog's cap in HomeScreen),
// scrolling through them in the outer ScrollView meant dragging the
// header/tab bar off-screen too, since it was all one long page. This way
// the header and tab bar stay put and only the log itself scrolls.

import React from 'react';
import { View, Text, TouchableOpacity, ScrollView, useWindowDimensions, StyleSheet } from 'react-native';
import { colors } from '../../theme';

interface Props {
  log: string[];
  onShare: () => void;
}

export default function LogsTab({ log, onShare }: Props) {
  const { height } = useWindowDimensions();
  // Leaves room for the header/tab bar above and the Share button inside
  // this card -- the log box itself takes whatever's left, with a sane
  // floor so it's never uselessly short on a small/split-screen window.
  const logBoxHeight = Math.max(260, height - 320);

  return (
    <View style={styles.card}>
      {log.length === 0 ? (
        <Text style={styles.empty}>Nothing logged yet.</Text>
      ) : (
        <>
          <TouchableOpacity style={styles.shareButton} onPress={onShare} activeOpacity={0.7}>
            <Text style={styles.shareButtonText}>Share Debug Log</Text>
          </TouchableOpacity>
          <ScrollView
            style={[styles.logBox, { height: logBoxHeight }]}
            nestedScrollEnabled
            showsVerticalScrollIndicator
          >
            {log.map((line, i) => (
              <Text key={i} style={styles.logLine}>
                {line}
              </Text>
            ))}
          </ScrollView>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    padding: 14,
  },
  empty: { color: colors.mutedFaint, fontSize: 12, fontStyle: 'italic', paddingVertical: 4 },
  shareButton: {
    backgroundColor: colors.info,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
    marginBottom: 10,
  },
  shareButtonText: { color: colors.text, fontSize: 13, fontWeight: '600' },
  logBox: {
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderRadius: 8,
    padding: 8,
  },
  logLine: { color: colors.mutedFaint, fontSize: 11, fontFamily: 'monospace', paddingVertical: 1 },
});
