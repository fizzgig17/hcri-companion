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
import { ThemeMode } from '../theme';

const KEEP_AWAKE_KEY = 'hcri.io.pref.keepAwakeWhileConnected';

export async function loadKeepAwakePreference(): Promise<boolean> {
  const raw = await AsyncStorage.getItem(KEEP_AWAKE_KEY);
  return raw === 'true';
}

export async function saveKeepAwakePreference(enabled: boolean): Promise<void> {
  await AsyncStorage.setItem(KEEP_AWAKE_KEY, enabled ? 'true' : 'false');
}

const HAPTICS_KEY = 'hcri.io.pref.hapticFeedback';

// Default ON: only an explicit 'false' turns button/result haptics off.
export async function loadHapticsPreference(): Promise<boolean> {
  const raw = await AsyncStorage.getItem(HAPTICS_KEY);
  return raw !== 'false';
}

export async function saveHapticsPreference(enabled: boolean): Promise<void> {
  await AsyncStorage.setItem(HAPTICS_KEY, enabled ? 'true' : 'false');
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

// Default ON ("stay connected") -- a backgrounded app (switching briefly
// to check something else, a screen lock, an incoming call) used to always
// drop the BLE link, which meant a full re-scan/re-handshake on every
// single return trip even for a few-second trip away. Most of the time
// that's not actually "the person is done with this session," so staying
// connected is the better default; flipping this off in Settings restores
// the original disconnect-on-background behavior (and its battery
// savings) for anyone who'd rather have that. See HomeScreen.tsx's
// AppState effect for where this is actually read.
const STAY_CONNECTED_IN_BACKGROUND_KEY = 'hcri.io.pref.stayConnectedInBackground';

export async function loadStayConnectedInBackgroundPreference(): Promise<boolean> {
  const raw = await AsyncStorage.getItem(STAY_CONNECTED_IN_BACKGROUND_KEY);
  // No stored value yet (fresh install, or a build from before this
  // setting existed) -- default true, not the usual "missing means off"
  // reading the other preferences in this file use, since true is the
  // behavior this setting is supposed to default to (see the comment
  // above).
  return raw === null ? true : raw === 'true';
}

export async function saveStayConnectedInBackgroundPreference(enabled: boolean): Promise<void> {
  await AsyncStorage.setItem(STAY_CONNECTED_IN_BACKGROUND_KEY, enabled ? 'true' : 'false');
}

// Defaults to 'system' -- a fresh install should follow the phone's own
// light/dark setting rather than forcing dark (this app's original, only
// look) on someone whose phone is set to light mode. Light and Dark are
// still there to override that per ThemeContext.tsx.
const THEME_MODE_KEY = 'hcri.io.pref.themeMode';

export async function loadThemeModePreference(): Promise<ThemeMode> {
  const raw = await AsyncStorage.getItem(THEME_MODE_KEY);
  return raw === 'light' || raw === 'dark' ? raw : 'system';
}

export async function saveThemeModePreference(mode: ThemeMode): Promise<void> {
  await AsyncStorage.setItem(THEME_MODE_KEY, mode);
}
