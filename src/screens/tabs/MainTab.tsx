// src/screens/tabs/MainTab.tsx
//
// The "Main" tab: connection status, Connect/Take Reading/Disconnect at
// the top, and the latest reading right below it -- the same measurement-
// grid-then-swipeable-Spectrum/Chrom/R-Values arrangement ReadingDetail
// Screen.tsx shows for a past reading, just for the live one. This is
// deliberately the ONLY tab that touches the actual BLE connection
// lifecycle -- Data/History/Logs are all read-only detail views of
// whatever the last reading was.
//
// There's no "Scan for Nearby Meters" section here any more -- connect()
// in HomeScreen.tsx now scans for a few seconds every time Connect is
// pressed, and the device-picker Modal below only appears if that scan
// actually turns up more than one matching meter. One meter in range
// (the overwhelmingly common case) connects straight through with no
// extra UI at all, same as before.

import { APP_VERSION } from '../../buildInfo';
import React, { useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, Modal, StyleSheet } from 'react-native';
import InfoButton from '../../components/InfoButton';
import StatCard, { statDensity } from '../../components/StatCard';
import { defaultLabel } from '../../hcri/buildCsv';
import SpectrumTab from './SpectrumTab';
import { statusLabels } from '../../theme';
import { useTheme } from '../../contexts/ThemeContext';
import { MeterResult } from '../../ble/parseResult';
import type { FlickerReading } from '../../ble/liveSessions';
import type { FlickerSettingsApi } from '../../components/FlickerSettingsModal';
import type { BatteryStatus } from '../../ble/protocol';
import { SpectralAnalysis } from '../../utils/spectralAnalysis';
import { STAT_METRIC_BY_ID } from '../../utils/statMetrics';
import { EMPTY_METER_RESULT, EMPTY_SPECTRAL_ANALYSIS } from '../../utils/placeholderReading';

// Title field (56) + its top margin (8), always subtracted so the charts are
// the same size whether or not a reading (and so the title) is showing.

export type Status = 'disconnected' | 'connecting' | 'connected' | 'measuring' | 'uploading';

export interface FoundDevice {
  id: string;
  name: string | null;
  rssi: number | null;
}

interface Props {
  status: Status;
  isBusy: boolean;
  result: MeterResult | null;
  /** Spectrum-derived CCT/Duv/Ra/R9/x/y for `result` -- same analysis object SpectrumTab and DataTab use, computed once in HomeScreen. Null only when there's no result yet. */
  analysis: SpectralAnalysis | null;
  connect: () => void;
  /** Loads a random public hCRI.io report as a sample reading -- offered while no meter is connected. */
  onShowTestReading: () => void;
  loadingTestReading: boolean;
  measure: () => void;
  disconnect: () => void;
  /** Manually clears any BLE connection left over from a previous app session -- see MeterConnection.resetStaleConnection(). Surfaced here since that's exactly the situation this button is for: meter won't connect, normally requiring a power cycle. */
  resetConnection: () => void;
  /** The candidates from the most recent scan that found more than one matching meter -- kept around (not cleared on connect) so the "switch meter" icon below can reopen the same list later without a fresh scan. Null means the last scan found 0 or 1 (the ordinary case), so there's nothing to switch between and the icon doesn't show at all. */
  devicePickerDevices: FoundDevice[] | null;
  /** Whether the picker overlay itself is open right now -- separate from devicePickerDevices (which outlives the overlay being dismissed, see above). True right after connect()'s scan finds more than one match, or after tapping the "switch meter" icon. */
  devicePickerVisible: boolean;
  /** Reopens the overlay using the already-known devicePickerDevices list (the "switch meter" icon) -- never triggers a fresh scan. */
  onOpenDevicePicker: () => void;
  onSelectDevice: (id: string) => void;
  onDismissDevicePicker: () => void;
  /** Same upload action/state DataTab's "Upload to hCRI.io" button uses --
   * duplicated here so you don't have to switch tabs after taking a
   * reading just to send it. Uses whatever title is currently set on the
   * Data tab (defaults to the same auto-generated label if you haven't
   * typed one); to change the title, that's still done on the Data tab. */
  onUpload: () => void;
  uploading: boolean;
  /** Whether the most recent upload attempt (for the CURRENT reading)
   * succeeded -- true shows a small inline checkmark next to the Upload
   * button instead of a confirmation popup; a failed attempt still raises
   * an Alert (see HomeScreen.tsx's upload()), so there's nothing to show
   * inline for that case. Reset to false the moment a new reading comes
   * in, so the checkmark from a previous reading's upload never lingers
   * next to a result it doesn't actually describe. */
  uploadSucceeded: boolean;
  /** True once the most recent successful upload's {id, isPublic} is
   * known -- i.e. there's a report the link icon can actually resolve a
   * link for right now. Goes false again the moment a new upload starts
   * (see HomeScreen.tsx), same lifetime as uploadSucceeded. */
  canCopyLink: boolean;
  /** True while onCopyLink's own request is in flight (a private report
   * needs one call to mint/fetch its share token; a public report
   * resolves with none at all -- see getReportLink.ts). */
  copyingLink: boolean;
  /** Resolves the current report's link and puts it on the clipboard. */
  onCopyLink: () => void;
  /** Which measurements to show in the result card, and in what order --
   * the person's own customization from Settings (see
   * storage/statDisplayPrefs.ts), already resolved down to just the
   * enabled ids by HomeScreen. */
  statIds: string[];
  /** The currently-connected meter's advertised name, or null when nothing's
   * connected -- shown right next to the status dot/text. Used to live in
   * Home's own header (dropped along with the rest of that header -- see
   * HomeScreen.tsx), so this is the one place it's still visible at all. */
  connectedDeviceName?: string | null;
  /** Meter battery level from 8C C3, or null/undefined until the meter has answered (then nothing is shown). */
  battery?: BatteryStatus | null;
  /** Upload title/label -- the SAME state DataTab's own Upload Title field
   * reads/writes, lifted up to HomeScreen so it survives switching tabs and
   * taking multiple readings, only resetting when the app itself restarts
   * (a cold start) -- see HomeScreen.tsx's own long comment on this state.
   * Shown here too so you don't have to switch to Data just to set a title
   * before uploading from Main. */
  uploadTitle: string;
  onUploadTitleChange: (title: string) => void;
  /** hCRI.io username, cached in HomeScreen from secureStorage -- purely for
   * showing what the default title WOULD be (defaultLabel()) before you've
   * typed anything of your own. null if no account is set up yet, in which
   * case defaultLabel() just leaves that piece out rather than a blank
   * placeholder. Same prop DataTab takes -- see its own comment. */
  cachedUsername: string | null;
  /** Scrolls a given TextInput ref clear of the keyboard -- see
   * HomeScreen.tsx's own comment on this. Needs a ref to the actual input
   * (not just a position) since it measures that input's layout relative
   * to the ScrollView HomeScreen owns, which this tab has no ref to
   * itself. */
  scrollInputIntoView: (inputRef: React.RefObject<any>) => void;
  /** Set only while a flicker-capable meter is connected: adds the Flicker chart page. */
  flicker?: { reading: FlickerReading | null; running: boolean; focusNonce: number; history: { f: number; p: number }[]; settings?: FlickerSettingsApi };
  /** See SpectrumTab's pagerResetKey. */
  pagerResetKey?: unknown;
}

export default function MainTab({
  status,
  isBusy,
  result,
  analysis,
  connect,
  onShowTestReading,
  loadingTestReading,
  measure,
  disconnect,
  resetConnection,
  devicePickerDevices,
  devicePickerVisible,
  onOpenDevicePicker,
  onSelectDevice,
  onDismissDevicePicker,
  onUpload,
  uploading,
  uploadSucceeded,
  canCopyLink,
  copyingLink,
  onCopyLink,
  statIds,
  connectedDeviceName,
  battery,
  uploadTitle,
  onUploadTitleChange,
  cachedUsername,
  scrollInputIntoView,
  flicker,
  pagerResetKey,
}: Props) {
  const { colors, statusColors } = useTheme();
  const canSwitchMeters = status === 'connected' && (devicePickerDevices?.length ?? 0) > 1;
  const hasReading = !!(result && analysis);
  // Falls back to an all-zero reading/analysis so the stat grid and
  // Spectrum/Chrom/R-Values charts below always render in their final
  // layout -- see placeholderReading.ts's own comment for why this is
  // what actually keeps the Take Reading button from jumping position.
  const displayResult = result ?? EMPTY_METER_RESULT;
  const displayAnalysis = analysis ?? EMPTY_SPECTRAL_ANALYSIS;
  // See HomeScreen.tsx's scrollInputIntoView comment -- needs a ref to the
  // actual TextInput, not just a position, since it measures this input's
  // layout relative to the ScrollView HomeScreen owns.
  const titleInputRef = useRef<TextInput>(null);
  const [titleModalVisible, setTitleModalVisible] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  // Tiles that actually have a value, and how densely to pack them: the
  // more the person chooses, the more columns/smaller text, so the chart
  // stays on screen without scrolling.
  const visibleStats = statIds.flatMap((id) => {
    const metric = STAT_METRIC_BY_ID[id];
    const out = metric ? metric.format(displayResult, displayAnalysis) : null;
    return metric && out ? [{ id, metric, out }] : [];
  });
  const density = statDensity(visibleStats.length);
  // Height of the chart region (the card's flexible middle) -- measured, but
  // it never depends on the charts' own size, so there's no feedback loop.
  // Room for the charts = this tab's height minus the status row, stat grid
  // and the card's own padding -- none of which depend on the chart size, so
  // there's no feedback loop and the charts never shift when something below
  // (the docked title) appears.
  const [chartRegionH, setChartRegionH] = useState(0);

  const styles = StyleSheet.create({
    // Fixed height, never wraps: a spinner/battery/longer status text used to push this onto a second line while connecting or measuring, shifting the charts down and back.
    statusRow: { flexDirection: 'row', alignItems: 'center', height: 24, marginBottom: 6 },
    resetLink: { alignItems: 'center', paddingVertical: 8 },
    resetLinkText: { color: colors.muted, fontSize: 12 },
    sampleNote: { color: colors.muted, fontSize: 12, fontStyle: 'italic', textAlign: 'center', marginTop: 8 },
    statusDot: { width: 8, height: 8, borderRadius: 4, marginRight: 8 },
    batteryWrap: { marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', paddingLeft: 10, flexShrink: 0 },
    batteryBody: { width: 20, height: 10, borderWidth: 1.5, borderRadius: 2.5, padding: 1 },
    batteryNub: { width: 2, height: 4, borderTopRightRadius: 1, borderBottomRightRadius: 1, marginLeft: 1 },
    batteryText: { fontSize: 13, fontWeight: '600', marginLeft: 5 },
    statusText: { color: colors.muted, fontSize: 14, flexShrink: 1 },
    versionTiny: { marginLeft: 'auto', color: colors.mutedFaint, fontSize: 10, flexShrink: 0, paddingLeft: 6 },
    deviceNameText: { color: colors.text, fontSize: 14, fontWeight: '600' },

    switchMeterButton: { flexDirection: 'row', alignItems: 'center', marginLeft: 12, flexShrink: 0 },
    switchMeterIcon: { color: colors.info, fontSize: 14, marginRight: 4 },
    switchMeterText: { color: colors.info, fontSize: 12, fontWeight: '600' },

    root: { flex: 1 },
    chartRegion: { flex: 1, minHeight: 0, overflow: 'hidden' },
    resultCard: {
      flex: 1,
      backgroundColor: colors.card,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      padding: 14,
      marginTop: 6,
    },
    statGrid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -5, marginBottom: 2 },
    customizeHint: { color: colors.mutedFaint, fontSize: 10.5, marginBottom: 10, textAlign: 'center' },
    uploadRow: { flexDirection: 'row', alignItems: 'center' },
    uploadButton: { flex: 1 },
    // Replaces the old separate checkmark + bare-icon-button pair -- next
    // to each other, both unlabeled, they read as two things rather than
    // one ("why are there two icons?"). A single pill that's both the
    // success confirmation AND the copy-link action -- its own outline in
    // the accent color IS the confirmation, so there's no bare checkmark
    // needed alongside it. Mirrors DataTab's identical style -- see its
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

    // Same Upload Title field DataTab has always had -- added here too so
    // you don't have to switch tabs just to set a title before uploading
    // from Main. Styles/behavior copied verbatim from DataTab.tsx (see its
    // own comments for why the default is an overlaid Text rather than
    // TextInput's native `placeholder`), reading/writing the SAME lifted
    // uploadTitle state in HomeScreen -- not a second, independent field.
    fieldLabel: { color: colors.muted, fontSize: 11, marginBottom: 4 },
    // Extra gap under the "Test reading from…" note, only while a sample is showing.
    fieldLabelAfterSample: { marginTop: 12 },
    titleInputWrap: {
      backgroundColor: colors.background,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      borderRadius: 8,
      position: 'relative',
      marginTop: 'auto',
      height: 56,
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
      height: 54,
    },

    titleTextSet: { color: colors.text },
    titleModalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'flex-start', paddingTop: 70, paddingHorizontal: 24 },
    titleModalInput: {
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
    titleModalButtons: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', marginTop: 8 },
    titleSaveButton: { backgroundColor: colors.accent, borderRadius: 8, paddingVertical: 10, paddingHorizontal: 22, marginLeft: 8, marginTop: 6 },
    titleSaveText: { color: colors.text, fontSize: 14, fontWeight: '700' },
    modalBackdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.6)',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
    },
    modalSheet: {
      width: '100%',
      maxWidth: 400,
      backgroundColor: colors.card,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      padding: 18,
    },
    modalTitle: { color: colors.text, fontSize: 16, fontWeight: '700', marginBottom: 4 },
    modalSubtitle: { color: colors.muted, fontSize: 13, marginBottom: 14 },
    modalCancel: { alignItems: 'center', paddingVertical: 12, marginTop: 6 },
    modalCancelText: { color: colors.muted, fontSize: 13, fontWeight: '600' },

    deviceRow: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.cardBorder },
    deviceName: { color: colors.text, fontSize: 14, fontWeight: '600' },
    deviceMeta: { color: colors.muted, fontSize: 11, fontFamily: 'monospace', marginTop: 1 },
  });

  return (
    <View style={styles.root}>
      <View style={styles.statusRow}>
        <View style={[styles.statusDot, { backgroundColor: statusColors[status] }]} />
        {connectedDeviceName ? (
          <>
            <Text style={[styles.deviceNameText, { flexShrink: 1 }]} numberOfLines={1}>{connectedDeviceName}</Text>
            <Text style={[styles.statusText, { flexShrink: 0 }]} numberOfLines={1}> · {statusLabels[status]}</Text>
          </>
        ) : (
          <Text style={styles.statusText} numberOfLines={1}>{statusLabels[status]}</Text>
        )}
        {isBusy && <ActivityIndicator size="small" color={colors.muted} style={{ marginLeft: 8 }} />}
        {/* Meter battery (8C C3). Only while a meter is connected and has
            actually answered; red at 20% or below (same threshold the
            vendor app warns at), green otherwise. A bolt means the meter
            reports it's charging. */}
        {battery && status !== 'disconnected' && (
          <View style={styles.batteryWrap} accessibilityLabel={`Meter battery ${battery.percent} percent${battery.charging ? ', charging' : ''}`}>
            <View style={[styles.batteryBody, { borderColor: battery.percent <= 20 ? colors.danger : colors.accent }]}>
              <View
                style={{
                  width: `${Math.max(0, Math.min(100, battery.percent))}%`,
                  height: '100%',
                  backgroundColor: battery.percent <= 20 ? colors.danger : colors.accent,
                  borderRadius: 1,
                }}
              />
            </View>
            <View style={[styles.batteryNub, { backgroundColor: battery.percent <= 20 ? colors.danger : colors.accent }]} />
            <Text style={[styles.batteryText, { color: battery.percent <= 20 ? colors.danger : colors.accent }]}>
              {battery.charging ? '⚡' : ''}
              {battery.percent}%
            </Text>
          </View>
        )}
        {/* Only shows up when the meter currently connected was one of
            SEVERAL matches the last scan found -- lets you reopen that same
            list and pick a different one without a fresh scan or having to
            disconnect first yourself (onSelectDevice below disconnects the
            current meter before connecting to whichever one you pick). */}
        {canSwitchMeters && (
          <TouchableOpacity
            onPress={onOpenDevicePicker}
            style={styles.switchMeterButton}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={styles.switchMeterIcon}>⇄</Text>
            <Text style={styles.switchMeterText}>Switch meter</Text>
          </TouchableOpacity>
        )}
        <Text style={styles.versionTiny}>v{APP_VERSION}</Text>
      </View>

      {/* Always rendered, whether or not a reading (or even a connection)
          exists yet -- using an all-zero placeholder result/analysis when
          there's no real one (see placeholderReading.ts). That's what
          keeps everything below -- the stat grid, the three swipeable
          charts, and the action button right under them -- in the exact
          same layout from the very first time this tab is shown, rather
          than the shorter pre-reading layout that used to put Take
          Reading/Disconnect ABOVE this card and then move them below it
          (in a second copy) the moment a result came in. */}
      <View style={styles.resultCard}>
        <View style={styles.statGrid}>
          {/* Which measurements show here, and in what order, is the
              person's own choice from Settings (statIds, already
              resolved to just the enabled ids in display order -- see
              storage/statDisplayPrefs.ts). CCT/Ra/R9/Duv/Rf/Rg/x/y/R1-15
              are all spectrum-derived (analyzeSpectrum, hCRI.io's own
              ported algorithm) -- never the device's onboard fields.
              Lux is the one exception: hCRI.io's own math has no
              illuminance output to port (it isn't a CIE 13.3/CCT
              quantity), so it's still whatever the device itself
              reported -- format() returns null on models that don't
              report it (see the 330Pro offset map in protocol.ts),
              which is why a tile is skipped rather than shown as a
              dash: the person asked to see it, there's just nothing to
              show for this particular meter. displayResult/displayAnalysis
              are 0 for every field until a real reading exists, so every
              tile just reads "0" until then. */}
          {visibleStats.map(({ id, metric, out }) => (
            <StatCard key={id} label={metric.label} value={out.value} unit={out.unit} compact density={density} />
          ))}
        </View>
        {/* resultCard (below) wraps this in its own padding: 14 AND
            borderWidth: 1 each side (30px combined) -- SpectrumTab/
            SwipablePages/the charts all otherwise only know about the
            screen's own 16-each-side scroll padding, which used to make
            every chart on THIS tab render wider than the real room
            resultCard leaves for it. Confirmed 2026-10-03: this was
            passing 28 (padding only) for a long time, which undercounts
            resultCard's own 1px border by 2px combined -- a smaller
            version of the exact bug SpectrumTab.tsx's CARD_PADDING had
            for its own chartCard/chromCard, just one level further out,
            and the reason charts still looked clipped on the right after
            CARD_PADDING alone was fixed. See SpectrumTab.tsx's
            extraHorizontalChrome comment. */}
        <View style={styles.chartRegion} onLayout={(e) => setChartRegionH(Math.floor(e.nativeEvent.layout.height))}>
          <SpectrumTab result={displayResult} analysis={displayAnalysis} extraHorizontalChrome={30} regionHeight={chartRegionH} sampleLabel={result?.sampleLabel} flicker={flicker} pagerResetKey={pagerResetKey} />
        </View>
        {!hasReading && <View style={[styles.titleInputWrap, { opacity: 0 }]} />}
        {hasReading && (
          <TouchableOpacity
            style={styles.titleInputWrap}
            activeOpacity={result?.sampleLabel ? 1 : 0.7}
            onPress={() => {
              if (result?.sampleLabel) return;
              setTitleDraft(uploadTitle);
              setTitleModalVisible(true);
            }}
            accessibilityRole="button"
            accessibilityLabel="Upload title. Tap to edit."
          >
            <Text
              style={[styles.titleInputOverlay, uploadTitle.length > 0 && styles.titleTextSet]}
              numberOfLines={2}
              ellipsizeMode="tail"
            >
              {uploadTitle.length > 0 ? uploadTitle : defaultLabel(cachedUsername, displayResult.deviceName)}
            </Text>
          </TouchableOpacity>
        )}

      </View>

      {/* Title editor: a popup at the top of the screen instead of typing into the
          box in place, so the keyboard can never cover it and the charts
          never resize while typing. */}
      <Modal
        visible={titleModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setTitleModalVisible(false)}
        // autoFocus alone often doesn't raise the keyboard inside an Android
        // Modal; focusing explicitly once it's on screen does.
        onShow={() => {
          setTimeout(() => (titleInputRef.current as any)?.focus(), 150);
        }}
      >
        <View style={styles.titleModalBackdrop}>
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>Upload title</Text>
            <Text style={styles.modalSubtitle}>Leave it empty to use the default.</Text>
            <TextInput
              ref={titleInputRef}
              style={styles.titleModalInput}
              value={titleDraft}
              onChangeText={setTitleDraft}
              placeholder={defaultLabel(cachedUsername, displayResult.deviceName)}
              placeholderTextColor={colors.muted}
              multiline
              autoCapitalize="none"
              autoCorrect={false}
              submitBehavior="blurAndSubmit"
              returnKeyType="done"
              onSubmitEditing={() => {
                onUploadTitleChange(titleDraft.trim());
                setTitleModalVisible(false);
              }}
            />
            <View style={styles.titleModalButtons}>
              <TouchableOpacity style={styles.modalCancel} onPress={() => setTitleModalVisible(false)}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.titleSaveButton}
                onPress={() => {
                  onUploadTitleChange(titleDraft.trim());
                  setTitleModalVisible(false);
                }}
              >
                <Text style={styles.titleSaveText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Opens right after connect()'s scan finds more than one matching
          meter, or later via the "switch meter" icon above -- a plain
          Modal overlay rather than a page of its own, since picking a
          device is a brief, one-off interruption, not a destination you
          navigate to. Dismissing (backdrop tap or Cancel) just closes the
          overlay: if this came from a fresh Connect tap with nothing
          connected yet, that leaves the attempt exactly where
          resetStaleConnection()/the scan already left it, free to tap
          Connect again; if it came from the switch-meter icon, the
          existing connection is untouched. */}
      <Modal
        visible={devicePickerVisible}
        transparent
        animationType="fade"
        onRequestClose={onDismissDevicePicker}
      >
        <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={onDismissDevicePicker}>
          {/* Swallows the backdrop's onPress so tapping the sheet itself
              doesn't also dismiss it -- a plain nested View would still let
              the touch bubble up to the TouchableOpacity behind it. */}
          <TouchableOpacity style={styles.modalSheet} activeOpacity={1} onPress={() => {}}>
            <Text style={styles.modalTitle}>More than one meter found</Text>
            <Text style={styles.modalSubtitle}>Pick which one to connect to.</Text>
            {(devicePickerDevices ?? []).map((d) => (
              <TouchableOpacity
                key={d.id}
                style={styles.deviceRow}
                onPress={() => onSelectDevice(d.id)}
                activeOpacity={0.6}
              >
                <Text style={styles.deviceName}>{d.name ?? '(unnamed)'}</Text>
                <Text style={styles.deviceMeta}>
                  {d.id} · {d.rssi ?? '?'} dBm
                </Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={styles.modalCancel} onPress={onDismissDevicePicker}>
              <Text style={styles.modalCancelText}>Cancel</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}
