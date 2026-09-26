// src/screens/HomeScreen.tsx
//
// Main screen: connect to the meter, trigger a measurement, show the
// results (CCT, Ra, Lux, spectrum), and upload to hCRI.io.

import React, { useCallback, useRef, useState } from 'react';
import {
  View,
  Text,
  Button,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { MeterConnection } from '../ble/MeterConnection';
import { initializeMeter, takeMeasurement } from '../ble/takeMeasurement';
import { MeterResult } from '../ble/parseResult';
import { buildCsv, defaultLabel } from '../hcri/buildCsv';
import { uploadToHcri } from '../hcri/uploadToHcri';
import { loadHcriCredentials } from '../storage/secureStorage';

type Status = 'disconnected' | 'connecting' | 'connected' | 'measuring' | 'uploading';

export default function HomeScreen({ navigation }: any) {
  const [status, setStatus] = useState<Status>('disconnected');
  const [result, setResult] = useState<MeterResult | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const connRef = useRef<MeterConnection | null>(null);

  const appendLog = useCallback((msg: string) => {
    setLog((prev) => [...prev.slice(-99), msg]);
  }, []);

  const connect = useCallback(async () => {
    setStatus('connecting');
    try {
      const conn = new MeterConnection(appendLog);
      await conn.scanAndConnect();
      await initializeMeter(conn);
      connRef.current = conn;
      setStatus('connected');
    } catch (e: any) {
      appendLog(`Connect failed: ${e.message}`);
      setStatus('disconnected');
    }
  }, [appendLog]);

  const measure = useCallback(async () => {
    if (!connRef.current) return;
    setStatus('measuring');
    try {
      const r = await takeMeasurement(connRef.current, appendLog);
      setResult(r);
      setStatus('connected');
    } catch (e: any) {
      appendLog(`Measurement failed: ${e.message}`);
      setStatus('connected');
    }
  }, [appendLog]);

  const upload = useCallback(async () => {
    if (!result) return;
    const creds = await loadHcriCredentials();
    if (!creds) {
      Alert.alert('No hCRI.io account set up', 'Add your username and API token first.', [
        { text: 'Go to Settings', onPress: () => navigation.navigate('Settings') },
        { text: 'Cancel', style: 'cancel' },
      ]);
      return;
    }

    setStatus('uploading');
    const csv = buildCsv(result);
    const label = defaultLabel(creds.username);
    const res = await uploadToHcri(csv, label, creds.token);
    appendLog(res.message);
    Alert.alert(res.success ? 'Uploaded' : 'Upload failed', res.message);
    setStatus('connected');
  }, [result, navigation, appendLog]);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>HPCS-330P</Text>
      <Text style={styles.status}>Status: {status}</Text>

      {status === 'disconnected' && <Button title="Connect" onPress={connect} />}
      {status === 'connecting' && <ActivityIndicator />}
      {status === 'connected' && <Button title="Take Reading" onPress={measure} />}
      {status === 'measuring' && (
        <>
          <ActivityIndicator />
          <Text>Measuring...</Text>
        </>
      )}

      {result && (
        <View style={styles.resultBox}>
          <Text style={styles.resultLine}>CCT: {result.cct.toFixed(0)} K</Text>
          <Text style={styles.resultLine}>Ra: {result.ra.toFixed(1)}</Text>
          <Text style={styles.resultLine}>Lux: {result.lux.toFixed(1)}</Text>
          <Text style={styles.resultLine}>PAR: {result.par.toFixed(3)}</Text>
          <Button title="Upload to hCRI.io" onPress={upload} disabled={status === 'uploading'} />

          <Text style={styles.sectionHeader}>Spectrum ({result.spectrum.length} points)</Text>
          {result.spectrum.slice(0, 20).map((p) => (
            <Text key={p.nm} style={styles.spectrumLine}>
              {p.nm}nm: {p.value.toFixed(4)}
            </Text>
          ))}
          {result.spectrum.length > 20 && (
            <Text style={styles.spectrumLine}>... {result.spectrum.length - 20} more</Text>
          )}
        </View>
      )}

      <Button title="Settings" onPress={() => navigation.navigate('Settings')} />

      <Text style={styles.sectionHeader}>Debug Log</Text>
      {log.map((line, i) => (
        <Text key={i} style={styles.logLine}>
          {line}
        </Text>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#111' },
  content: { padding: 16 },
  title: { fontSize: 22, fontWeight: '700', color: '#eee', marginBottom: 4 },
  status: { color: '#999', marginBottom: 12 },
  resultBox: { marginTop: 16, marginBottom: 16 },
  resultLine: { color: '#eee', fontSize: 16, marginBottom: 2 },
  sectionHeader: { color: '#999', marginTop: 16, marginBottom: 6, fontWeight: '600' },
  spectrumLine: { color: '#aaa', fontSize: 12 },
  logLine: { color: '#666', fontSize: 11, fontFamily: 'monospace' },
});
