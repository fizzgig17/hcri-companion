// src/screens/tabs/DataTab.tsx
//
// The "Data" tab: the Upload Title editor, a preview of exactly what will
// be uploaded, the full R1-R15 breakdown, chromaticity coordinates, and
// device info -- plus the Upload to hCRI.io and Share CSV buttons, since
// those act on this same result data. No longer leads with a stat grid
// (CCT/Ra/Lux/R9/Duv) -- Main's own result card already shows those,
// customizable, right where the reading is taken; repeating them here
// was just the same numbers twice.

import React from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';
import PrimaryButton from '../../components/PrimaryButton';
import CollapsibleSection from '../../components/CollapsibleSection';
import { useTheme } from '../../contexts/ThemeContext';
import { MeterResult } from '../../ble/parseResult';
import { SpectralAnalysis } from '../../utils/spectralAnalysis';
import { buildCsv, defaultLabel } from '../../hcri/buildCsv';
import { HCRI_BRAND_HOST } from '../../hcri/buildTarget';
import { STAT_METRIC_BY_ID } from '../../utils/statMetrics';

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
}

export default function DataTab({
  result,
  analysis,
  onUpload,
  uploading,
  uploadTitle,
  onUploadTitleChange,
  onShareCsv,
  cachedUsername,
}: Props) {
  const { colors } = useTheme();

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
    titleInputOverlay: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      paddingHorizontal: 10,
      paddingVertical: 8,
      color: colors.muted,
      fontSize: 13,
    },
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
            style={styles.titleInput}
            value={uploadTitle}
            onChangeText={onUploadTitleChange}
            autoCapitalize="none"
            autoCorrect={false}
            multiline
            textAlignVertical="top"
          />
        </View>

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

        <PrimaryButton title={`Upload to ${HCRI_BRAND_HOST}`} onPress={onUpload} disabled={uploading} variant="muted" />
        <PrimaryButton title="Share CSV" onPress={onShareCsv} variant="muted" />
      </View>

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
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Firmware</Text>
          <Text style={styles.rowValue}>{result.firmwareVersion}</Text>
        </View>
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
