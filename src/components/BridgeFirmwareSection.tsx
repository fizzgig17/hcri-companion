// src/components/BridgeFirmwareSection.tsx
//
// Settings > Bridge: update the ESP32 bridge's firmware over Bluetooth. The work is MeterConnection's updateBridgeFirmware();
// this is the button, the progress and the result. The app makes its own connection to the bridge (it lets go of the one it
// has open first), so the bridge does not need an instrument plugged in.

import React, { useRef, useState } from 'react';
import { View, Text, Alert, StyleSheet } from 'react-native';
import PrimaryButton from './PrimaryButton';
import { useTheme } from '../contexts/ThemeContext';
import { useLog } from '../contexts/LogContext';
import { IS_DEV_BUILD } from '../hcri/buildTarget';
import { updateBridgeFirmware, type BridgeUpdateResult } from '../ble/MeterConnection';

export default function BridgeFirmwareSection() {
  const { colors } = useTheme();
  const { appendLog } = useLog();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [pct, setPct] = useState<number | undefined>(undefined);
  const [result, setResult] = useState<BridgeUpdateResult | null>(null);
  const cancel = useRef({ requested: false });

  const run = async () => {
    cancel.current = { requested: false };
    setResult(null);
    setPct(undefined);
    setStatus('Starting…');
    setBusy(true);
    try {
      const r = await updateBridgeFirmware({
        dev: IS_DEV_BUILD,
        log: appendLog,
        cancel: cancel.current,
        onStatus: (text, p) => { setStatus(text); setPct(p); },
      });
      appendLog(`Bridge firmware update: ${r.outcome} -- ${r.message}`);
      setResult(r);
    } finally {
      setBusy(false);
      setStatus('');
      setPct(undefined);
    }
  };

  const confirm = () =>
    Alert.alert(
      'Update bridge firmware',
      `The app connects to the bridge over Bluetooth, downloads the latest ${IS_DEV_BUILD ? 'development' : 'released'} firmware (about 0.7 MB) and sends it. It takes a minute or two.\n\nKeep the phone close and leave the bridge powered until it restarts. If anything goes wrong, the bridge keeps its current firmware.`,
      [{ text: 'Cancel', style: 'cancel' }, { text: 'Update', onPress: run }]
    );

  const styles = StyleSheet.create({
    wrap: { marginTop: 14 },
    label: { color: colors.text, fontSize: 15, fontWeight: '600' },
    help: { color: colors.muted, fontSize: 13, marginTop: 4, lineHeight: 18 },
    status: { color: colors.text, fontSize: 14, marginTop: 10 },
    barTrack: { height: 8, borderRadius: 4, backgroundColor: colors.cardBorder, marginTop: 8, overflow: 'hidden' },
    barFill: { height: 8, backgroundColor: colors.accent },
    ok: { color: colors.text, fontSize: 14, marginTop: 10 },
    bad: { color: colors.danger, fontSize: 14, marginTop: 10 },
  });

  const good = result && (result.outcome === 'updated' || result.outcome === 'uptodate');
  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>Bridge firmware</Text>
      <Text style={styles.help}>
        Updates the ESP32 bridge over Bluetooth, with no cable. Power the bridge on, keep the phone close, and tap Update. The app
        installs the newest {IS_DEV_BUILD ? 'development' : 'released'} firmware and checks it afterwards. A bridge flashed before
        this existed needs one flash from a computer first (see the ESP32 bridge page on hcri.io).
      </Text>
      {busy ? (
        <>
          <Text style={styles.status}>{status}</Text>
          {pct !== undefined && (
            <View style={styles.barTrack}>
              <View style={[styles.barFill, { width: `${Math.max(0, Math.min(100, pct))}%` }]} />
            </View>
          )}
          <PrimaryButton title="Cancel update" variant="outline" onPress={() => { cancel.current.requested = true; setStatus('Cancelling…'); }} />
        </>
      ) : (
        <PrimaryButton title="Update bridge firmware" variant="outline" onPress={confirm} />
      )}
      {result && <Text style={good ? styles.ok : styles.bad}>{result.message}</Text>}
    </View>
  );
}
