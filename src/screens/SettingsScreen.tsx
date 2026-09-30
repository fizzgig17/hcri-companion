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
import { colors } from '../theme';

export default function SettingsScreen() {
  const [username, setUsername] = useState('');
  const [token, setToken] = useState('');
  const [hasSaved, setHasSaved] = useState(false);
  const [keepAwake, setKeepAwake] = useState(false);

  useEffect(() => {
    loadHcriCredentials().then((creds) => {
      if (creds) {
        setUsername(creds.username);
        setHasSaved(true);
        // Token is intentionally not pre-filled in the field -- same
        // masking spirit as the ESP32 provisioning page, which only showed
        // the last few characters of a saved token, never the full value.
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
    setHasSaved(false);
  };

  return (
    <View style={styles.container}>
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
        placeholder={hasSaved ? 'Saved -- enter new value to replace' : 'hcri_...'}
        placeholderTextColor="#666"
      />

      <View style={styles.saveButtonWrap}>
        <PrimaryButton title="Save" onPress={save} style={styles.noTopMargin} />
      </View>
      {hasSaved && <PrimaryButton title="Forget Credentials" onPress={forget} variant="danger" />}

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
