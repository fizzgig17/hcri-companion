// src/components/FlickerPickerModal.tsx
//
// "Add saved flicker": pick one of the saved flicker samples to attach to a reading. Only flickers that are not
// already attached to a reading are offered (see storage/flickerHistory.ts's flickersForReading).

import React from 'react';
import { View, Text, TouchableOpacity, Modal, ScrollView, StyleSheet } from 'react-native';
import { useTheme } from '../contexts/ThemeContext';
import type { SavedFlicker } from '../storage/flickerHistory';
import { flickerSummary } from '../screens/tabs/FlickerHistoryTab';

interface Props {
  visible: boolean;
  /** The reading getting the flicker, for the heading. */
  readingLabel: string;
  flickers: SavedFlicker[];
  onPick: (f: SavedFlicker) => void;
  onCancel: () => void;
}

export default function FlickerPickerModal({ visible, readingLabel, flickers, onPick, onCancel }: Props) {
  const { colors } = useTheme();
  const styles = StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: '#000a', justifyContent: 'center', padding: 20 },
    card: { backgroundColor: colors.card, borderRadius: 14, padding: 16, maxHeight: '80%' },
    title: { color: colors.text, fontSize: 16, fontWeight: '700' },
    sub: { color: colors.muted, fontSize: 12, marginTop: 4, marginBottom: 10 },
    item: { borderWidth: 1, borderColor: colors.cardBorder, borderRadius: 10, padding: 10, marginBottom: 8 },
    itemLabel: { color: colors.text, fontSize: 14, fontWeight: '600' },
    itemMeta: { color: colors.muted, fontSize: 12, marginTop: 2 },
    empty: { color: colors.muted, fontSize: 13, paddingVertical: 14 },
    cancel: { alignSelf: 'flex-end', paddingVertical: 8, paddingHorizontal: 14, marginTop: 6 },
    cancelText: { color: colors.accent, fontWeight: '700', fontSize: 15 },
  });
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>Add a saved flicker</Text>
          <Text style={styles.sub} numberOfLines={2}>To {readingLabel}. Only flickers not yet attached to a reading are listed.</Text>
          <ScrollView>
            {flickers.length === 0 ? (
              <Text style={styles.empty}>No saved flickers are free to attach.</Text>
            ) : (
              flickers.map((f) => (
                <TouchableOpacity key={f.id} style={styles.item} onPress={() => onPick(f)} accessibilityRole="button" accessibilityLabel={`Attach ${f.label}`}>
                  <Text style={styles.itemLabel} numberOfLines={2}>{f.label}</Text>
                  <Text style={styles.itemMeta}>{new Date(f.savedAt).toLocaleString()} · {flickerSummary(f)}</Text>
                </TouchableOpacity>
              ))
            )}
          </ScrollView>
          <TouchableOpacity style={styles.cancel} onPress={onCancel}><Text style={styles.cancelText}>Cancel</Text></TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}
