// src/screens/SettingsScreen.tsx
//
// hCRI.io username + API token entry, backed by secureStorage (Keystore/
// Keychain), not plaintext -- unlike the ESP32 firmware's NVS storage.

import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, Button, StyleSheet, Alert } from 'react-native';
import {
  loadHcriCredentials,
  saveHcriCredentials,
  clearHcriCredentials,
} from '../storage/secureStorage';

export default function SettingsScreen() {
  const [username, setUsername] = useState('');
  const [token, setToken] = useState('');
  const [hasSaved, setHasSaved] = useState(false);

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
  }, []);

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

      <Button title="Save" onPress={save} />
      {hasSaved && <Button title="Forget Credentials" onPress={forget} color="#c33" />}
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
});
