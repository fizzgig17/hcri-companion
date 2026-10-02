// src/screens/SettingsScreen.tsx
//
// hCRI.io username + API token entry, backed by secureStorage (Keystore/
// Keychain), not plaintext -- unlike the ESP32 firmware's NVS storage.

import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, Switch, StyleSheet, Alert } from 'react-native';
import PrimaryButton from '../components/PrimaryButton';
import {
  loadHcriCredentials,
  saveHcriCredentials,
  clearHcriCredentials,
} from '../storage/secureStorage';
import { loadKeepAwakePreference, saveKeepAwakePreference } from '../storage/preferences';
import { maskSecret } from '../utils/maskSecret';
import { colors } from '../theme';

export default function SettingsScreen() {
  const [username, setUsername] = useState('');
  const [token, setToken] = useState('');
  const [hasSaved, setHasSaved] = useState(false);
  // What's actually loaded right now, shown read-only (see maskedToken
  // below) -- separate from `token` above, which is only ever the NEW
  // value being typed in to replace it (see the hasSaved-gated fields
  // below: the two are never shown/editable at the same time).
  const [loadedToken, setLoadedToken] = useState('');
  const [keepAwake, setKeepAwake] = useState(false);

  useEffect(() => {
    loadHcriCredentials().then((creds) => {
      if (creds) {
        setUsername(creds.username);
        setLoadedToken(creds.token);
        setHasSaved(true);
        // The token field itself is intentionally not pre-filled -- same
        // masking spirit as the ESP32 provisioning page, which only showed
        // the last few characters of a saved token, never the full value.
        // (The masked first10...last10 below is the "which key is this"
        // check that replaces needing to see the full value.)
      }
    });
    loadKeepAwakePreference().then(setKeepAwake);
    // Intentionally run once on mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleKeepAwake = async (value: boolean) => {
    // Update the toggle immediately rather than waiting on the write to
    // resolve -- same "feel instant" reasoning as HomeScreen's disconnect().
    // HomeScreen reads this preference itself (on connect/disconnect) via
    // loadKeepAwakePreference(), not from this component's state, so it
    // picks up the new value the next time it checks -- it doesn't need to
    // be told about this change directly.
    setKeepAwake(value);
    await saveKeepAwakePreference(value);
  };

  const save = async () => {
    if (!username.trim() || !token.trim()) {
      Alert.alert('Both fields are required');
      return;
    }
    await saveHcriCredentials({ username: username.trim(), token: token.trim() });
    setToken('');
    setHasSaved(true);
    Alert.alert('Saved');
  };

  const forget = async () => {
    await clearHcriCredentials();
    setUsername('');
    setToken('');
    setLoadedToken('');
    setHasSaved(false);
  };

  return (
    <View style={styles.container}>
      {hasSaved ? (
        // Locked view: credentials are already saved, so the fields are
        // read-only and there's no Save button here at all -- "Forget
        // Credentials" is the only way back to an editable form. Without
        // this, it was possible to fat-finger a character in the token
        // field and silently overwrite a working key with a broken one
        // (no confirmation, no way to tell beforehand), with no record of
        // what the old value even was. Forcing a deliberate clear first
        // makes replacing a key a two-step, harder-to-do-by-accident
        // action, same spirit as the ESP32 provisioning flow.
        <>
          <Text style={styles.label}>hCRI.io Username</Text>
          <View style={styles.lockedField}>
            <Text style={styles.lockedFieldText}>{username}</Text>
          </View>

          <Text style={styles.label}>hCRI.io API Token (currently loaded)</Text>
          <View style={styles.lockedField}>
            <Text style={styles.lockedFieldText}>{maskSecret(loadedToken)}</Text>
          </View>
          <Text style={styles.hint}>
            To use a different account or key, forget the current credentials first.
          </Text>

          <View style={styles.saveButtonWrap}>
            <PrimaryButton title="Forget Credentials" onPress={forget} variant="danger" style={styles.noTopMargin} />
          </View>
        </>
      ) : (
        <>
          <Text style={styles.label}>hCRI.io Username</Text>
          <TextInput
            style={styles.input}
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
            placeholder="username"
            placeholderTextColor="#666"
          />

          <Text style={styles.label}>hCRI.io API Token</Text>
          <TextInput
            style={styles.input}
            value={token}
            onChangeText={setToken}
            autoCapitalize="none"
            secureTextEntry
            placeholder="hcri_..."
            placeholderTextColor="#666"
          />

          <View style={styles.saveButtonWrap}>
            <PrimaryButton title="Save" onPress={save} style={styles.noTopMargin} />
          </View>
        </>
      )}

      <View style={styles.toggleRow}>
        <View style={styles.toggleTextWrap}>
          <Text style={styles.toggleLabel}>Keep screen awake while connected</Text>
          <Text style={styles.toggleHint}>
            Prevents the screen from locking during a session with the meter connected. Uses more battery.
          </Text>
        </View>
        <Switch value={keepAwake} onValueChange={toggleKeepAwake} trackColor={{ true: colors.accent }} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#111', padding: 16 },
  label: { color: '#999', marginTop: 14, marginBottom: 6 },
  input: {
    backgroundColor: '#1c1c1c',
    color: '#eee',
    padding: 11,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#333',
  },
  // Visually distinct from `input` (no editable-looking border/background)
  // so it reads as "locked display", not just a disabled text field.
  lockedField: {
    backgroundColor: '#161618',
    padding: 11,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2a2a2e',
  },
  lockedFieldText: { color: '#bbb', fontFamily: 'monospace' },
  hint: { color: '#777', fontSize: 12, marginTop: 10, lineHeight: 16 },
  // Provides the gap above the Save button; noTopMargin below cancels out
  // PrimaryButton's own default marginTop so it doesn't stack on top of this.
  saveButtonWrap: { marginTop: 18 },
  noTopMargin: { marginTop: 0 },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 28,
    paddingTop: 20,
    borderTopWidth: 1,
    borderTopColor: '#2a2a2e',
  },
  toggleTextWrap: { flex: 1, marginRight: 12 },
  toggleLabel: { color: '#eee', fontSize: 14, fontWeight: '600', marginBottom: 4 },
  toggleHint: { color: '#999', fontSize: 12, lineHeight: 16 },
});
