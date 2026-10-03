// src/storage/preferences.ts
//
// Simple, non-secret app preferences ("keep screen awake while connected"
// -- see SettingsScreen.tsx / keepAwake.ts -- and verbose logging, see
// below). Uses AsyncStorage rather than secureStorage.ts's Keychain
// wrapper: Keychain is for actual secrets (hCRI.io credentials), and a
// plain on/off UI preference doesn't need OS-level secure storage --
// AsyncStorage is the standard, simpler choice for this kind of thing.
// Requires @react-native-async-storage/async-storage (also needed by
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

// Default OFF -- the standard (non-verbose) log already covers most
// troubleshooting (connect/measure milestones, retries, failures). Verbose
// adds the two categories that are rarely needed and can get genuinely
// long: the raw per-notification/per-write BLE hex dumps (MeterConnection.ts)
// and the full raw-result-body hex dump (takeMeasurement.ts), which embeds
// every wavelength's raw bytes. See HomeScreen.tsx's appendLog for where
// this preference is actually applied -- it filters which log lines reach
// the Logs tab / Share Debug Log, not what's passed to console.log, since
// the Metro console is a separate, developer-only audience that already
// sees everything.
const VERBOSE_LOGGING_KEY = 'hcri.io.pref.verboseLogging';

export async function loadVerboseLoggingPreference(): Promise<boolean> {
  const raw = await AsyncStorage.getItem(VERBOSE_LOGGING_KEY);
  return raw === 'true';
}

export async function saveVerboseLoggingPreference(enabled: boolean): Promise<void> {
  await AsyncStorage.setItem(VERBOSE_LOGGING_KEY, enabled ? 'true' : 'false');
}
