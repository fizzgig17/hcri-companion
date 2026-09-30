// src/storage/preferences.ts
//
// Simple, non-secret app preferences (currently just "keep screen awake
// while connected" -- see SettingsScreen.tsx / keepAwake.ts). Uses
// AsyncStorage rather than secureStorage.ts's Keychain wrapper: Keychain is
// for actual secrets (hCRI.io credentials), and a plain on/off UI
// preference doesn't need OS-level secure storage -- AsyncStorage is the
// standard, simpler choice for this kind of thing. Requires
// @react-native-async-storage/async-storage (also needed by
// readingHistory.ts -- see that file for the install command; only needs
// installing once for both).

import AsyncStorage from '@react-native-async-storage/async-storage';

const KEEP_AWAKE_KEY = 'hcri.io.pref.keepAwakeWhileConnected';

export async function loadKeepAwakePreference(): Promise<boolean> {
  const raw = await AsyncStorage.getItem(KEEP_AWAKE_KEY);
  return raw === 'true';
}

export async function saveKeepAwakePreference(enabled: boolean): Promise<void> {
  await AsyncStorage.setItem(KEEP_AWAKE_KEY, enabled ? 'true' : 'false');
}
