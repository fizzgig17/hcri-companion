// src/screens/tabs/LogsTab.tsx
//
// The "Logs" tab: the running debug log (including raw hex dumps from
// takeMeasurement.ts) and the Share Debug Log button.
//
// This tab is rendered by HomeScreen as a flex:1 SIBLING of the outer
// ScrollView that Main/Data share, not INSIDE it (see HomeScreen.tsx's
// activeTab==='logs' branch) -- the whole point being that nothing here
// scrolls except the log box itself. An earlier version lived inside that
// outer ScrollView with its own nested, fixed-height ScrollView for the
// log; nestedScrollEnabled lets a nested ScrollView scroll on its own, but
// once it hits ITS bottom the drag gesture hands off to the outer one,
// dragging this tab's own Share/Clear buttons (and the docked tab bar
// above everything) up off-screen along with it -- which is exactly the
// "pushes the buttons at the top up off the screen" bug. With nothing
// above this component able to scroll at all, that hand-off has nowhere
// to go.
//
// Jump-to-top/middle/bottom buttons exist because these logs are a wall
// of fixed-width hex dumps (takeMeasurement.ts) that can run to the
// in-memory cap (100 lines, see HomeScreen's appendLog) -- dragging
// through all of that by hand to compare "what happened right at the
// start" against "what happened right before it failed" is slow.

import React, { useRef, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, Alert, LayoutChangeEvent } from 'react-native';
import { useTheme } from '../../contexts/ThemeContext';

interface Props {
  log: string[];
  onShare: () => void;
  /** Empties the in-memory log shown here -- NOT persisted anywhere, so this is irreversible for this run of the app (see HomeScreen's clearLog). Confirmed before calling, same as History's bulk delete, since there's no undo. */
  onClear: () => void;
}

export default function LogsTab({ log, onShare, onClear }: Props) {
  const { colors } = useTheme();

  const confirmClear = () => {
    Alert.alert('Clear debug log?', 'This clears what\'s shown here. It does not affect anything already shared or uploaded.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear', style: 'destructive', onPress: onClear },
    ]);
  };

  const scrollRef = useRef<ScrollView>(null);
  // Tracked purely to compute "the middle" -- content height from the log
  // box's own onContentSizeChange, viewport height from its onLayout. Both
  // start at 0 (nothing scrolls anywhere until real measurements come in,
  // which is fine -- jumpToMiddle() below guards against a 0 viewport).
  const [contentHeight, setContentHeight] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);

  const jumpToTop = () => scrollRef.current?.scrollTo({ y: 0, animated: true });
  const jumpToBottom = () => scrollRef.current?.scrollToEnd({ animated: true });
  const jumpToMiddle = () => {
    const target = Math.max((contentHeight - viewportHeight) / 2, 0);
    scrollRef.current?.scrollTo({ y: target, animated: true });
  };

  const styles = StyleSheet.create({
    card: {
      flex: 1,
      backgroundColor: colors.card,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      padding: 14,
    },
    empty: { color: colors.mutedFaint, fontSize: 12, fontStyle: 'italic', paddingVertical: 4 },
    buttonRow: { flexDirection: 'row', marginHorizontal: -4, marginBottom: 8 },
    rowButton: { flex: 1, marginHorizontal: 4 },
    shareButton: {
      backgroundColor: colors.info,
      borderRadius: 8,
      paddingVertical: 10,
      alignItems: 'center',
    },
    shareButtonText: { color: colors.text, fontSize: 13, fontWeight: '600' },
    clearButton: {
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.danger,
      borderRadius: 8,
      paddingVertical: 10,
      alignItems: 'center',
    },
    clearButtonText: { color: colors.danger, fontSize: 13, fontWeight: '600' },
    // Smaller/quieter than the Share/Clear row above -- these are
    // navigation shortcuts for the log already on screen, not actions
    // that do anything, so they shouldn't compete for attention.
    jumpRow: { flexDirection: 'row', marginHorizontal: -4, marginBottom: 10 },
    jumpButton: {
      flex: 1,
      marginHorizontal: 4,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      borderRadius: 8,
      paddingVertical: 6,
      alignItems: 'center',
    },
    jumpButtonText: { color: colors.muted, fontSize: 12, fontWeight: '600' },
    logBox: {
      flex: 1,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      borderRadius: 8,
      padding: 8,
    },
    logLine: { color: colors.mutedFaint, fontSize: 11, fontFamily: 'monospace', paddingVertical: 1 },
  });

  return (
    <View style={styles.card}>
      {log.length === 0 ? (
        <Text style={styles.empty}>Nothing logged yet.</Text>
      ) : (
        <>
          <View style={styles.buttonRow}>
            <TouchableOpacity style={[styles.shareButton, styles.rowButton]} onPress={onShare} activeOpacity={0.7}>
              <Text style={styles.shareButtonText}>Share Debug Log</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.clearButton, styles.rowButton]} onPress={confirmClear} activeOpacity={0.7}>
              <Text style={styles.clearButtonText}>Clear Log</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.jumpRow}>
            <TouchableOpacity style={styles.jumpButton} onPress={jumpToTop} activeOpacity={0.7}>
              <Text style={styles.jumpButtonText}>⤒ Top</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.jumpButton} onPress={jumpToMiddle} activeOpacity={0.7}>
              <Text style={styles.jumpButtonText}>Middle</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.jumpButton} onPress={jumpToBottom} activeOpacity={0.7}>
              <Text style={styles.jumpButtonText}>⤓ Bottom</Text>
            </TouchableOpacity>
          </View>
          <ScrollView
            ref={scrollRef}
            style={styles.logBox}
            showsVerticalScrollIndicator
            onLayout={(e: LayoutChangeEvent) => setViewportHeight(e.nativeEvent.layout.height)}
            onContentSizeChange={(_w, h) => setContentHeight(h)}
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
