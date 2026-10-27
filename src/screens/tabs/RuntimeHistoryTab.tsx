// src/screens/tabs/RuntimeHistoryTab.tsx
//
// History's "Runtime" list: output-over-time runs recorded with a TKLamp tester (see storage/runtimeHistory.ts).
// Each row shows the run's name, length, starting and ending lumens and how much output is left, with a small chart;
// tap the name to rename, and use Upload to send it to your Runtime list on hCRI.io (same name replaces an earlier one).

import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Modal, ActivityIndicator, StyleSheet } from 'react-native';
import Svg, { Polyline } from 'react-native-svg';
import { useTheme } from '../../contexts/ThemeContext';
import { Icon, ICON_SIZE } from '../../components/icons';
import HintPressable from '../../components/HintPressable';
import type { SavedRuntime } from '../../storage/runtimeHistory';

interface Props {
  runs: SavedRuntime[];
  loading: boolean;
  uploadingId: string | null;
  onRename: (id: string, label: string) => void;
  onDelete: (id: string) => void;
  onUpload: (r: SavedRuntime) => void;
}

function fmtDur(s: number): string {
  const m = Math.floor(s / 60);
  const r = Math.round(s % 60);
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m}:${String(r).padStart(2, '0')}`;
}

export const runtimeSummary = (r: SavedRuntime): string => {
  const first = r.values[0] ?? 0;
  const last = r.values[r.values.length - 1] ?? 0;
  const pct = first > 0 ? Math.round((last / first) * 100) : 0;
  return `${fmtDur((r.values.length - 1) * r.intervalSeconds)} · ${Math.round(first)} → ${Math.round(last)} lm (${pct}%)`;
};

const W = 280;
const H = 44;
function spark(values: number[]): string {
  if (values.length < 2) return '';
  const step = Math.max(1, Math.floor(values.length / 140));
  const v = values.filter((_, i) => i % step === 0);
  const lo = Math.min(...v);
  const hi = Math.max(...v);
  const span = hi - lo || 1;
  return v.map((x, i) => `${((i / (v.length - 1)) * (W - 4) + 2).toFixed(1)},${(H - 3 - ((x - lo) / span) * (H - 6)).toFixed(1)}`).join(' ');
}

export default function RuntimeHistoryTab({ runs, loading, uploadingId, onRename, onDelete, onUpload }: Props) {
  const { colors } = useTheme();
  const [editing, setEditing] = useState<SavedRuntime | null>(null);
  const [draft, setDraft] = useState('');

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
  if (!runs.length) {
    return <Text style={styles.empty}>No recorded runs yet.{'\n'}Connect a TKLamp tester through the bridge and tap Record run on the Main tab.</Text>;
  }

  return (
    <View>
      {runs.map((r) => (
        <View key={r.id} style={styles.row}>
          <View style={styles.top}>
            <Text style={styles.meta}>{new Date(r.savedAt).toLocaleString()}</Text>
            <View style={styles.buttons}>
              {uploadingId === r.id ? (
                <ActivityIndicator color={colors.muted} />
              ) : (
                <HintPressable hint="Upload to Runtime on hCRI.io" onPress={() => onUpload(r)} style={{ marginRight: 14 }} accessibilityRole="button" accessibilityLabel="Upload run to hCRI.io" hitSlop={{ top: 10, bottom: 10, left: 7, right: 7 }}>
                  <Icon name="upload" color={colors.accent} size={ICON_SIZE.row} />
                </HintPressable>
              )}
              <HintPressable hint="Delete this run" onPress={() => onDelete(r.id)} accessibilityRole="button" accessibilityLabel="Delete run" hitSlop={{ top: 10, bottom: 10, left: 7, right: 7 }}>
                <Icon name="trash" color={colors.danger} size={ICON_SIZE.row} />
              </HintPressable>
            </View>
          </View>
          <TouchableOpacity onPress={() => { setEditing(r); setDraft(r.label); }} accessibilityRole="button" accessibilityLabel="Rename run">
            <Text style={styles.label} numberOfLines={2}>{r.label}</Text>
          </TouchableOpacity>
          <Text style={styles.stats}>{runtimeSummary(r)}</Text>
          <Svg width={W} height={H} style={{ marginTop: 6 }}>
            <Polyline points={spark(r.values)} fill="none" stroke={colors.accent} strokeWidth={2} />
          </Svg>
          <View style={[styles.badge, { borderColor: r.uploaded ? colors.accent : colors.cardBorder }]}>
            <Text style={[styles.badgeText, { color: r.uploaded ? colors.accent : colors.muted }]}>{r.uploaded ? 'Uploaded' : 'On this phone'}</Text>
          </View>
        </View>
      ))}

      <Modal visible={!!editing} transparent animationType="fade" onRequestClose={() => setEditing(null)}>
        <View style={styles.backdrop}>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Run name</Text>
            <TextInput style={styles.input} value={draft} onChangeText={setDraft} autoCapitalize="none" autoCorrect={false} maxLength={160} autoFocus />
            <View style={styles.modalRow}>
              <TouchableOpacity style={styles.modalBtn} onPress={() => setEditing(null)}><Text style={styles.modalBtnText}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity
                style={styles.modalBtn}
                onPress={() => {
                  if (editing && draft.trim()) onRename(editing.id, draft.trim());
                  setEditing(null);
                }}
              >
                <Text style={styles.modalBtnText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}
