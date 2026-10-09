// src/screens/tabs/HistoryTab.tsx
//
// Every completed measurement, most-recent first (see
// ../../storage/readingHistory.ts -- persisted locally, survives app
// restarts). Each row's label is editable by tapping it (popup editor, same as Main's upload title)
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

import React, { useMemo, useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, Modal } from 'react-native';
import Svg, { Polyline, Path } from 'react-native-svg';
import CollapsibleSection from '../../components/CollapsibleSection';
import { useTheme } from '../../contexts/ThemeContext';
import { SavedReading } from '../../storage/readingHistory';

const ICON_CLOUD = 'M16 16l-4-4-4 4M12 12v9M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3';
const ICON_TRASH = 'M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6';
const ICON_X = 'M18 6L6 18M6 6l12 12';
const ICON_CHECK = 'M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11';
const ICON_EYE = 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z';
const ICON_TRAY = 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12';
function ActionIcon({ d, color, size = 22 }: { d: string; color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d={d} />
    </Svg>
  );
}
import { analyzeSpectrum } from '../../utils/spectralAnalysis';

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
  /** Deletes several (or, via Select All, every) reading at once -- see readingHistory.ts's deleteManyReadings. May be awaited (HomeScreen's version is async) so this tab can show "Deleting..." until the storage write actually finishes. */
  onDeleteMany: (ids: string[]) => void | Promise<void>;
  onShareOne: (reading: SavedReading) => void;
  onShareAll: () => void;
  /** Shares just the checked readings (Select mode) as one CSV -- or as a single reading's own CSV when only one is checked. */
  onShareMany: (ids: string[]) => void;
  /** Opens ReadingDetailScreen for one saved reading -- the same measurement grid and Spectrum/Chrom/R-Values pages the Main/Spectrum tabs show for the current reading, just fed this past one instead (see ReadingDetailScreen.tsx). */
  onOpen: (reading: SavedReading) => void;
  /** Which reading (if any) is currently mid-upload, so only ITS button shows a spinner/disables -- the others stay usable. Also used to show progress during a bulk upload, since that walks this same id through the list one at a time. */
  uploadingId: string | null;
  /** True while a bulk upload (onUploadMany) is in progress -- distinct from uploadingId being set for a single-row upload, so Select mode can be locked while it runs without also disabling the single-row buttons on every other screen. */
  bulkUploading: boolean;
  /** Resolves a reading's stored report link and copies it to the clipboard -- same Copy Link affordance Main/Data show, just for a reading that may have been uploaded a while ago (see readingHistory.ts's reportId/reportIsPublic and HistoryScreen.tsx's copyReportLinkFromHistory). Only ever called for a row that actually has a reportId -- see the pill's own guard below. */
  onCopyLink: (reading: SavedReading) => void;
  /** Which reading's link request (Copy / Report / TM-30 -- they share one in-flight flag) is in flight, if any -- same single-at-a-time pattern as uploadingId. */
  copyingLinkId: string | null;
  /** Opens the uploaded report on hCRI.io in the browser; `tm30` opens it with the TM-30 report showing. Same guard as onCopyLink: only called for a row that has a reportId. */
  onOpenReport: (reading: SavedReading, tm30: boolean) => void;
  /** Opens the in-app TM-30 report, generated on the phone from the stored spectrum (works for readings that were never uploaded). */
  onOpenTm30: (reading: SavedReading) => void;
}

function formatSavedAt(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleString();
}

/** Midnight (local time) of the day `ms` falls on -- used as the grouping
 * key so two readings taken on the same calendar day always land in the
 * same group regardless of what time of day each one happened. */
function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** "Yesterday", or the weekday+date for anything older -- `dayStart` is
 * already a startOfDay() value, same as `todayStart`, so this is just
 * counting whole days between them rather than reasoning about times. */
function dateGroupLabel(dayStart: number, todayStart: number): string {
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;
  const diffDays = Math.round((todayStart - dayStart) / ONE_DAY_MS);
  if (diffDays === 1) return 'Yesterday';
  return new Date(dayStart).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function HistoryRow({
  reading,
  uploading,
  onRename,
  onUploadWithLabel,
  onDelete,
  onShareOne,
  onOpen,
  selectMode,
  selected,
  onToggleSelected,
  onCopyLink,
  copyingLink,
  onOpenReport,
  onOpenTm30,
}: {
  reading: SavedReading;
  uploading: boolean;
  onRename: (id: string, label: string) => void;
  onUploadWithLabel: (id: string, label: string) => void;
  onDelete: (id: string) => void;
  onShareOne: (reading: SavedReading) => void;
  onOpen: (reading: SavedReading) => void;
  selectMode: boolean;
  selected: boolean;
  onToggleSelected: (id: string) => void;
  onCopyLink: (reading: SavedReading) => void;
  copyingLink: boolean;
  onOpenReport: (reading: SavedReading, tm30: boolean) => void;
  /** Opens the in-app TM-30 report, generated on the phone from the stored spectrum (works for readings that were never uploaded). */
  onOpenTm30: (reading: SavedReading) => void;
}) {
  const { colors } = useTheme();
  // Title editing works like the Main tab's: tap the title, edit it in a
  // popup (so the keyboard never covers it), Save commits the rename.
  const [modalVisible, setModalVisible] = useState(false);
  const [draft, setDraft] = useState(reading.label);
  const inputRef = useRef<any>(null);

  // Spectrum-derived CCT/Ra for the row summary below, same values
  // Main/Spectrum/Data show -- NOT the device-reported result.cct/result.ra
  // (see readingHistory.ts's SavedReading.analysis comment for why that
  // distinction matters: those depend on correctly guessing which offset
  // map the device that took this reading needed). Readings saved after
  // this field was added already have it computed once at save time,
  // for free; only a reading saved before then needs this fallback, and
  // even then only once per row thanks to the memo below, not on every
  // render of a long history list.
  const analysis = useMemo(
    () => reading.analysis ?? analyzeSpectrum(reading.result.spectrum),
    [reading.analysis, reading.result.spectrum]
  );

  // Guards against committing twice (the Save button and the keyboard's Done
  // key can both submit).
  const committedRef = useRef(false);

  const openEditor = () => {
    setDraft(reading.label);
    committedRef.current = false;
    setModalVisible(true);
  };

  const commitRename = () => {
    if (committedRef.current) return;
    committedRef.current = true;
    const trimmed = draft.trim();
    setModalVisible(false);
    if (!trimmed) return; // don't allow blanking a saved reading's name out
    if (trimmed !== reading.label) {
      onRename(reading.id, trimmed);
    }
  };

  const styles = StyleSheet.create({
    row: {
      backgroundColor: colors.card,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      padding: 10,
      marginBottom: 8,
    },
    rowSelectable: { paddingVertical: 10 },
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
    rowHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
    rowHeaderLeft: { flexDirection: 'row', alignItems: 'baseline', flexShrink: 1, flexWrap: 'wrap' },
    rowMeta: { color: colors.muted, fontSize: 11, fontFamily: 'monospace' },
    rowSummaryInline: { color: colors.text, fontSize: 11, fontWeight: '600', marginLeft: 8 },
    rowHeaderButtons: { flexDirection: 'row', alignItems: 'center' },
    viewText: { color: colors.info, fontSize: 12, fontWeight: '600', marginRight: 14 },
    deleteText: { color: colors.danger, fontSize: 12 },

    labelInput: {
      backgroundColor: colors.background,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      borderRadius: 8,
      paddingHorizontal: 10,
      paddingVertical: 6,
      color: colors.text,
      fontSize: 13,
      minHeight: 32,
      marginBottom: 6,
    },
    modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'flex-start', paddingTop: 70, paddingHorizontal: 24 },
    modalSheet: {
      width: '100%',
      maxWidth: 400,
      backgroundColor: colors.card,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      padding: 18,
    },
    modalTitle: { color: colors.text, fontSize: 16, fontWeight: '700', marginBottom: 14 },
    modalInput: {
      backgroundColor: colors.background,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      borderRadius: 8,
      color: colors.text,
      fontSize: 14,
      minHeight: 70,
      maxHeight: 120,
      paddingHorizontal: 10,
      paddingVertical: 8,
      textAlignVertical: 'top',
    },
    modalButtons: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', marginTop: 8 },
    modalCancel: { alignItems: 'center', paddingVertical: 12, marginTop: 6 },
    modalCancelText: { color: colors.muted, fontSize: 13, fontWeight: '600' },
    modalSave: { backgroundColor: colors.accent, borderRadius: 8, paddingVertical: 10, paddingHorizontal: 22, marginLeft: 8, marginTop: 6 },
    modalSaveText: { color: colors.text, fontSize: 14, fontWeight: '700' },

    rowActions: { flexDirection: 'row', marginHorizontal: -4 },
    actionButton: {
      flex: 1,
      marginHorizontal: 4,
      backgroundColor: colors.background,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      borderRadius: 8,
      paddingVertical: 4,
      alignItems: 'center',
    },
    actionButtonDisabled: { opacity: 0.6 },
    actionButtonText: { color: colors.text, fontSize: 10, fontWeight: '600', marginTop: 1 },

    // Same outlined-pill treatment as MainTab/DataTab's Copy Link button --
    // kept as its own small pill rather than folded into actionButton's
    // style so it visually reads as "link to something already out there"
    // rather than another same-weight action on this reading.
    copyLinkPill: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: colors.accent,
      borderRadius: 8,
      paddingVertical: 7,
      marginTop: 6,
    },
    linkRow: { flexDirection: 'row', marginHorizontal: -3 },
    linkPill: { flex: 1, marginHorizontal: 3 },
    copyLinkIcon: { fontSize: 13, marginRight: 6 },
    copyLinkSpinner: { marginRight: 6 },
    copyLinkLabel: { color: colors.accent, fontSize: 12, fontWeight: '700' },
  });

  const rowInner = (
    <>
      <View style={styles.rowHeader}>
        <View style={styles.rowHeaderLeft}>
          <Text style={styles.rowMeta}>{formatSavedAt(reading.savedAt)}</Text>
          {/* Spectrum-derived CCT/Ra (see the `analysis` memo above) --
              matches what Main/Spectrum/Data show for this same reading,
              and doesn't depend on the device's own metrics-block offsets
              being right for whatever model/firmware took it. Right next
              to the date/time rather than its own line below the label
              field -- that extra line was most of why these rows felt so
              tall. Lux is the one number on this app that's still
              genuinely device-reported elsewhere (no spectral equivalent
              exists to compute it from), which is why only CCT/Ra show up
              in this summary. */}
          <Text style={styles.rowSummaryInline}>
            {analysis.cct.toFixed(0)}K · Ra {Math.round(analysis.ra)}
          </Text>
          {!!reading.result.flicker && (
            <View style={{ marginLeft: 6 }} accessibilityLabel="Includes a flicker reading">
              <Svg width={16} height={12} viewBox="0 0 16 12">
                <Polyline points="0,9 3,9 3,2 7,2 7,9 11,9 11,2 15,2" fill="none" stroke={colors.accent} strokeWidth={1.6} strokeLinejoin="round" />
              </Svg>
            </View>
          )}
        </View>
        {!selectMode && (
          <View style={styles.rowHeaderButtons}>
            <TouchableOpacity onPress={() => onUploadWithLabel(reading.id, reading.label)} disabled={uploading} style={{ marginRight: 14, opacity: uploading ? 0.6 : 1 }} accessibilityRole="button" accessibilityLabel="Upload reading" hitSlop={{ top: 10, bottom: 10, left: 7, right: 7 }}>
              {uploading ? <ActivityIndicator size="small" color={colors.accent} /> : <ActionIcon d={ICON_CLOUD} color={colors.accent} size={19} />}
            </TouchableOpacity>
            <TouchableOpacity onPress={() => onShareOne(reading)} style={{ marginRight: 14 }} accessibilityRole="button" accessibilityLabel="Share CSV" hitSlop={{ top: 10, bottom: 10, left: 7, right: 7 }}>
              <ActionIcon d={ICON_TRAY} color={colors.text} size={19} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => onOpen(reading)} style={{ marginRight: 14 }} accessibilityRole="button" accessibilityLabel="View reading" hitSlop={{ top: 10, bottom: 10, left: 7, right: 7 }}>
              <ActionIcon d={ICON_EYE} color={colors.info} size={19} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => onDelete(reading.id)} accessibilityRole="button" accessibilityLabel="Delete reading" hitSlop={{ top: 10, bottom: 10, left: 7, right: 7 }}>
              <ActionIcon d={ICON_TRASH} color={colors.danger} size={19} />
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* Tap to edit in a popup, same as the Main tab's upload title. */}
      <TouchableOpacity
        style={styles.labelInput}
        onPress={openEditor}
        disabled={selectMode}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel="Reading title. Tap to edit."
      >
        <Text style={{ color: colors.text, fontSize: 13 }}>{reading.label}</Text>
      </TouchableOpacity>

      <Modal
        visible={modalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setModalVisible(false)}
        onShow={() => {
          setTimeout(() => inputRef.current?.focus(), 150);
        }}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>Reading title</Text>
            <TextInput
              ref={inputRef}
              style={styles.modalInput}
              value={draft}
              onChangeText={setDraft}
              multiline
              autoCapitalize="none"
              autoCorrect={false}
              submitBehavior="blurAndSubmit"
              returnKeyType="done"
              onSubmitEditing={commitRename}
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity style={styles.modalCancel} onPress={() => setModalVisible(false)}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalSave} onPress={commitRename}>
                <Text style={styles.modalSaveText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Copy / Report only exist once this reading has a stored report on
          hCRI.io (readingHistory.ts's reportId/reportIsPublic, set by whichever
          upload most recently succeeded for it). TM-30 is built on the phone
          from the stored spectrum, so it's there for every reading. */}
      {!selectMode && (
        <View style={styles.linkRow}>
          {typeof reading.reportId === 'number' && (
            <>
              <TouchableOpacity
                onPress={() => onCopyLink(reading)}
                disabled={copyingLink}
                style={[styles.copyLinkPill, styles.linkPill]}
              >
                {copyingLink ? (
                  <ActivityIndicator size="small" color={colors.accent} style={styles.copyLinkSpinner} />
                ) : (
                  <Text style={styles.copyLinkIcon}>🔗</Text>
                )}
                <Text style={styles.copyLinkLabel}>{copyingLink ? 'Working…' : 'Copy'}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => onOpenReport(reading, false)}
                disabled={copyingLink}
                style={[styles.copyLinkPill, styles.linkPill]}
              >
                <Text style={styles.copyLinkIcon}>↗</Text>
                <Text style={styles.copyLinkLabel}>Report</Text>
              </TouchableOpacity>
            </>
          )}
          <TouchableOpacity onPress={() => onOpenTm30(reading)} style={[styles.copyLinkPill, styles.linkPill]}>
            <Text style={styles.copyLinkIcon}>◐</Text>
            <Text style={styles.copyLinkLabel}>TM-30</Text>
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
  onDeleteMany,
  onShareOne,
  onShareAll,
  onShareMany,
  onOpen,
  uploadingId,
  bulkUploading,
  onCopyLink,
  copyingLinkId,
  onOpenReport,
  onOpenTm30,
}: Props) {
  const { colors } = useTheme();
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Local only -- onDeleteMany itself awaits nothing (HomeScreen's version
  // does the storage write and state update together), so this just drives
  // the button's "Deleting..." label/disabled state for the brief moment
  // the delete is in flight, same role bulkUploading plays for uploads.
  const [bulkDeleting, setBulkDeleting] = useState(false);

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

  // Split into today's readings (shown flat, same as always -- these are
  // the ones still actively being worked with this session) and every
  // other day's readings, bucketed into a collapsed-by-default section
  // per calendar day. `history` already arrives most-recent-first, so
  // walking it in order and only ever appending to the LAST day-bucket
  // seen keeps each bucket's own readings in that same order, and the
  // buckets themselves come out newest-first too (today's readings aside,
  // that starts with Yesterday) with no separate sort needed.
  const { todayReadings, pastGroups } = useMemo(() => {
    const todayStart = startOfDay(Date.now());
    const today: SavedReading[] = [];
    const order: number[] = [];
    const byDay = new Map<number, SavedReading[]>();
    for (const r of history) {
      const dayStart = startOfDay(r.savedAt);
      if (dayStart === todayStart) {
        today.push(r);
        continue;
      }
      let bucket = byDay.get(dayStart);
      if (!bucket) {
        bucket = [];
        byDay.set(dayStart, bucket);
        order.push(dayStart);
      }
      bucket.push(r);
    }
    return {
      todayReadings: today,
      pastGroups: order.map((dayStart) => ({
        key: String(dayStart),
        label: dateGroupLabel(dayStart, todayStart),
        readings: byDay.get(dayStart)!,
      })),
    };
  }, [history]);

  const handleUploadSelected = () => {
    if (selected.size === 0) return;
    // Upload in the same most-recent-first order the list is already shown
    // in, not insertion/selection order -- so "upload selected" behaves
    // predictably regardless of the order you happened to tap things in.
    const ids = history.filter((r) => selected.has(r.id)).map((r) => r.id);
    onUploadMany(ids);
  };

  const handleShareSelected = () => {
    if (selected.size === 0) return;
    const ids = history.filter((r) => selected.has(r.id)).map((r) => r.id);
    onShareMany(ids);
  };

  const handleDeleteSelected = () => {
    if (selected.size === 0) return;
    const ids = history.filter((r) => selected.has(r.id)).map((r) => r.id);
    const allSelected = ids.length === history.length;
    Alert.alert(
      allSelected ? 'Delete all readings?' : `Delete ${ids.length} reading${ids.length === 1 ? '' : 's'}?`,
      'This only removes them from this app\'s local history -- anything already uploaded to hCRI.io is unaffected. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setBulkDeleting(true);
            try {
              await onDeleteMany(ids);
              exitSelectMode();
            } finally {
              setBulkDeleting(false);
            }
          },
        },
      ]
    );
  };

  const styles = StyleSheet.create({
    empty: { paddingVertical: 40, alignItems: 'center' },
    emptyText: { color: colors.muted, fontSize: 13, textAlign: 'center', paddingHorizontal: 20 },

    // Top bar: the count on the left, two small matching pills on the right,
    // all centered on one line (this used to be a big full-size button next to
    // a bare text link, which sat at different heights and looked clunky).
    headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
    headerTitle: { color: colors.muted, fontSize: 12, flexShrink: 1, marginRight: 8 },
    headerButtons: { flexDirection: 'row', alignItems: 'center' },
    headerIcon: { alignItems: 'center', marginLeft: 16, minWidth: 40 },
    headerIconText: { color: colors.text, fontSize: 10, fontWeight: '600', marginTop: 1 },
    headerPill: {
      borderWidth: 1,
      borderColor: colors.cardBorder,
      backgroundColor: colors.card,
      borderRadius: 16,
      paddingHorizontal: 14,
      paddingVertical: 6,
      marginLeft: 8,
    },
    headerPillText: { color: colors.text, fontSize: 12.5, fontWeight: '600' },
    headerPillAccentText: { color: colors.accent, fontSize: 12.5, fontWeight: '600' },

    selectBar: {
      flexDirection: 'column',
      alignItems: 'stretch',
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      borderRadius: 10,
      paddingHorizontal: 14,
      paddingVertical: 10,
      marginBottom: 10,
    },
    selectAllText: { color: colors.accent, fontSize: 13, fontWeight: '600', alignSelf: 'flex-start' },
    selectBarButtons: { flexDirection: 'row', marginTop: 6, marginLeft: -8 },
    // Overrides PrimaryButton's default marginTop:8 (meant for a full-width
    // button stacked below other content) -- here it sits inline next to
    // "Select All" text, so that top margin would push it visibly lower than
    // its sibling instead of centering with it.
    selectBarIconButton: { flex: 1, marginLeft: 8, paddingVertical: 4, alignItems: 'center', borderRadius: 8, borderWidth: 1, borderColor: colors.cardBorder, backgroundColor: colors.card },
    selectBarIconText: { fontSize: 10, fontWeight: '600', marginTop: 1 },
    selectBarButton: { marginTop: 0, marginLeft: 8, flex: 1, paddingHorizontal: 8, paddingVertical: 10 },

    dateGroup: { marginBottom: 2 },
    todayLabel: {
      color: colors.mutedFaint,
      fontSize: 10.5,
      fontWeight: '700',
      letterSpacing: 1,
      textTransform: 'uppercase',
      marginBottom: 6,
    },
  });

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
            <TouchableOpacity style={styles.headerIcon} onPress={exitSelectMode} accessibilityRole="button" accessibilityLabel="Cancel selection">
              <ActionIcon d={ICON_X} color={colors.text} size={20} />
              <Text style={styles.headerIconText}>Cancel</Text>
            </TouchableOpacity>
          ) : (
            <>
              <TouchableOpacity style={styles.headerIcon} onPress={() => setSelectMode(true)} accessibilityRole="button" accessibilityLabel="Select readings">
                <ActionIcon d={ICON_CHECK} color={colors.accent} size={20} />
                <Text style={[styles.headerIconText, { color: colors.accent }]}>Select</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.headerIcon} onPress={onShareAll} accessibilityRole="button" accessibilityLabel="Share all readings">
                <ActionIcon d={ICON_TRAY} color={colors.text} size={20} />
                <Text style={styles.headerIconText}>Share all</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>

      {selectMode && (
        <View style={styles.selectBar}>
          <TouchableOpacity onPress={selectAll} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={styles.selectAllText}>Select All</Text>
          </TouchableOpacity>
          <View style={styles.selectBarButtons}>
            {([
              { icon: ICON_TRAY, label: 'Share', onPress: handleShareSelected, color: colors.text },
              { icon: ICON_TRASH, label: bulkDeleting ? 'Deleting…' : 'Delete', onPress: handleDeleteSelected, color: colors.danger, border: colors.danger },
              { icon: ICON_CLOUD, label: bulkUploading ? 'Uploading…' : selected.size ? `Upload (${selected.size})` : 'Upload', onPress: handleUploadSelected, color: colors.accent, border: colors.accent },
            ] as const).map((b) => {
              const off = selected.size === 0 || bulkUploading || bulkDeleting;
              return (
                <TouchableOpacity
                  key={b.label}
                  onPress={b.onPress}
                  disabled={off}
                  activeOpacity={0.8}
                  accessibilityRole="button"
                  accessibilityLabel={b.label}
                  style={[styles.selectBarIconButton, 'border' in b && { borderColor: b.border }, off && { opacity: 0.5 }]}
                >
                  <ActionIcon d={b.icon} color={b.color} size={17} />
                  <Text style={[styles.selectBarIconText, { color: b.color }]} numberOfLines={1}>{b.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      )}

      {/* Today's readings stay flat, right at the top, same as this list
          has always shown them -- these are the ones still actively being
          worked with this session, not something to tuck away. Only
          labeled "Today" when there's also at least one collapsed day
          below it to distinguish from; with nothing but today's readings,
          a label would just be noise. */}
      {pastGroups.length > 0 && todayReadings.length > 0 && <Text style={styles.todayLabel}>Today</Text>}
      {todayReadings.map((r) => (
        <HistoryRow
          key={r.id}
          reading={r}
          uploading={uploadingId === r.id}
          onRename={onRename}
          onUploadWithLabel={onUploadWithLabel}
          onDelete={onDelete}
          onShareOne={onShareOne}
          onOpen={onOpen}
          selectMode={selectMode}
          selected={selected.has(r.id)}
          onToggleSelected={toggleSelected}
          onCopyLink={onCopyLink}
          copyingLink={copyingLinkId === r.id}
          onOpenReport={onOpenReport}
          onOpenTm30={onOpenTm30}
        />
      ))}

      {/* Every other day's readings, one collapsed-by-default section per
          calendar day -- this is what actually keeps a history of any
          real size from turning into a wall of rows; only the readings
          from a day you actually tap open ever render expanded. */}
      {pastGroups.map((group) => (
        <CollapsibleSection key={group.key} title={group.label} count={group.readings.length}>
          <View style={styles.dateGroup}>
            {group.readings.map((r) => (
              <HistoryRow
                key={r.id}
                reading={r}
                uploading={uploadingId === r.id}
                onRename={onRename}
                onUploadWithLabel={onUploadWithLabel}
                onDelete={onDelete}
                onShareOne={onShareOne}
                onOpen={onOpen}
                selectMode={selectMode}
                selected={selected.has(r.id)}
                onToggleSelected={toggleSelected}
                onCopyLink={onCopyLink}
                copyingLink={copyingLinkId === r.id}
                onOpenReport={onOpenReport}
          onOpenTm30={onOpenTm30}
              />
            ))}
          </View>
        </CollapsibleSection>
      ))}
    </View>
  );
}
