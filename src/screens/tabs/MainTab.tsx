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

import React from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, Modal, StyleSheet } from 'react-native';
import PrimaryButton from '../../components/PrimaryButton';
import StatCard from '../../components/StatCard';
import SpectrumTab from './SpectrumTab';
import { statusLabels } from '../../theme';
import { useTheme } from '../../contexts/ThemeContext';
import { MeterResult } from '../../ble/parseResult';
import { SpectralAnalysis } from '../../utils/spectralAnalysis';
import { STAT_METRIC_BY_ID } from '../../utils/statMetrics';
import { HCRI_BRAND_HOST } from '../../hcri/buildTarget';

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
}

export default function MainTab({
  status,
  isBusy,
  result,
  analysis,
  connect,
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
  statIds,
  connectedDeviceName,
}: Props) {
  const { colors, statusColors } = useTheme();
  const canSwitchMeters = status === 'connected' && (devicePickerDevices?.length ?? 0) > 1;

  const styles = StyleSheet.create({
    statusRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
    resetLink: { alignItems: 'center', paddingVertical: 8 },
    resetLinkText: { color: colors.muted, fontSize: 12 },
    statusDot: { width: 8, height: 8, borderRadius: 4, marginRight: 8 },
    statusText: { color: colors.muted, fontSize: 14 },
    deviceNameText: { color: colors.text, fontSize: 14, fontWeight: '600' },

    switchMeterButton: { flexDirection: 'row', alignItems: 'center', marginLeft: 12 },
    switchMeterIcon: { color: colors.info, fontSize: 14, marginRight: 4 },
    switchMeterText: { color: colors.info, fontSize: 12, fontWeight: '600' },

    resultCard: {
      backgroundColor: colors.card,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      padding: 14,
      marginTop: 16,
    },
    statGrid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -5, marginBottom: 2 },
    customizeHint: { color: colors.mutedFaint, fontSize: 10.5, marginBottom: 10, textAlign: 'center' },

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
    <View>
      <View style={styles.statusRow}>
        <View style={[styles.statusDot, { backgroundColor: statusColors[status] }]} />
        {connectedDeviceName ? (
          <Text style={styles.statusText}>
            <Text style={styles.deviceNameText}>{connectedDeviceName}</Text> · {statusLabels[status]}
          </Text>
        ) : (
          <Text style={styles.statusText}>{statusLabels[status]}</Text>
        )}
        {isBusy && <ActivityIndicator size="small" color={colors.muted} style={{ marginLeft: 8 }} />}
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
      </View>

      {status === 'disconnected' && (
        <>
          <PrimaryButton title="Connect to Meter" onPress={connect} />
          {/* Troubleshooting for "meter won't reconnect after I reloaded the
              app without disconnecting it first" -- normally required a
              power cycle. connect() already tries this automatically, but a
              visible manual retry is worth having when it doesn't help on
              the first try. */}
          <TouchableOpacity onPress={resetConnection} style={styles.resetLink}>
            <Text style={styles.resetLinkText}>Meter won't connect? Reset connection</Text>
          </TouchableOpacity>
        </>
      )}
      {/* Take Reading/Disconnect render here, at the top, only while there's
          no reading yet to put them "under" -- right after connecting, for
          instance. Once a result exists, the same two buttons render below
          the result card instead (see after resultCard), so the
          measurements are the first thing you see rather than having to
          scroll past the buttons to get to them. */}
      {status === 'connected' && !(result && analysis) && (
        <>
          <PrimaryButton title="Take Reading" onPress={measure} />
          <PrimaryButton title="Disconnect" onPress={disconnect} variant="muted" />
        </>
      )}
      {(status === 'connecting' || status === 'measuring') && (
        <PrimaryButton title={status === 'connecting' ? 'Connecting…' : 'Measuring…'} onPress={() => {}} disabled />
      )}

      {result && analysis && (
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
                show for this particular meter. */}
            {statIds.map((id) => {
              const metric = STAT_METRIC_BY_ID[id];
              if (!metric) return null;
              const out = metric.format(result, analysis);
              if (!out) return null;
              return <StatCard key={id} label={metric.label} value={out.value} unit={out.unit} compact />;
            })}
          </View>
          <Text style={styles.customizeHint}>
            Tap ⚙ Settings to customize which measurements show here, and in what order.
          </Text>
          {/* resultCard (below) wraps this in its own padding: 14 each
              side -- SpectrumTab/SwipablePages/the charts all otherwise
              only know about the screen's own 16-each-side scroll
              padding, which used to make every chart on THIS tab render
              28px wider than the real room resultCard leaves for it --
              see SpectrumTab.tsx's extraHorizontalChrome comment. */}
          {result.spectrum.length > 0 && (
            <SpectrumTab result={result} analysis={analysis} extraHorizontalChrome={28} />
          )}
          {/* Take Reading (the green/accent button) comes first here --
              Upload sits right below it rather than above, since taking
              another reading is the more likely next action right after
              looking at this one. */}
          {status === 'connected' && <PrimaryButton title="Take Reading" onPress={measure} />}
          <PrimaryButton
            title={`Upload to ${HCRI_BRAND_HOST}`}
            onPress={onUpload}
            disabled={uploading}
            variant="muted"
          />
          {status === 'connected' && <PrimaryButton title="Disconnect" onPress={disconnect} variant="muted" />}
        </View>
      )}

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
