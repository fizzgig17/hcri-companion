// src/screens/tabs/FlickerHistoryTab.tsx
//
// History's "Flicker" list: standalone flicker samples saved from the Flicker page (see storage/flickerHistory.ts).
// A badge on each row says whether it belongs to a report ("In report"), is attached to a reading that hasn't been
// uploaded yet ("In reading"), or was sent to hCRI.io on its own ("Uploaded"). Flickers that go with a reading are
// not listed here; they show on the reading itself.

import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Modal, ActivityIndicator, StyleSheet, useWindowDimensions } from 'react-native';
import { useTheme } from '../../contexts/ThemeContext';
import { Icon, ICON_SIZE } from '../../components/icons';
import HintPressable from '../../components/HintPressable';
import FlickerChart from '../../components/FlickerChart';
import { SavedFlicker, flickerAssociation, attachedReading } from '../../storage/flickerHistory';
import type { SavedReading } from '../../storage/readingHistory';

interface Props {
  flickers: SavedFlicker[];
  /** The saved readings, to tell which flickers are attached to a reading and whether that reading is in a report. */
  readings: SavedReading[];
  loading: boolean;
  uploadingId: string | null;
  onRename: (id: string, label: string) => void;
  onDelete: (id: string) => void;
  onUpload: (f: SavedFlicker) => void;
}

export const flickerSummary = (f: SavedFlicker): string =>
  `${f.flicker.frequencyHz.toFixed(f.flicker.frequencyHz >= 100 ? 0 : 1)} Hz · ${f.flicker.percentFlicker.toFixed(0)}% · FI ${f.flicker.flickerIndex.toFixed(2)}`;

export default function FlickerHistoryTab({ flickers, readings, loading, uploadingId, onRename, onDelete, onUpload }: Props) {
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const [editing, setEditing] = useState<SavedFlicker | null>(null);
  const [draft, setDraft] = useState('');
  const [viewing, setViewing] = useState<SavedFlicker | null>(null);

  const styles = StyleSheet.create({
    empty: { color: colors.muted, fontSize: 13, textAlign: 'center', paddingVertical: 28, lineHeight: 19 },
    row: { backgroundColor: colors.card, borderColor: colors.cardBorder, borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 10 },
    top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    meta: { color: colors.muted, fontSize: 12, flexShrink: 1 },
    label: { color: colors.text, fontSize: 15, fontWeight: '600', marginTop: 6 },
    stats: { color: colors.muted, fontSize: 13, marginTop: 2 },
    buttons: { flexDirection: 'row', alignItems: 'center' },
    badge: { alignSelf: 'flex-start', marginTop: 8, borderRadius: 10, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 2 },
    badgeText: { fontSize: 11, fontWeight: '600' },
    backdrop: { flex: 1, backgroundColor: '#000a', justifyContent: 'center', padding: 20 },
    card: { backgroundColor: colors.card, borderRadius: 14, padding: 16 },
    cardTitle: { color: colors.text, fontSize: 16, fontWeight: '700', marginBottom: 10 },
    input: { borderWidth: 1, borderColor: colors.cardBorder, borderRadius: 8, color: colors.text, padding: 10, fontSize: 15 },
    modalRow: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 14 },
    modalBtn: { paddingVertical: 8, paddingHorizontal: 14 },
    modalBtnText: { color: colors.accent, fontWeight: '700', fontSize: 15 },
  });

  if (loading) return <ActivityIndicator color={colors.muted} style={{ marginVertical: 24 }} />;
  if (!flickers.length) {
    return <Text style={styles.empty}>No saved flicker samples yet.{'\n'}A “New sample” on the Flicker page is saved here when it ends.</Text>;
  }

  const badge = (f: SavedFlicker) => {
    const a = flickerAssociation(f, readings);
    if (a === 'none') return null;
    const r = attachedReading(f, readings);
    const text = a === 'report' ? 'In report' : a === 'reading' ? `In reading${r ? ` · ${r.label}` : ''}` : 'Uploaded to hCRI.io';
    const color = a === 'report' ? colors.accent : colors.muted;
    return (
      <View style={[styles.badge, { borderColor: color }]}>
        <Text style={[styles.badgeText, { color }]} numberOfLines={1}>{text}</Text>
      </View>
    );
  };

  return (
    <View>
      {flickers.map((f) => {
        const a = flickerAssociation(f, readings);
        const uploading = uploadingId === f.id;
        return (
          <View key={f.id} style={styles.row}>
            <View style={styles.top}>
              <Text style={styles.meta}>{new Date(f.savedAt).toLocaleString()}{f.model ? ` · ${f.model}` : ''}</Text>
              <View style={styles.buttons}>
                {a === 'none' && (
                  <HintPressable hint="Upload to hCRI.io" onPress={() => onUpload(f)} disabled={uploading} style={{ marginRight: 14, opacity: uploading ? 0.6 : 1 }} accessibilityRole="button" accessibilityLabel="Upload flicker" hitSlop={{ top: 10, bottom: 10, left: 7, right: 7 }}>
                    {uploading ? <ActivityIndicator size="small" color={colors.accent} /> : <Icon name="upload" color={colors.accent} size={ICON_SIZE.row} />}
                  </HintPressable>
                )}
                <HintPressable hint="View flicker" onPress={() => setViewing(f)} style={{ marginRight: 14 }} accessibilityRole="button" accessibilityLabel="View flicker" hitSlop={{ top: 10, bottom: 10, left: 7, right: 7 }}>
                  <Icon name="eye" color={colors.info} size={ICON_SIZE.row} />
                </HintPressable>
                <HintPressable hint="Delete flicker" onPress={() => onDelete(f.id)} accessibilityRole="button" accessibilityLabel="Delete flicker" hitSlop={{ top: 10, bottom: 10, left: 7, right: 7 }}>
                  <Icon name="trash" color={colors.danger} size={ICON_SIZE.row} />
                </HintPressable>
              </View>
            </View>
            <TouchableOpacity onPress={() => { setDraft(f.label); setEditing(f); }} activeOpacity={0.7} accessibilityRole="button" accessibilityLabel={`Rename ${f.label}`}>
              <Text style={styles.label} numberOfLines={2}>{f.label}</Text>
            </TouchableOpacity>
            <Text style={styles.stats}>{flickerSummary(f)}</Text>
            {badge(f)}
          </View>
        );
      })}

      <Modal visible={!!editing} transparent animationType="fade" onRequestClose={() => setEditing(null)}>
        <View style={styles.backdrop}>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Rename flicker</Text>
            <TextInput style={styles.input} value={draft} onChangeText={setDraft} autoFocus selectTextOnFocus maxLength={120} />
            <View style={styles.modalRow}>
              <TouchableOpacity style={styles.modalBtn} onPress={() => setEditing(null)}><Text style={[styles.modalBtnText, { color: colors.muted }]}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity style={styles.modalBtn} onPress={() => { if (editing && draft.trim()) onRename(editing.id, draft.trim()); setEditing(null); }}><Text style={styles.modalBtnText}>Save</Text></TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={!!viewing} transparent animationType="fade" onRequestClose={() => setViewing(null)}>
        <View style={styles.backdrop}>
          <View style={styles.card}>
            <Text style={styles.cardTitle} numberOfLines={2}>{viewing?.label}</Text>
            {viewing && <FlickerChart reading={viewing.flicker} running={false} history={[]} width={Math.max(220, width - 40 - 32)} height={260} />}
            <View style={styles.modalRow}>
              <TouchableOpacity style={styles.modalBtn} onPress={() => setViewing(null)}><Text style={styles.modalBtnText}>Close</Text></TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}
