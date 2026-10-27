// src/screens/tabs/UpdateTab.tsx -- Settings > Update: current version, check, open the Play Store listing.

import React from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Platform } from 'react-native';
import { useTheme } from '../../contexts/ThemeContext';
import { useUpdate } from '../../contexts/UpdateContext';
import { APP_VERSION } from '../../buildInfo';
import PrimaryButton from '../../components/PrimaryButton';
import { IS_DEV_BUILD } from '../../hcri/buildTarget';
import { GIT_COMMIT } from '../../gitCommit';
import { useDevBuild } from '../../contexts/DevBuildContext';

// Dev builds only: compares this install's commit with the newest published dev APK.
function DevBuildCard() {
  const { colors } = useTheme();
  const { status, latest, error, check, update } = useDevBuild();
  const s = StyleSheet.create({
    card: { backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.cardBorder, padding: 16, marginTop: 12 },
    title: { color: colors.text, fontSize: 16, fontWeight: '700' },
    line: { color: colors.muted, fontSize: 13, marginTop: 4, fontFamily: 'monospace' },
    msg: { color: colors.text, fontSize: 14, marginTop: 12 },
  });
  const msg =
    status === 'checking' ? 'Checking for a newer dev build…'
    : status === 'newer' ? 'A different dev build is available.'
    : status === 'current' ? 'This is the latest dev build.'
    : status === 'error' ? `Couldn't check: ${error ?? ''}`
    : '';
  return (
    <View style={s.card}>
      <Text style={s.title}>Dev build</Text>
      <Text style={s.line}>Installed: {GIT_COMMIT}</Text>
      <Text style={s.line}>Latest:    {latest ?? '—'}</Text>
      {!!msg && <Text style={s.msg}>{msg}</Text>}
      {status === 'newer' ? (
        <PrimaryButton title="Update Dev Build" onPress={update} />
      ) : (
        <PrimaryButton title={status === 'checking' ? 'Checking…' : 'Check Dev Build'} onPress={check} disabled={status === 'checking'} variant="outline" />
      )}
    </View>
  );
}

export default function UpdateTab() {
  const { colors } = useTheme();
  const { status, error, detail, check, install, restartToUpdate, installState, progress } = useUpdate();
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
      ? (Platform.OS === 'ios' ? 'Checking for a newer version…' : 'Checking Google Play…')
      : status === 'available'
        ? 'A new version is available.'
        : status === 'uptodate'
          ? "You're up to date."
          : status === 'error'
            ? "Couldn't check for updates."
            : '';

  return (
    <>
    <View style={styles.card}>
      <Text style={styles.title}>App updates</Text>
      <Text style={styles.version}>Installed version: v{APP_VERSION}</Text>
      <View style={styles.row}>
        {status === 'checking' && <ActivityIndicator size="small" color={colors.muted} style={{ marginRight: 8 }} />}
        <Text style={[styles.status, { marginTop: 0 }]}>{message}</Text>
      </View>
      {!!detail && status !== 'error' && <Text style={styles.note}>{detail}</Text>}
      {status === 'error' && Platform.OS === 'ios' && <Text style={styles.note}>{`${error ?? ''} Updates are installed through TestFlight.`}</Text>}
      {status === 'error' && Platform.OS !== 'ios' && (
        <Text style={styles.note}>
          {notFromPlay
            ? "This copy of the app wasn't installed from Google Play, so Play can't check it. Updates come through Google Play (including the testing track)."
            : `${error ?? ''} Updates come through Google Play, so this only works on an install from the Play Store.`}
        </Text>
      )}
      {/* One button: "Update now" once Play has a newer version (downloads in the background, then Restart), else "Check for updates". */}
      {installState === 'ready' ? (
        <PrimaryButton title="Restart to finish updating" onPress={restartToUpdate} />
      ) : installState === 'downloading' ? (
        <PrimaryButton title={`Downloading update${progress > 0 ? ` ${Math.round(progress * 100)}%` : '…'}`} onPress={() => {}} disabled />
      ) : status === 'available' ? (
        <PrimaryButton title={Platform.OS === 'ios' ? 'Open in TestFlight' : 'Update now'} onPress={install} />
      ) : (
        <PrimaryButton title={status === 'checking' ? 'Checking…' : 'Check for updates'} onPress={() => check(false)} disabled={status === 'checking'} variant="outline" />
      )}
    </View>
    {IS_DEV_BUILD && <DevBuildCard />}
    </>
  );
}
