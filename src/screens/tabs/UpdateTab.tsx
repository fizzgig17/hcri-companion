// src/screens/tabs/UpdateTab.tsx -- Settings > Update: current version, check, update now.

import React from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { useTheme } from '../../contexts/ThemeContext';
import { useUpdate } from '../../contexts/UpdateContext';
import { APP_VERSION } from '../../buildInfo';
import PrimaryButton from '../../components/PrimaryButton';

export default function UpdateTab() {
  const { colors } = useTheme();
  const { status, error, check, startUpdate } = useUpdate();
  const styles = StyleSheet.create({
    card: { backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.cardBorder, padding: 16 },
    title: { color: colors.text, fontSize: 16, fontWeight: '700' },
    version: { color: colors.muted, fontSize: 13, marginTop: 4 },
    status: { color: colors.text, fontSize: 14, marginTop: 14 },
    note: { color: colors.muted, fontSize: 12, lineHeight: 17, marginTop: 8 },
    row: { flexDirection: 'row', alignItems: 'center', marginTop: 14 },
  });

  const message =
    status === 'checking'
      ? 'Checking Google Play…'
      : status === 'available'
        ? 'A new version is available.'
        : status === 'uptodate'
          ? "You're up to date."
          : status === 'error'
            ? "Couldn't check for updates."
            : '';

  return (
    <View style={styles.card}>
      <Text style={styles.title}>App updates</Text>
      <Text style={styles.version}>Installed version: v{APP_VERSION}</Text>
      <View style={styles.row}>
        {status === 'checking' && <ActivityIndicator size="small" color={colors.muted} style={{ marginRight: 8 }} />}
        <Text style={[styles.status, { marginTop: 0 }]}>{message}</Text>
      </View>
      {status === 'error' && (
        <Text style={styles.note}>
          {error ? `${error} ` : ''}Updates come through Google Play, so this only works on an install from the Play Store
          (including the testing track).
        </Text>
      )}
      {status === 'available' && <PrimaryButton title="Update now" onPress={startUpdate} />}
      <PrimaryButton title="Check for updates" onPress={check} disabled={status === 'checking'} variant="muted" />
    </View>
  );
}
