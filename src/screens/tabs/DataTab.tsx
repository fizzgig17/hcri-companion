// src/screens/tabs/DataTab.tsx
//
// The "Data" tab: the Upload Title editor, a preview of exactly what will
// be uploaded, the full R1-R15 breakdown, chromaticity coordinates, and
// device info -- plus the Upload to hCRI.io and Share CSV buttons, since
// those act on this same result data. No longer leads with a stat grid
// (CCT/Ra/Lux/R9/Duv) -- Main's own result card already shows those,
// customizable, right where the reading is taken; repeating them here
// was just the same numbers twice.

import React, { useRef } from 'react';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import CollapsibleSection from '../../components/CollapsibleSection';
import { useTheme } from '../../contexts/ThemeContext';
import { MeterResult } from '../../ble/parseResult';
import { SpectralAnalysis } from '../../utils/spectralAnalysis';
import { buildCsv, defaultLabel } from '../../hcri/buildCsv';
import { HCRI_BRAND_HOST } from '../../hcri/buildTarget';
import { STAT_METRIC_BY_ID } from '../../utils/statMetrics';
import LedPickerModal from '../../components/LedPickerModal';
import { LedDetails } from '../../hcri/ledApi';
import { hasLed } from '../../hcri/leds';
import { LedLists } from '../../hcri/ledLists';

const ICON_CLOUD = 'M16 16l-4-4-4 4M12 12v9M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3';
const ICON_TRAY = 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12';

// The core colorimetric numbers (CCT/Ra/Duv/Lux/Rf/R9/Rg), still worth
// having right here rather than only on Main -- but as a compact, plain
// text summary line rather than the big StatCard tiles this tab used to
// show, which just duplicated Main's own (customizable) result card.
// Pulled from the same statMetrics.ts registry Main uses, so the
// formatting (decimal places, units) always matches exactly.
const SUMMARY_METRIC_IDS = ['cct', 'ra', 'duv', 'lux', 'rf', 'r9', 'rg'];

interface Props {
  result: MeterResult | null;
  /** Spectrum-derived CCT/Duv/Ra/R9/R1-R15/x/y for `result` -- the same
   * analysis object Main/Spectrum tabs use (analyzeSpectrum(), computed
   * once in HomeScreen), so every number on this tab matches what hCRI.io
   * itself will compute for the identical uploaded spectrum. Only `Lux`
   * below stays device-reported -- there's no CIE 13.3 illuminance output
   * to port. */
  analysis: SpectralAnalysis | null;
  onUpload: () => void;
  uploading: boolean;
  /** Same uploadSucceeded flag MainTab shows a checkmark for -- see
   * HomeScreen.tsx's own comment on it. Shown here too since this tab has
   * its own copy of the Upload button. */
  uploadSucceeded: boolean;
  /** Same canCopyLink/copyingLink/onCopyLink trio MainTab uses -- see its
   * own comments on these props. Shown here too since this tab has its
   * own copy of the Upload button/checkmark. */
  canCopyLink: boolean;
  copyingLink: boolean;
  onCopyLink: () => void;
  /** Upload title/label -- lifted up to HomeScreen so it survives switching
   * tabs and taking multiple readings; only resets when the app itself
   * restarts. See the long comment on this state in HomeScreen.tsx. */
  uploadTitle: string;
  onUploadTitleChange: (title: string) => void;
  onShareCsv: () => void;
  /** hCRI.io username, cached in HomeScreen from secureStorage -- purely for
   * showing what the default title WOULD be (defaultLabel()) before you've
   * typed anything of your own. null if no account is set up yet, in which
   * case defaultLabel() just leaves that piece out rather than a blank
   * placeholder. */
  cachedUsername: string | null;
  /** Scrolls a given TextInput ref clear of the keyboard -- see
   * HomeScreen.tsx's own comment on this. Same prop MainTab takes. */
  scrollInputIntoView: (inputRef: React.RefObject<any>) => void;
  /** LED details confirmed for this reading (brand / model / CCT), if any. */
  ledCurrent?: LedDetails[] | null;
  /** Opens the LED picker; undefined until the reading is saved to History. */
  onLedEdit?: () => void;
  ledLists?: LedLists | null;
  ledPickerOpen?: boolean;
  onLedPickerSave?: (d: LedDetails[]) => void;
  onLedPickerCancel?: () => void;
}

export default function DataTab({
  result,
  analysis,
  onUpload,
  uploading,
  uploadSucceeded,
  canCopyLink,
  copyingLink,
  onCopyLink,
  uploadTitle,
  onUploadTitleChange,
  onShareCsv,
  cachedUsername,
  scrollInputIntoView,
  ledCurrent,
  onLedEdit,
  ledLists,
  ledPickerOpen,
  onLedPickerSave,
  onLedPickerCancel,
}: Props) {
  const { colors } = useTheme();
  // See HomeScreen.tsx's scrollInputIntoView comment -- needs a ref to the
  // actual TextInput, not just a position, since it measures this input's
  // layout relative to the ScrollView HomeScreen owns.
  const titleInputRef = useRef<React.ComponentRef<typeof TextInput>>(null);

  const styles = StyleSheet.create({
    empty: { paddingVertical: 40, alignItems: 'center' },
    emptyText: { color: colors.muted, fontSize: 13 },

    card: {
      backgroundColor: colors.card,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      padding: 14,
      marginBottom: 12,
    },
    row: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingVertical: 4,
      borderBottomWidth: 1,
      borderBottomColor: colors.cardBorder,
    },
    rowLabel: { color: colors.muted, fontSize: 12 },
    rowValue: { color: colors.text, fontSize: 12, fontFamily: 'monospace' },

    // Compact, plain-text summary of the core colorimetric numbers -- small
    // and unboxed on purpose (no tile background/border like StatCard),
    // since this is just a quick-reference recap of what Main's result card
    // already showed prominently, not a second place to feature them.
    summaryRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      paddingBottom: 10,
      marginBottom: 10,
      borderBottomWidth: 1,
      borderBottomColor: colors.cardBorder,
    },
    summaryItem: { width: '33.33%', marginBottom: 6 },
    summaryValue: { color: colors.text, fontSize: 13, fontWeight: '600', fontFamily: 'monospace' },
    summaryUnit: { color: colors.muted, fontSize: 10, fontWeight: '400' },
    summaryLabel: { color: colors.muted, fontSize: 10 },

    csvPreview: {
      color: colors.text,
      fontSize: 10,
      lineHeight: 14,
      fontFamily: 'monospace',
    },

    uploadRow: { flexDirection: 'row', alignItems: 'center' },
    iconButton: { flex: 1, marginTop: 8, paddingVertical: 10, alignItems: 'center', borderRadius: 10, borderWidth: 1, borderColor: colors.cardBorder, backgroundColor: colors.card },
    iconButtonText: { fontSize: 12, fontWeight: '600', marginTop: 3 },
    // Replaces the old separate checkmark + bare-icon-button pair -- next
    // to each other, both unlabeled, they read as two things rather than
    // one ("why are there two icons?"). A single pill that's both the
    // success confirmation AND the copy-link action -- its own outline in
    // the accent color IS the confirmation, so there's no bare checkmark
    // needed alongside it. Mirrors MainTab's identical style -- see its
    // own copy of this comment for the one place this is defined, in case
    // these two ever drift.
    copyLinkPill: {
      flexDirection: 'row',
      alignItems: 'center',
      marginLeft: 10,
      paddingVertical: 7,
      paddingHorizontal: 12,
      borderRadius: 18,
      borderWidth: 1.5,
      borderColor: colors.accent,
    },
    copyLinkIcon: { fontSize: 15, marginRight: 6 },
    copyLinkSpinner: { marginRight: 6 },
    copyLinkLabel: { color: colors.accent, fontSize: 13, fontWeight: '700' },

    ledBlock: { marginTop: 12 },
    ledHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
    ledEdit: { color: colors.accent, fontSize: 12, fontWeight: '700' },
    ledNone: { color: colors.muted, fontSize: 12, paddingVertical: 4 },

    fieldLabel: { color: colors.muted, fontSize: 11, marginBottom: 4 },
    // Background/border live on the wrapper, not the TextInput itself, so the
    // overlaid default-text <Text> (titleInputOverlay) and the real input
    // share the exact same padding box and line up pixel-for-pixel.
    titleInputWrap: {
      backgroundColor: colors.background,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      borderRadius: 8,
      minHeight: 38,
      position: 'relative',
    },
    // In normal flow (not absolutely positioned) so a default title that wraps
    // onto 2+ lines makes the box grow; the empty TextInput is laid over it.
    titleInputOverlay: {
      paddingHorizontal: 10,
      paddingVertical: 8,
      color: colors.muted,
      fontSize: 13,
    },
    titleInputEmpty: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
    titleInput: {
      paddingHorizontal: 10,
      paddingVertical: 8,
      color: colors.text,
      fontSize: 13,
      minHeight: 38,
    },
  });

  if (!result || !analysis) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>Take a reading to see its data here.</Text>
      </View>
    );
  }

  return (
    <View>
      <View style={styles.card}>
        <View style={styles.summaryRow}>
          {SUMMARY_METRIC_IDS.map((id) => {
            const metric = STAT_METRIC_BY_ID[id];
            const out = metric?.format(result, analysis);
            if (!out) return null;
            return (
              <View key={id} style={styles.summaryItem}>
                <Text style={styles.summaryValue}>
                  {out.value}
                  {out.unit ? <Text style={styles.summaryUnit}> {out.unit}</Text> : null}
                </Text>
                <Text style={styles.summaryLabel}>{metric.label}</Text>
              </View>
            );
          })}
        </View>

        <Text style={styles.fieldLabel}>Upload Title</Text>
        {/* The default (username + date + time + timezone + device -- long
            enough to need wrapping) is rendered as a plain overlaid <Text>
            behind the input, NOT via TextInput's own `placeholder` prop --
            on Android, a multiline TextInput's native placeholder does not
            wrap no matter what you set `multiline` to, a long-standing RN
            platform quirk. A plain Text always wraps correctly, so this
            sidesteps the bug entirely rather than fighting it. Only shown
            while the field is actually empty; pointerEvents="none" so it
            never intercepts taps meant for the real input on top of it. */}
        <View style={styles.titleInputWrap}>
          {uploadTitle.length === 0 && (
            <Text style={styles.titleInputOverlay} pointerEvents="none">
              {defaultLabel(cachedUsername, result.deviceName)}
            </Text>
          )}
          <TextInput
            ref={titleInputRef}
            style={[styles.titleInput, uploadTitle.length === 0 && styles.titleInputEmpty]}
            value={uploadTitle}
            onChangeText={onUploadTitleChange}
            onFocus={() => scrollInputIntoView(titleInputRef)}
            autoCapitalize="none"
            autoCorrect={false}
            multiline
            textAlignVertical="top"
            editable={!result.sampleLabel}
          />
        </View>

        {/* LED details: the same brand / model / CCT Main's pill and the
            History strip edit. Shown here too so the Data tab lists
            everything that goes with this reading. */}
        <View style={styles.ledBlock}>
          <View style={styles.ledHeader}>
            <Text style={styles.fieldLabel}>LED</Text>
            {onLedEdit && (
              <TouchableOpacity onPress={onLedEdit} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} accessibilityRole="button" accessibilityLabel="Edit LED details">
                <Text style={styles.ledEdit}>{ledCurrent && ledCurrent.some(hasLed) ? 'Edit' : '💡 Add LED details'}</Text>
              </TouchableOpacity>
            )}
          </View>
          {ledCurrent && ledCurrent.some(hasLed) ? (
            <>
              {ledCurrent.filter(hasLed).map((l, i, all) => (
                <View key={i} style={all.length > 1 && i > 0 ? { marginTop: 8 } : undefined}>
                  {all.length > 1 && <Text style={styles.fieldLabel}>LED {i + 1}</Text>}
                  <View style={styles.row}><Text style={styles.rowLabel}>Brand</Text><Text style={styles.rowValue}>{l.brand || '—'}</Text></View>
                  <View style={styles.row}><Text style={styles.rowLabel}>Model</Text><Text style={styles.rowValue}>{l.model || '—'}</Text></View>
                  <View style={styles.row}><Text style={styles.rowLabel}>CCT</Text><Text style={styles.rowValue}>{l.cct || '—'}</Text></View>
                </View>
              ))}
            </>
          ) : (
            <Text style={styles.ledNone}>{onLedEdit ? 'No LED details yet.' : 'LED details can be added once the reading is saved.'}</Text>
          )}
        </View>
        {ledLists && onLedPickerSave && onLedPickerCancel && (
          <LedPickerModal
            visible={!!ledPickerOpen}
            lists={ledLists}
            initial={ledCurrent ?? undefined}
            onSave={onLedPickerSave}
            onCancel={onLedPickerCancel}
          />
        )}

        {/* Exactly what buildCsv() will send -- calling the real function
            rather than reconstructing the format here, so this preview can
            never drift out of sync with what actually gets uploaded. Lets
            you eyeball the wavelength range and point count before
            uploading, which is exactly the kind of thing that would have
            caught the padded-spectrum bug (StartTestWave/EndTestWave
            running out to ~1000 instead of stopping around 750) before it
            ever reached hCRI.io. */}
        <CollapsibleSection title="Upload Preview (hCRI.io)" count={result.spectrum.length}>
          <Text selectable style={styles.csvPreview}>
            {buildCsv(result)}
          </Text>
        </CollapsibleSection>

        <View style={styles.uploadRow}>
          <TouchableOpacity
            onPress={onUpload}
            disabled={uploading || !!result.sampleLabel}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel={`Upload reading to ${HCRI_BRAND_HOST}`}
            style={[styles.iconButton, (uploading || !!result.sampleLabel) && { opacity: 0.5 }]}
          >
            {uploading ? <ActivityIndicator size="small" color={colors.accent} /> : <Svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke={colors.accent} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><Path d={ICON_CLOUD} /></Svg>}
            <Text style={[styles.iconButtonText, { color: colors.accent }]} numberOfLines={1}>{uploading ? 'Uploading…' : 'Upload reading'}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={onShareCsv}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Share CSV"
            style={[styles.iconButton, { marginLeft: 8 }]}
          >
            <Svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke={colors.text} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><Path d={ICON_TRAY} /></Svg>
            <Text style={[styles.iconButtonText, { color: colors.text }]} numberOfLines={1}>Share CSV</Text>
          </TouchableOpacity>
          {/* Same Copy Link pill MainTab shows -- it's both the success
              confirmation and the copy-link action, replacing the old
              separate checkmark + bare-icon pair. See MainTab.tsx's own
              comment on this. */}
          {uploadSucceeded && canCopyLink && (
            <TouchableOpacity
              onPress={onCopyLink}
              disabled={copyingLink}
              style={styles.copyLinkPill}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              {copyingLink ? (
                <ActivityIndicator size="small" color={colors.accent} style={styles.copyLinkSpinner} />
              ) : (
                <Text style={styles.copyLinkIcon}>🔗</Text>
              )}
              <Text style={styles.copyLinkLabel}>{copyingLink ? 'Copying…' : 'Copy Link'}</Text>
            </TouchableOpacity>
          )}
          {uploadSucceeded && !canCopyLink && (
            <View style={styles.copyLinkPill}>
              <Text style={styles.copyLinkIcon}>✓</Text>
              <Text style={styles.copyLinkLabel}>Uploaded</Text>
            </View>
          )}
        </View>
      </View>

      {/* Moved here from the Spectrum sub-page (SpectrumTab.tsx) 2026-10-04
          -- expanding it there, inside SwipablePages' swipeable pager, never
          actually grew the visible area: the pager sizes its ScrollView
          viewport to the ACTIVE page's last-measured height and then
          stretches each page to fill that same fixed height (the default
          cross-axis behavior for a horizontal ScrollView's row-direction
          content container), so an expanding CollapsibleSection inside a
          page got clipped to its own stale pre-expansion height instead of
          growing it -- a circular measurement dependency, not something
          fixable by a small tweak to that shared pager. This tab's plain
          vertical ScrollView has no such constraint, so it just works here
          the same way Upload Preview/R1-R15/Chromaticity/Device Info
          already do below. */}
      <CollapsibleSection title="Raw Values" count={result.spectrum.length}>
        {result.spectrum.map((p) => (
          <View key={p.nm} style={styles.row}>
            <Text style={styles.rowLabel}>{p.nm}nm</Text>
            <Text style={styles.rowValue}>{p.value.toFixed(4)}</Text>
          </View>
        ))}
      </CollapsibleSection>

      <CollapsibleSection title="R1–R15" count={analysis.ri.length}>
        {analysis.ri.map((v, i) => (
          <View key={i} style={styles.row}>
            <Text style={styles.rowLabel}>R{i + 1}</Text>
            <Text style={styles.rowValue}>{v.toFixed(1)}</Text>
          </View>
        ))}
      </CollapsibleSection>

      <CollapsibleSection title="Chromaticity">
        <View style={styles.row}>
          <Text style={styles.rowLabel}>x</Text>
          <Text style={styles.rowValue}>{analysis.x.toFixed(4)}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>y</Text>
          <Text style={styles.rowValue}>{analysis.y.toFixed(4)}</Text>
        </View>
      </CollapsibleSection>

      <CollapsibleSection title="Device Info">
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Device</Text>
          <Text style={styles.rowValue}>{result.deviceName}</Text>
        </View>
        {result.source !== 'torchbearer' && (
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Firmware</Text>
            <Text style={styles.rowValue}>{result.firmwareVersion}</Text>
          </View>
        )}
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Integration Time</Text>
          <Text style={styles.rowValue}>{result.integrationTimeMs.toFixed(1)} ms</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Timestamp</Text>
          <Text style={styles.rowValue}>{result.timestampOnDevice}</Text>
        </View>
      </CollapsibleSection>
    </View>
  );
}
