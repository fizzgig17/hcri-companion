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

const HAPTIC_TAPS_KEY = 'hcri.io.pref.hapticTaps';
const HAPTIC_RESULTS_KEY = 'hcri.io.pref.hapticResults';

// Both default ON: only an explicit 'false' turns them off.
export async function loadHapticTapsPreference(): Promise<boolean> {
  return (await AsyncStorage.getItem(HAPTIC_TAPS_KEY)) !== 'false';
}
export async function saveHapticTapsPreference(enabled: boolean): Promise<void> {
  await AsyncStorage.setItem(HAPTIC_TAPS_KEY, enabled ? 'true' : 'false');
}
export async function loadHapticResultsPreference(): Promise<boolean> {
  return (await AsyncStorage.getItem(HAPTIC_RESULTS_KEY)) !== 'false';
}
export async function saveHapticResultsPreference(enabled: boolean): Promise<void> {
  await AsyncStorage.setItem(HAPTIC_RESULTS_KEY, enabled ? 'true' : 'false');
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

// Developer builds only (Settings -> Test report number): which public hCRI.io report "Show a test reading" loads.
// Empty = a random one.
const TEST_REPORT_ID_KEY = 'hcri.io.pref.testReportId';

export async function loadTestReportIdPreference(): Promise<string> {
  return (await AsyncStorage.getItem(TEST_REPORT_ID_KEY)) ?? '';
}

export async function saveTestReportIdPreference(value: string): Promise<void> {
  const digits = value.replace(/\D/g, '');
  if (digits) await AsyncStorage.setItem(TEST_REPORT_ID_KEY, digits);
  else await AsyncStorage.removeItem(TEST_REPORT_ID_KEY);
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

// Default ON -- the Torch Bearer's raw spectrum reads a few percent high in
// CCT next to the HPCS; the correction in ble/tbCorrection.ts brings it back
// in line (see that file for how it was checked). Off gives the raw spectrum.
const TB_CORRECTION_KEY = 'hcri.io.pref.torchBearerCorrection';

export async function loadTbCorrectionPreference(): Promise<boolean> {
  const raw = await AsyncStorage.getItem(TB_CORRECTION_KEY);
  return raw === null ? true : raw === 'true';
}

export async function saveTbCorrectionPreference(enabled: boolean): Promise<void> {
  await AsyncStorage.setItem(TB_CORRECTION_KEY, enabled ? 'true' : 'false');
}

// Default OFF -- an optional extra: after each standard reading also take a one-shot flicker capture
// (adds a few seconds, and only meters that support flicker can do it). See HomeScreen.tsx's measure().
const FLICKER_WITH_READING_KEY = 'hcri.io.pref.flickerWithReading';

export async function loadFlickerWithReadingPreference(): Promise<boolean> {
  return (await AsyncStorage.getItem(FLICKER_WITH_READING_KEY)) === 'true';
}

export async function saveFlickerWithReadingPreference(enabled: boolean): Promise<void> {
  await AsyncStorage.setItem(FLICKER_WITH_READING_KEY, enabled ? 'true' : 'false');
}

// Default ON -- hCRI.io suggests the LED (brand, model, CCT) from the spectrum after each reading. Turning it
// off stops those requests and hides the suggestion cards; adding LED details by hand still works.
const LED_SUGGESTIONS_KEY = 'hcri.io.pref.ledSuggestions';

export async function loadLedSuggestionsPreference(): Promise<boolean> {
  return (await AsyncStorage.getItem(LED_SUGGESTIONS_KEY)) !== 'false';
}

export async function saveLedSuggestionsPreference(enabled: boolean): Promise<void> {
  await AsyncStorage.setItem(LED_SUGGESTIONS_KEY, enabled ? 'true' : 'false');
}

// Default ON -- the app looks for the meter by itself when it opens and when you come back to it. Turn off to
// connect only when you tap Connect to Meter.
const AUTO_CONNECT_KEY = 'hcri.io.pref.autoConnect';

export async function loadAutoConnectPreference(): Promise<boolean> {
  return (await AsyncStorage.getItem(AUTO_CONNECT_KEY)) !== 'false';
}

export async function saveAutoConnectPreference(enabled: boolean): Promise<void> {
  await AsyncStorage.setItem(AUTO_CONNECT_KEY, enabled ? 'true' : 'false');
}

// Tablet layouts: which chart sits in the big slot ('spectrum' | 'cie' | 'rvalues' | 'flicker'); see SpectrumGrid.tsx.
const CHART_TOP_KEY = 'hcri.io.pref.chartTop';

export async function loadChartTopPreference(): Promise<string | null> {
  return AsyncStorage.getItem(CHART_TOP_KEY);
}

export async function saveChartTopPreference(id: string): Promise<void> {
  await AsyncStorage.setItem(CHART_TOP_KEY, id);
}

// Landscape chart grid: the full remembered order of the charts (top/big chart first).
const CHART_ORDER_KEY = 'hcri.io.pref.chartOrder';

export async function loadChartOrderPreference(): Promise<string[] | null> {
  try {
    const raw = await AsyncStorage.getItem(CHART_ORDER_KEY);
    const v = raw ? JSON.parse(raw) : null;
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : null;
  } catch {
    return null;
  }
}

export async function saveChartOrderPreference(order: string[]): Promise<void> {
  await AsyncStorage.setItem(CHART_ORDER_KEY, JSON.stringify(order));
}

// Square windows (unfolded foldables): which panel the right-hand column shows ('history' | 'data').
const SIDE_TAB_KEY = 'hcri.io.pref.sideTab';

export async function loadSideTabPreference(): Promise<'history' | 'data'> {
  const raw = await AsyncStorage.getItem(SIDE_TAB_KEY);
  return raw === 'data' ? 'data' : 'history';
}

// Which tab that column opens on: the last one used ('remember') or always History / Data.
export type SideTabMode = 'remember' | 'history' | 'data';
const SIDE_TAB_MODE_KEY = 'hcri.io.pref.sideTabMode';

export async function loadSideTabModePreference(): Promise<SideTabMode> {
  const raw = await AsyncStorage.getItem(SIDE_TAB_MODE_KEY);
  return raw === 'history' || raw === 'data' ? raw : 'remember';
}

export async function saveSideTabModePreference(mode: SideTabMode): Promise<void> {
  await AsyncStorage.setItem(SIDE_TAB_MODE_KEY, mode);
}

export async function saveSideTabPreference(tab: 'history' | 'data'): Promise<void> {
  await AsyncStorage.setItem(SIDE_TAB_KEY, tab);
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
