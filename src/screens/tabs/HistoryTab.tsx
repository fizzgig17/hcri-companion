// src/screens/tabs/HistoryTab.tsx
//
// Every completed measurement, most-recent first (see
// ../../storage/readingHistory.ts -- persisted locally, survives app
// restarts). Each row's label is editable in place -- committed on blur --
// and can be uploaded to hCRI.io or shared as CSV independently of
// whatever the "current"/latest reading on Main/Data happens to be right
// now. Uploading uses whatever label is currently in the field (even if
// you haven't tapped away yet), and that edited label gets saved back into
// history at the same time -- so renaming-then-uploading and just renaming
// end up doing the same underlying rename either way.
//
// "Select" mode (below) is for bulk-uploading several readings at once.
// It deliberately does NOT touch any row's editable label field itself --
// every reading already gets a label the moment it's saved (a plain
// date/time string by default, see HomeScreen's measure()), so there's
// always something to upload it under. If you want a more meaningful title
// than the auto-generated one, rename the row first (same inline field,
// same as always) and THEN check it off -- bulk upload sends each
// selected reading's already-committed label, not whatever's sitting
// unsaved in a field you haven't blurred yet.

import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import PrimaryButton from '../../components/PrimaryButton';
import { colors } from '../../theme';
import { SavedReading } from '../../storage/readingHistory';

interface Props {
  history: SavedReading[];
  loading: boolean;
  /** Persists a rename by itself (e.g. on blur, no upload involved). */
  onRename: (id: string, label: string) => void;
  /** Renames (if changed) AND uploads, in that order -- see the file-level comment above. */
  onUploadWithLabel: (id: string, label: string) => void;
  /** Uploads several readings at once, each under its own already-saved label. */
  onUploadMany: (ids: string[]) => void;
  onDelete: (id: string) => void;
  onShareOne: (reading: SavedReading) => void;
  onShareAll: () => void;
  /** Which reading (if any) is currently mid-upload, so only ITS button shows a spinner/disables -- the others stay usable. Also used to show progress during a bulk upload, since that walks this same id through the list one at a time. */
  uploadingId: string | null;
  /** True while a bulk upload (onUploadMany) is in progress -- distinct from uploadingId being set for a single-row upload, so Select mode can be locked while it runs without also disabling the single-row buttons on every other screen. */
  bulkUploading: boolean;
}

function formatSavedAt(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleString();
}

function HistoryRow({
  reading,
  uploading,
  onRename,
  onUploadWithLabel,
  onDelete,
  onShareOne,
  selectMode,
  selected,
  onToggleSelected,
}: {
  reading: SavedReading;
  uploading: boolean;
  onRename: (id: string, label: string) => void;
  onUploadWithLabel: (id: string, label: string) => void;
  onDelete: (id: string) => void;
  onShareOne: (reading: SavedReading) => void;
  selectMode: boolean;
  selected: boolean;
  onToggleSelected: (id: string) => void;
}) {
  const [text, setText] = useState(reading.label);

  // Keep the field in sync if this reading's label changes from elsewhere
  // (e.g. a rename that came from the upload flow itself) -- without this,
  // an upload-triggered rename would silently desync the field from what's
  // actually saved until the next full history reload.
  useEffect(() => {
    setText(reading.label);
  }, [reading.label]);

  const commitRename = () => {
    const trimmed = text.trim();
    if (!trimmed) {
      setText(reading.label); // don't allow blanking a saved reading's name out
      return;
    }
    if (trimmed !== reading.label) {
      onRename(reading.id, trimmed);
    }
  };

  const rowInner = (
    <>
      <View style={styles.rowHeader}>
        <Text style={styles.rowMeta}>{formatSavedAt(reading.savedAt)}</Text>
        {!selectMode && (
          <TouchableOpacity onPress={() => onDelete(reading.id)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={styles.deleteText}>Delete</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* multiline so a long label (now username + date + time + timezone +
          device by default, not just a bare timestamp) actually wraps into
          view instead of being clipped off the edge of a single-line
          field -- same reasoning as the Upload Title field on Data tab. */}
      <TextInput
        style={styles.labelInput}
        value={text}
        onChangeText={setText}
        onBlur={commitRename}
        editable={!selectMode}
        autoCapitalize="none"
        autoCorrect={false}
        multiline
        textAlignVertical="top"
      />

      {/* Raw device-reported CCT/Ra, not the spectrum-derived (analyzeSpectrum)
          numbers Main/Spectrum/Data show -- same distinction Lux already has
          elsewhere in this app. Good enough for a quick "which reading was
          this" glance across a long list; re-running the full analysis for
          every row just to populate this summary isn't worth the cost. */}
      <Text style={styles.rowSummary}>
        {reading.result.cct.toFixed(0)}K · Ra {reading.result.ra.toFixed(1)}
      </Text>

      {!selectMode && (
        <View style={styles.rowActions}>
          <TouchableOpacity
            style={[styles.actionButton, uploading && styles.actionButtonDisabled]}
            onPress={() => onUploadWithLabel(reading.id, text.trim() || reading.label)}
            disabled={uploading}
          >
            {uploading ? (
              <ActivityIndicator size="small" color={colors.text} />
            ) : (
              <Text style={styles.actionButtonText}>Upload</Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionButton} onPress={() => onShareOne(reading)}>
            <Text style={styles.actionButtonText}>Share CSV</Text>
          </TouchableOpacity>
        </View>
      )}
    </>
  );

  if (!selectMode) {
    return <View style={styles.row}>{rowInner}</View>;
  }

  // In Select mode the whole row becomes one big tap target for toggling
  // its checkbox -- easier to hit than a small checkbox alone when you're
  // checking off a long list, and it's what the spinner (during a bulk
  // upload, driven by the same uploadingId that single-row uploads use)
  // replaces to show which one is currently being sent.
  return (
    <TouchableOpacity
      style={[styles.row, styles.rowSelectable, selected && styles.rowSelected]}
      onPress={() => onToggleSelected(reading.id)}
      activeOpacity={0.7}
    >
      <View style={styles.selectRow}>
        <View style={styles.checkboxCol}>
          {uploading ? (
            <ActivityIndicator size="small" color={colors.text} />
          ) : (
            <View style={[styles.checkbox, selected && styles.checkboxChecked]}>
              {selected && <Text style={styles.checkboxMark}>✓</Text>}
            </View>
          )}
        </View>
        <View style={styles.selectRowBody}>{rowInner}</View>
      </View>
    </TouchableOpacity>
  );
}

export default function HistoryTab({
  history,
  loading,
  onRename,
  onUploadWithLabel,
  onUploadMany,
  onDelete,
  onShareOne,
  onShareAll,
  uploadingId,
  bulkUploading,
}: Props) {
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Dropping out of Select mode (Cancel, or after a bulk upload finishes)
  // always clears the selection too -- re-entering Select mode should
  // start from nothing rather than silently remembering last time's picks.
  const exitSelectMode = () => {
    setSelectMode(false);
    setSelected(new Set());
  };

  const toggleSelected = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const selectAll = () => setSelected(new Set(history.map((r) => r.id)));

  const handleUploadSelected = () => {
    if (selected.size === 0) return;
    // Upload in the same most-recent-first order the list is already shown
    // in, not insertion/selection order -- so "upload selected" behaves
    // predictably regardless of the order you happened to tap things in.
    const ids = history.filter((r) => selected.has(r.id)).map((r) => r.id);
    onUploadMany(ids);
  };

  if (loading) {
    return (
      <View style={styles.empty}>
        <ActivityIndicator size="small" color={colors.muted} />
      </View>
    );
  }

  if (history.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>
          No saved readings yet -- every completed measurement gets added here automatically.
        </Text>
      </View>
    );
  }

  return (
    <View>
      <View style={styles.headerRow}>
        <Text style={styles.headerTitle}>
          {selectMode
            ? `${selected.size} of ${history.length} selected`
            : `${history.length} saved reading${history.length === 1 ? '' : 's'}`}
        </Text>
        <View style={styles.headerButtons}>
          {selectMode ? (
            <TouchableOpacity onPress={exitSelectMode} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
          ) : (
            <>
              <TouchableOpacity onPress={() => setSelectMode(true)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Text style={styles.selectText}>Select</Text>
              </TouchableOpacity>
              <PrimaryButton title="Share All as CSV" onPress={onShareAll} variant="muted" />
            </>
          )}
        </View>
      </View>

      {selectMode && (
        <View style={styles.selectBar}>
          <TouchableOpacity onPress={selectAll} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={styles.selectAllText}>Select All</Text>
          </TouchableOpacity>
          <PrimaryButton
            title={bulkUploading ? 'Uploading…' : `Upload ${selected.size || ''} Selected`.trim()}
            onPress={handleUploadSelected}
            disabled={selected.size === 0 || bulkUploading}
            style={styles.selectBarUploadButton}
          />
        </View>
      )}

      {history.map((r) => (
        <HistoryRow
          key={r.id}
          reading={r}
          uploading={uploadingId === r.id}
          onRename={onRename}
          onUploadWithLabel={onUploadWithLabel}
          onDelete={onDelete}
          onShareOne={onShareOne}
          selectMode={selectMode}
          selected={selected.has(r.id)}
          onToggleSelected={toggleSelected}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { paddingVertical: 40, alignItems: 'center' },
  emptyText: { color: colors.muted, fontSize: 13, textAlign: 'center', paddingHorizontal: 20 },

  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 8 },
  headerTitle: { color: colors.muted, fontSize: 12, marginBottom: 4, flexShrink: 1 },
  headerButtons: { flexDirection: 'row', alignItems: 'center' },
  selectText: { color: colors.accent, fontSize: 13, fontWeight: '600', marginRight: 16, marginBottom: 4 },
  cancelText: { color: colors.muted, fontSize: 13, fontWeight: '600', marginBottom: 4 },

  selectBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 10,
  },
  selectAllText: { color: colors.accent, fontSize: 13, fontWeight: '600' },
  // Overrides PrimaryButton's default marginTop:8 (meant for a full-width
  // button stacked below other content) -- here it sits inline next to
  // "Select All" text, so that top margin would push it visibly lower than
  // its sibling instead of centering with it.
  selectBarUploadButton: { marginTop: 0 },

  row: {
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    padding: 12,
    marginBottom: 10,
  },
  rowSelectable: { paddingVertical: 12 },
  rowSelected: { borderColor: colors.accent },
  selectRow: { flexDirection: 'row', alignItems: 'flex-start' },
  checkboxCol: { width: 30, alignItems: 'center', justifyContent: 'center', paddingTop: 2 },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: colors.cardBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: { backgroundColor: colors.accent, borderColor: colors.accent },
  checkboxMark: { color: colors.text, fontSize: 13, fontWeight: '700' },
  selectRowBody: { flex: 1 },
  rowHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  rowMeta: { color: colors.muted, fontSize: 11, fontFamily: 'monospace' },
  deleteText: { color: colors.danger, fontSize: 12 },

  labelInput: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    color: colors.text,
    fontSize: 13,
    minHeight: 38,
    marginBottom: 6,
  },
  rowSummary: { color: colors.text, fontSize: 12, marginBottom: 10 },

  rowActions: { flexDirection: 'row', marginHorizontal: -4 },
  actionButton: {
    flex: 1,
    marginHorizontal: 4,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  actionButtonDisabled: { opacity: 0.6 },
  actionButtonText: { color: colors.text, fontSize: 13, fontWeight: '600' },
});
