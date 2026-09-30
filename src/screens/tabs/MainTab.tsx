// src/screens/tabs/MainTab.tsx
//
// The "Main" tab: connection status, Connect/Take Reading/Disconnect at
// the top, the latest reading + spectrum right below it, and the
// nearby-meter scan diagnostic tucked at the bottom (it's a
// troubleshooting tool, not something you need every time). This is
// deliberately the ONLY tab that touches the actual BLE connection
// lifecycle -- Spectrum/Data/Logs are all read-only detail views of
// whatever the last reading was.

import React from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import PrimaryButton from '../../components/PrimaryButton';
import StatCard from '../../components/StatCard';
import SpectrumChart from '../../components/SpectrumChart';
import { colors, statusColors, statusLabels } from '../../theme';
import { MeterResult } from '../../ble/parseResult';
import { SpectralAnalysis } from '../../utils/spectralAnalysis';

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
  scanning: boolean;
  foundDevices: FoundDevice[];
  toggleScan: () => void;
  connectToFoundDevice: (id: string) => void;
  /** Same upload action/state DataTab's "Upload to hCRI.io" button uses --
   * duplicated here so you don't have to switch tabs after taking a
   * reading just to send it. Uses whatever title is currently set on the
   * Data tab (defaults to the same auto-generated label if you haven't
   * typed one); to change the title, that's still done on the Data tab. */
  onUpload: () => void;
  uploading: boolean;
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
  scanning,
  foundDevices,
  toggleScan,
  connectToFoundDevice,
  onUpload,
  uploading,
}: Props) {
  return (
    <View>
      <View style={styles.statusRow}>
        <View style={[styles.statusDot, { backgroundColor: statusColors[status] }]} />
        <Text style={styles.statusText}>{statusLabels[status]}</Text>
        {isBusy && <ActivityIndicator size="small" color={colors.muted} style={{ marginLeft: 8 }} />}
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
      {status === 'connected' && (
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
            {/* CCT/Ra/R9/Duv here are all spectrum-derived (analyzeSpectrum,
                hCRI.io's own ported algorithm) -- never the device's onboard
                fields. Lux is the one exception: hCRI.io's own math has no
                illuminance output to port (it isn't a CIE 13.3/CCT quantity),
                so this is still whatever the device itself reported, same as
                before -- null on models that don't report it (see the 330Pro
                offset map in protocol.ts). */}
            <StatCard label="CCT" value={analysis.cct.toFixed(0)} unit="K" />
            <StatCard label="Ra (CRI)" value={analysis.ra.toFixed(1)} />
            <StatCard label="Lux" value={result.lux !== null ? result.lux.toFixed(0) : '—'} />
            <StatCard label="R9" value={analysis.r9.toFixed(1)} />
            <StatCard label="Duv" value={analysis.duv.toFixed(5)} />
          </View>
          {result.spectrum.length > 0 && <SpectrumChart spectrum={result.spectrum} />}
          <PrimaryButton
            title="Upload to hCRI.io"
            onPress={onUpload}
            disabled={uploading}
            variant="muted"
          />
        </View>
      )}

      <View style={styles.scanCard}>
        <View style={styles.scanHeaderRow}>
          <Text style={styles.scanTitle}>
            Scan for Nearby Meters{foundDevices.length > 0 ? ` (${foundDevices.length})` : ''}
          </Text>
        </View>

        <TouchableOpacity style={styles.scanLink} onPress={toggleScan}>
          <Text style={styles.scanLinkText}>
            {scanning ? 'Scanning… tap to stop' : 'Scan for nearby HPCS devices'}
          </Text>
        </TouchableOpacity>

        {foundDevices.length === 0 && (
          <Text style={styles.deviceMeta}>
            {scanning ? 'Listening for advertisements…' : 'No HPCS devices found yet.'}
          </Text>
        )}

        {foundDevices
          .slice()
          .sort((a, b) => (b.rssi ?? -999) - (a.rssi ?? -999))
          .map((d) => (
            <TouchableOpacity
              key={d.id}
              style={styles.deviceRow}
              onPress={() => connectToFoundDevice(d.id)}
              disabled={isBusy}
              activeOpacity={0.6}
            >
              <Text style={styles.deviceName}>{d.name ?? '(unnamed)'}</Text>
              <Text style={styles.deviceMeta}>
                {d.id} · {d.rssi ?? '?'} dBm · tap to connect
              </Text>
            </TouchableOpacity>
          ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  statusRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  resetLink: { alignItems: 'center', paddingVertical: 8 },
  resetLinkText: { color: colors.muted, fontSize: 12 },
  statusDot: { width: 8, height: 8, borderRadius: 4, marginRight: 8 },
  statusText: { color: colors.muted, fontSize: 14 },

  resultCard: {
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    padding: 14,
    marginTop: 16,
  },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -6, marginBottom: 4 },

  scanCard: {
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    padding: 14,
    marginTop: 16,
  },
  scanHeaderRow: { marginBottom: 4 },
  scanTitle: { color: colors.text, fontSize: 14, fontWeight: '600' },

  scanLink: { alignItems: 'center', paddingVertical: 10, marginTop: 4 },
  scanLinkText: { color: colors.info, fontSize: 13 },

  deviceRow: { paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.cardBorder },
  deviceName: { color: colors.text, fontSize: 14, fontWeight: '600' },
  deviceMeta: { color: colors.muted, fontSize: 11, fontFamily: 'monospace', marginTop: 1 },
});
