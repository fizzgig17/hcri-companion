// src/components/LiveInfoEditor.tsx
//
// "What are you testing?": a name and some details typed by hand, shown on the hCRI.io live page and in the app's Live view,
// and changeable while a run is going. Shown only when Live station is switched on for the account.

import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';
import { useTheme } from '../contexts/ThemeContext';
import { loadHcriCredentials } from '../storage/secureStorage';
import { getLiveStation, liveAction } from '../hcri/liveStation';

export default function LiveInfoEditor({ compact = false }: { compact?: boolean }) {
  const { colors } = useTheme();
  const [token, setToken] = useState<string | null>(null);
  const [on, setOn] = useState(false);
  const [title, setTitle] = useState('');
  const [details, setDetails] = useState('');
  const [saved, setSaved] = useState({ title: '', details: '' });
  const [err, setErr] = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      const creds = await loadHcriCredentials().catch(() => null);
      if (!creds?.token || !alive) return;
      const i = await getLiveStation(creds.token).catch(() => null);
      if (!i || !alive) return;
      setToken(creds.token);
      setOn(i.enabled);
      setTitle(i.info.title);
      setDetails(i.info.details);
      setSaved(i.info);
    })();
    return () => { alive = false; };
  }, []);

  const save = useCallback(async (t: string, d: string) => {
    if (!token || (t === saved.title && d === saved.details)) return;
    try {
      const i = await liveAction(token, { action: 'info', title: t, details: d });
      setSaved(i.info);
      setErr('');
    } catch (e: any) {
      setErr(e?.message ?? 'Could not save.');
    }
  }, [token, saved]);

  if (!on) return null;
  const styles = StyleSheet.create({
    wrap: { marginTop: compact ? 8 : 12 },
    label: { color: colors.muted, fontSize: 12, fontWeight: '700', marginBottom: 6 },
    input: { color: colors.text, borderWidth: 1, borderColor: colors.cardBorder, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontSize: 14, marginBottom: 8 },
    err: { color: colors.danger, fontSize: 12 },
  });
  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>Live station: what you are testing</Text>
      <TextInput accessibilityLabel="Live station name" style={styles.input} value={title} onChangeText={setTitle} onEndEditing={() => save(title.trim(), details.trim())}
        placeholder="Name, e.g. Olight Warrior 3, turbo" placeholderTextColor={colors.mutedFaint} maxLength={160} returnKeyType="done" />
      <TextInput accessibilityLabel="Live station details" style={[styles.input, { minHeight: 64, textAlignVertical: 'top' }]} value={details} onChangeText={setDetails} onEndEditing={() => save(title.trim(), details.trim())}
        placeholder="Details: cell, driver mode, notes (shown live)" placeholderTextColor={colors.mutedFaint} maxLength={2000} multiline />
      {!!err && <Text style={styles.err}>{err}</Text>}
    </View>
  );
}
