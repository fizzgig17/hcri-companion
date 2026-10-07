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

  // Play's own wording for a sideloaded install: ERROR_APP_NOT_OWNED (-10).
  const notFromPlay = !!error && (error.includes('NOT_OWNED') || error.includes('-10'));

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
          {notFromPlay
            ? "This copy of the app wasn't installed from Google Play, so Play can't check it. Updates come through Google Play (including the testing track)."
            : `${error ?? ''} Updates come through Google Play, so this only works on an install from the Play Store.`}
        </Text>
      )}
      {/* One button: "Update now" once Play has a newer version, else "Check for updates".
          A check made here only updates this text; the top banner is for the launch check. */}
      {status === 'available' ? (
        <PrimaryButton title="Update now" onPress={startUpdate} />
      ) : (
        <PrimaryButton title={status === 'checking' ? 'Checking…' : 'Check for updates'} onPress={() => check(false)} disabled={status === 'checking'} variant="outline" />
      )}
    </View>
  );
}
