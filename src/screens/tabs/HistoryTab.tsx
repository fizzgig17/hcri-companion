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
import { View, Text, TextInput, TouchableOpacity, Pressable, StyleSheet, ActivityIndicator, Alert, Modal } from 'react-native';
import { hapticLongPress } from '../../utils/haptics';
import HintPressable from '../../components/HintPressable';
import { Icon, ICON_SIZE } from '../../components/icons';
import Svg, { Polyline, Path } from 'react-native-svg';
import CollapsibleSection from '../../components/CollapsibleSection';
import { useTheme } from '../../contexts/ThemeContext';
import { SavedReading, HISTORY_LIMIT, HISTORY_WARN_AT } from '../../storage/readingHistory';

// Round selection mark used by the rows and the Select all control: an empty ring, a filled circle with a
// white tick, or (Select all only) a filled circle with a dash when some but not all are selected.
function SelectMark({ state, accent, ring }: { state: 'off' | 'on' | 'some'; accent: string; ring: string }) {
  const on = state !== 'off';
  return (
    <View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: on ? 0 : 1.5, borderColor: ring, backgroundColor: on ? accent : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
      {on && (
        <Svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
          <Path d={state === 'on' ? 'M5 12.5l4.5 4.5L19 7.5' : 'M6 12h12'} />
        </Svg>
      )}
    </View>
  );
}

// accent hex (#rrggbb) at a low alpha, for the selected row's wash.
const tint = (hex: string, alpha: string) => (/^#[0-9a-f]{6}$/i.test(hex) ? hex + alpha : hex);
import { analyzeSpectrum } from '../../utils/spectralAnalysis';
import LedSuggestionCard from '../../components/LedSuggestionCard';
import { ledsLine, ledsOfReading } from '../../hcri/leds';

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
  /** Opens the Compare screen for 2-6 checked readings (Select mode). Omit to hide the button. */
  onCompareMany?: (readings: SavedReading[]) => void;
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
  onOpenCard: (reading: SavedReading) => void;
  /** LED details: accept a suggestion, open the picker ("Other"), or drop the suggestion for a reading. */
  onLedConfirm: (id: string, d: { brand?: string; model?: string; cct?: string }) => void;
  onLedPick: (reading: SavedReading) => void;
  onLedDismiss: (id: string) => void;
  /** Readings that may take a saved flicker (no flicker yet, and a free saved flicker exists) get an "Add saved flicker" button. */
  addFlickerIds?: Set<string>;
  onAddFlicker?: (reading: SavedReading) => void;
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
  onLongSelect,
  onCopyLink,
  copyingLink,
  onOpenReport,
  onOpenTm30,
  onOpenCard,
  onLedConfirm,
  onLedPick,
  onLedDismiss,
  canAddFlicker,
  onAddFlicker,
}: {
  canAddFlicker?: boolean;
  onAddFlicker?: (reading: SavedReading) => void;
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
  /** Long press on a row (outside select mode): enters select mode with this row selected. */
  onLongSelect: (id: string) => void;
  onCopyLink: (reading: SavedReading) => void;
  copyingLink: boolean;
  onOpenReport: (reading: SavedReading, tm30: boolean) => void;
  /** Opens the in-app TM-30 report, generated on the phone from the stored spectrum (works for readings that were never uploaded). */
  onOpenTm30: (reading: SavedReading) => void;
  onOpenCard: (reading: SavedReading) => void;
  onLedConfirm: (id: string, d: { brand?: string; model?: string; cct?: string }) => void;
  onLedPick: (reading: SavedReading) => void;
  onLedDismiss: (id: string) => void;
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
      borderRadius: 14,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.cardBorder,
      paddingHorizontal: 14,
      paddingVertical: 12,
      marginBottom: 10,
    },
    rowSelectable: {},
    rowSelected: { borderColor: colors.accent, borderWidth: 1, backgroundColor: tint(colors.accent, '14') },
    selectRow: { flexDirection: 'row', alignItems: 'center' },
    checkboxCol: { width: 34, alignItems: 'flex-start', justifyContent: 'center' },
    selectRowBody: { flex: 1 },
    rowHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
    // flex: 1 gives the text a definite width (iOS under-measures a shrinking wrapped row and lets the text run into the icons); paddingRight is the gap.
    rowHeaderLeft: { flex: 1, flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', paddingRight: 14 },
    rowMeta: { color: colors.muted, fontSize: 12, fontVariant: ['tabular-nums'] },
    rowSummaryInline: { color: colors.muted, fontSize: 12, fontWeight: '500', marginLeft: 8, fontVariant: ['tabular-nums'] },
    rowHeaderButtons: { flexDirection: 'row', alignItems: 'center', flexShrink: 0 },
    viewText: { color: colors.info, fontSize: 12, fontWeight: '600', marginRight: 14 },
    deleteText: { color: colors.danger, fontSize: 12 },

    labelInput: { paddingVertical: 2, marginBottom: 8 },
    ledLine: { flexDirection: 'row', alignItems: 'center' },
    ledText: { color: colors.muted, fontSize: 12, marginLeft: 5 },
    ledEdit: { flexDirection: 'row', alignItems: 'center', marginLeft: 12 },
    ledEditText: { color: colors.accent, fontSize: 12, fontWeight: '600', marginLeft: 4 },
    labelText: { color: colors.text, fontSize: 15, fontWeight: '600', lineHeight: 20 },
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
      backgroundColor: tint(colors.accent, '1a'),
      borderRadius: 18,
      paddingVertical: 8,
      marginTop: 4,
    },
    linkRow: { flexDirection: 'row', marginHorizontal: -3 },
    linkPill: { flex: 1, marginHorizontal: 3 },
    copyLinkIcon: { marginRight: 6 },
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
            <HintPressable hint={reading.reportId != null ? 'Includes a flicker reading, sent with its report' : 'Includes a flicker reading'} activeOpacity={1} style={{ marginLeft: 6 }} accessibilityLabel={reading.reportId != null ? 'Includes a flicker reading, sent with its report' : 'Includes a flicker reading'}>
              <Svg width={16} height={12} viewBox="0 0 16 12">
                <Polyline points="0,9 3,9 3,2 7,2 7,9 11,9 11,2 15,2" fill="none" stroke={colors.accent} strokeWidth={1.6} strokeLinejoin="round" />
              </Svg>
            </HintPressable>
          )}
        </View>
        {!selectMode && (
          <View style={styles.rowHeaderButtons}>
            {canAddFlicker && onAddFlicker && (
              <HintPressable hint="Add a saved flicker" onPress={() => onAddFlicker(reading)} style={{ marginRight: 14 }} accessibilityRole="button" accessibilityLabel="Add saved flicker" hitSlop={{ top: 10, bottom: 10, left: 7, right: 7 }}>
                <Icon name="bolt" color={colors.accent} size={ICON_SIZE.row} />
              </HintPressable>
            )}
            <HintPressable hint="Upload to hCRI.io" onPress={() => onUploadWithLabel(reading.id, reading.label)} disabled={uploading} style={{ marginRight: 14, opacity: uploading ? 0.6 : 1 }} accessibilityRole="button" accessibilityLabel="Upload reading" hitSlop={{ top: 10, bottom: 10, left: 7, right: 7 }}>
              {uploading ? <ActivityIndicator size="small" color={colors.accent} /> : <Icon name="upload" color={colors.accent} size={ICON_SIZE.row} />}
            </HintPressable>
            <HintPressable hint="Share CSV" onPress={() => onShareOne(reading)} style={{ marginRight: 14 }} accessibilityRole="button" accessibilityLabel="Share CSV" hitSlop={{ top: 10, bottom: 10, left: 7, right: 7 }}>
              <Icon name="share" color={colors.text} size={ICON_SIZE.row} />
            </HintPressable>
            <HintPressable hint="View reading" onPress={() => onOpen(reading)} style={{ marginRight: 14 }} accessibilityRole="button" accessibilityLabel="View reading" hitSlop={{ top: 10, bottom: 10, left: 7, right: 7 }}>
              <Icon name="eye" color={colors.info} size={ICON_SIZE.row} />
            </HintPressable>
            <HintPressable hint="Delete reading" onPress={() => onDelete(reading.id)} accessibilityRole="button" accessibilityLabel="Delete reading" hitSlop={{ top: 10, bottom: 10, left: 7, right: 7 }}>
              <Icon name="trash" color={colors.danger} size={ICON_SIZE.row} />
            </HintPressable>
          </View>
        )}
      </View>

      {/* Tap to edit in a popup, same as the Main tab's upload title. */}
      <TouchableOpacity
        style={styles.labelInput}
        onPress={openEditor}
        onLongPress={() => onLongSelect(reading.id)}
        delayLongPress={400}
        disabled={selectMode}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel="Reading title. Tap to edit."
      >
        <Text style={styles.labelText}>{reading.label}</Text>
      </TouchableOpacity>

      {ledsOfReading(reading).length ? (
        <TouchableOpacity onPress={() => onLedPick(reading)} disabled={selectMode} style={{ marginTop: 4 }} accessibilityRole="button" accessibilityLabel="LED details. Tap to edit.">
          <View style={styles.ledLine}>
            <Icon name="bulb" color={colors.muted} size={ICON_SIZE.inline} />
            <Text style={[styles.ledText, { flexShrink: 1 }]}>{ledsLine(ledsOfReading(reading))}</Text>
            {!selectMode && (
              <View style={styles.ledEdit}>
                <Icon name="edit" color={colors.accent} size={ICON_SIZE.inline} />
                <Text style={styles.ledEditText}>Edit</Text>
              </View>
            )}
          </View>
        </TouchableOpacity>
      ) : !selectMode && !reading.ledDismissed && reading.ledSuggestion && reading.ledSuggestion !== 'none' ? (
        <View style={{ marginTop: 6 }}>
          <LedSuggestionCard
            suggestion={reading.ledSuggestion}
            onYes={() => { const s = reading.ledSuggestion as { brand: string; model: string; cct: string | null }; onLedConfirm(reading.id, { brand: s.brand, model: s.model, cct: s.cct ?? undefined }); }}
            onOther={() => onLedPick(reading)}
            onClose={() => onLedDismiss(reading.id)}
          />
        </View>
      ) : !selectMode && !reading.result.sampleLabel ? (
        <TouchableOpacity onPress={() => onLedPick(reading)} style={{ marginTop: 4 }} accessibilityRole="button" accessibilityLabel="Add LED details to this reading">
          <View style={styles.ledLine}>
            <Icon name="bulb" color={colors.accent} size={ICON_SIZE.inline} />
            <Text style={[styles.ledText, { color: colors.accent }]}>Add LED details</Text>
          </View>
        </TouchableOpacity>
      ) : null}

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
                  <View style={styles.copyLinkIcon}><Icon name="link" color={colors.accent} size={ICON_SIZE.inline} /></View>
                )}
                <Text style={styles.copyLinkLabel}>{copyingLink ? 'Working…' : 'Copy'}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => onOpenReport(reading, false)}
                disabled={copyingLink}
                style={[styles.copyLinkPill, styles.linkPill]}
              >
                <View style={styles.copyLinkIcon}><Icon name="external" color={colors.accent} size={ICON_SIZE.inline} /></View>
                <Text style={styles.copyLinkLabel}>Report</Text>
              </TouchableOpacity>
            </>
          )}
          <HintPressable hint="TM-30 report" onPress={() => onOpenTm30(reading)} style={[styles.copyLinkPill, styles.linkPill]}>
            <View style={styles.copyLinkIcon}><Icon name="report" color={colors.accent} size={ICON_SIZE.inline} /></View>
            <Text style={styles.copyLinkLabel}>TM-30</Text>
          </HintPressable>
          <HintPressable hint="Share card: save or copy an image of this reading" onPress={() => onOpenCard(reading)} style={[styles.copyLinkPill, styles.linkPill]}>
            <View style={styles.copyLinkIcon}><Icon name="card" color={colors.accent} size={ICON_SIZE.inline} /></View>
            <Text style={styles.copyLinkLabel}>Card</Text>
          </HintPressable>
        </View>
      )}
    </>
  );

  // Outside select mode, holding a row (its title, or anywhere that isn't
  // one of its buttons) enters select mode with that row already checked --
  // the usual list behaviour on Android and iOS.
  if (!selectMode) {
    return (
      <Pressable
        style={styles.row}
        onLongPress={() => onLongSelect(reading.id)}
        delayLongPress={400}
        accessibilityHint="Long press to select readings"
      >
        {rowInner}
      </Pressable>
    );
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
            <SelectMark state={selected ? 'on' : 'off'} accent={colors.accent} ring={colors.muted} />
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
  onCompareMany,
  onOpen,
  uploadingId,
  bulkUploading,
  onCopyLink,
  copyingLinkId,
  onOpenReport,
  onOpenTm30,
  onOpenCard,
  onLedConfirm,
  onLedPick,
  onLedDismiss,
  addFlickerIds,
  onAddFlicker,
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
      // Unchecking the last one leaves select mode (standard list behaviour), so
      // the Select all bar and checkboxes only show while something is selected.
      if (next.size === 0) setSelectMode(false);
      return next;
    });
  };

  const everySelected = history.length > 0 && selected.size === history.length;
  // The "Select all" checkbox: checks everything, or clears everything when it's already all checked.
  // Clearing everything leaves select mode, same as unchecking the last row.
  const toggleSelectAll = () => (everySelected ? exitSelectMode() : setSelected(new Set(history.map((r) => r.id))));

  // Long press on a row: strong haptic, then select mode with that row checked.
  const startSelectWith = (id: string) => {
    hapticLongPress();
    setSelected(new Set([id]));
    setSelectMode(true);
  };

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

  const handleCompareSelected = () => {
    if (!onCompareMany || selected.size < 2 || selected.size > 6) return;
    onCompareMany(history.filter((r) => selected.has(r.id)));
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
    headerTitle: { color: colors.text, fontSize: 17, fontWeight: '600', flexShrink: 1, marginRight: 8, letterSpacing: -0.2 },
    headerButtons: { flexDirection: 'row', alignItems: 'center' },
    headerIcon: { flexDirection: 'row', alignItems: 'center', marginLeft: 8, paddingVertical: 6, paddingHorizontal: 12, borderRadius: 18, backgroundColor: colors.card, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.cardBorder },
    headerIconText: { color: colors.text, fontSize: 13, fontWeight: '500', marginLeft: 6 },
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
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.cardBorder,
      borderRadius: 14,
      paddingHorizontal: 14,
      paddingVertical: 12,
      marginBottom: 12,
    },
    selectHint: { color: colors.muted, fontSize: 12.5, marginTop: -2, marginBottom: 12 },
    selectAllRow: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', paddingVertical: 2 },
    selectAllText: { color: colors.text, fontSize: 15, fontWeight: '500', marginLeft: 12 },
    selectBarButtons: { flexDirection: 'row', marginTop: 12, marginLeft: -8 },
    // Overrides PrimaryButton's default marginTop:8 (meant for a full-width
    // button stacked below other content) -- here it sits inline next to
    // "Select All" text, so that top margin would push it visibly lower than
    // its sibling instead of centering with it.
    selectBarIconButton: { flex: 1, marginLeft: 8, paddingVertical: 8, alignItems: 'center', borderRadius: 12, backgroundColor: colors.background },
    selectBarIconText: { fontSize: 11.5, fontWeight: '500', marginTop: 3 },
    selectBarButton: { marginTop: 0, marginLeft: 8, flex: 1, paddingHorizontal: 8, paddingVertical: 10 },

    limitNote: { color: colors.muted, fontSize: 12, lineHeight: 17, marginBottom: 10 },
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
      {history.length >= HISTORY_WARN_AT && (
        <Text style={styles.limitNote}>
          History keeps your most recent {HISTORY_LIMIT} readings. When it's full, the oldest uploaded readings are removed first; readings you haven't uploaded are kept.
        </Text>
      )}
      <View style={styles.headerRow}>
        <Text style={styles.headerTitle}>
          {selectMode
            ? `${selected.size} selected`
            : `${history.length} reading${history.length === 1 ? '' : 's'}`}
        </Text>
        <View style={styles.headerButtons}>
          {selectMode ? (
            <TouchableOpacity style={styles.headerIcon} onPress={exitSelectMode} accessibilityRole="button" accessibilityLabel="Cancel selection">
              <Icon name="x" color={colors.text} size={ICON_SIZE.pill} />
              <Text style={styles.headerIconText}>Cancel</Text>
            </TouchableOpacity>
          ) : (
            <>
              <TouchableOpacity style={styles.headerIcon} onPress={onShareAll} accessibilityRole="button" accessibilityLabel="Share all readings">
                <Icon name="share" color={colors.text} size={ICON_SIZE.pill} />
                <Text style={styles.headerIconText}>Share all</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>

      {!selectMode && <Text style={styles.selectHint}>Hold a reading's title to select it.</Text>}

      {selectMode && (
        <View style={styles.selectBar}>
          <TouchableOpacity
            onPress={toggleSelectAll}
            style={styles.selectAllRow}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: everySelected ? true : selected.size > 0 ? 'mixed' : false }}
            accessibilityLabel="Select all"
          >
            <SelectMark state={everySelected ? 'on' : selected.size > 0 ? 'some' : 'off'} accent={colors.accent} ring={colors.muted} />
            <Text style={styles.selectAllText}>Select all</Text>
          </TouchableOpacity>
          <View style={styles.selectBarButtons}>
            {([
              ...(onCompareMany ? [{ icon: 'compare' as const, label: 'Compare', onPress: handleCompareSelected, color: colors.info, border: colors.info }] : []),
              { icon: 'share' as const, label: 'Share', onPress: handleShareSelected, color: colors.text },
              { icon: 'trash' as const, label: bulkDeleting ? 'Deleting…' : 'Delete', onPress: handleDeleteSelected, color: colors.danger, border: colors.danger },
              { icon: 'upload' as const, label: bulkUploading ? 'Uploading…' : selected.size ? `Upload (${selected.size})` : 'Upload', onPress: handleUploadSelected, color: colors.accent, border: colors.accent },
            ] as const).map((b) => {
              const off = selected.size === 0 || bulkUploading || bulkDeleting || (b.label === 'Compare' && (selected.size < 2 || selected.size > 6));
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
                  <Icon name={b.icon} color={b.color} size={ICON_SIZE.row} />
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
          onLongSelect={startSelectWith}
          onCopyLink={onCopyLink}
          copyingLink={copyingLinkId === r.id}
          onOpenReport={onOpenReport}
          onOpenTm30={onOpenTm30}
          onOpenCard={onOpenCard}
          onLedConfirm={onLedConfirm}
          onLedPick={onLedPick}
          onLedDismiss={onLedDismiss}
          canAddFlicker={addFlickerIds?.has(r.id)}
          onAddFlicker={onAddFlicker}
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
                onLongSelect={startSelectWith}
                onCopyLink={onCopyLink}
                copyingLink={copyingLinkId === r.id}
                onOpenReport={onOpenReport}
          onOpenTm30={onOpenTm30}
          onOpenCard={onOpenCard}
          onLedConfirm={onLedConfirm}
          onLedPick={onLedPick}
          onLedDismiss={onLedDismiss}
                canAddFlicker={addFlickerIds?.has(r.id)}
                onAddFlicker={onAddFlicker}
              />
            ))}
          </View>
        </CollapsibleSection>
      ))}
    </View>
  );
}
