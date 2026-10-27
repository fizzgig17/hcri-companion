// src/screens/SettingsScreen.tsx
//
// hCRI.io username + API token entry, backed by secureStorage (Keystore/
// Keychain), not plaintext -- unlike the ESP32 firmware's NVS storage.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { ScrollView, View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, Modal, Linking, Platform, useWindowDimensions } from 'react-native';
import AppSwitch from '../components/AppSwitch';
import { Icon, ICON_SIZE } from '../components/icons';
import { useKeyboardHeight } from '../hooks/useKeyboardHeight';
import { useLayoutMode, useContentWidth, isSquareWindow } from '../layout';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { IS_DEV_BUILD, HCRI_API_HOST } from '../hcri/buildTarget';
import PrimaryButton from '../components/PrimaryButton';
import { loadBackupEnabled, saveBackupEnabled } from '../storage/backupState';
import { restoreFromBackup, scheduleBackup } from '../hcri/backup';
import HintPressable from '../components/HintPressable';
import Svg, { Circle, Path } from 'react-native-svg';
import DraggableStatList from '../components/DraggableStatList';
import {
  loadHcriCredentials,
  saveHcriCredentials,
  clearHcriCredentials,
} from '../storage/secureStorage';
import { generateApiToken } from '../hcri/generateApiToken';

// Default name given to a token minted from the in-app "generate" flow
// below -- shown to the person as an editable starting point (see the
// Token Name field in the modal), and this is exactly what shows up next
// to it in the Profile -> API list on the website, so it should read as a
// real, specific name rather than a generic placeholder like "API token".
const DEFAULT_GENERATED_TOKEN_NAME = 'hCRI Companion Data Upload Token';

// Password reset is entirely a website flow (an emailed link, see
// api/auth/reset_request.php) -- there's no in-app equivalent to call,
// and no deep-linkable URL that jumps straight to the "forgot password"
// modal on hcri.io. The plain homepage is still the right target though:
// a logged-out visitor lands on the sign-in screen by default, and
// "Forgot password?" is right there on it (see AuthScreen.jsx).
const FORGOT_PASSWORD_URL = 'https://www.hcri.io/';
const DELETE_ACCOUNT_URL = 'https://www.hcri.io/delete.php';
import {
  loadKeepAwakePreference,
  loadHapticTapsPreference,
  saveHapticTapsPreference,
  loadHapticResultsPreference,
  saveHapticResultsPreference,
  saveKeepAwakePreference,
  loadVerboseLoggingPreference,
  loadTestReportIdPreference,
  saveTestReportIdPreference,
  saveVerboseLoggingPreference,
  loadStayConnectedInBackgroundPreference,
  saveStayConnectedInBackgroundPreference,
  loadTbCorrectionPreference,
  loadTbFlipPreference,
  saveTbFlipPreference,
  loadFlickerWithReadingPreference,
  loadSideTabModePreference,
  loadFoldableSeen,
  saveFoldableSeen,
  saveSideTabModePreference,
  type SideTabMode,
  saveFlickerWithReadingPreference,
  loadLedSuggestionsPreference,
  loadAutoConnectPreference,
  saveAutoConnectPreference,
  saveLedSuggestionsPreference,
  saveTbCorrectionPreference,
  loadMunkiCalHoursPreference,
  saveMunkiCalHoursPreference,
  loadTkScalePreference,
  saveTkScalePreference,
  saveTkWindowPreference,
} from '../storage/preferences';
import { setTbCorrectionEnabled } from '../ble/tbCorrection';
import { setTbFlip } from '../ble/tbDisplay';
import { setMunkiCalHours } from '../ble/torchBearer';
import { TK_RAW_PER_LM_DEFAULT, getTkRawPerLm, getTkWindowS, setTkRawPerLm, setTkWindowS } from '../ble/tklamp';
import {
  StatDisplayPrefs,
  loadStatDisplayPrefs,
  saveStatDisplayPrefs,
  defaultStatDisplayPrefs,
} from '../storage/statDisplayPrefs';
import { STAT_METRIC_BY_ID } from '../utils/statMetrics';
import { maskSecret } from '../utils/maskSecret';
import { useTheme } from '../contexts/ThemeContext';
import { ThemeMode } from '../theme';
import AboutTab from './tabs/AboutTab';
import TabBar from '../components/TabBar';
import VersionStamp from '../components/VersionStamp';
import UpdateTab from './tabs/UpdateTab';
import { useUpdate } from '../contexts/UpdateContext';
import { iosUpdatesSupported } from '../utils/iosUpdate';
import { hapticTap, hapticSuccess, setTapHapticsEnabled, setResultHapticsEnabled } from '../utils/haptics';

// Labels/order for the Light/Dark/System picker below -- System first since
// it's the default every fresh install starts on (see ThemeContext.tsx).
const THEME_MODE_OPTIONS: { value: ThemeMode; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

/** `panel`: shown inside the tablet overlay (OverlayPanel supplies the title and the close button). */
// The Torch Bearer spectral correction is applied in the bridge firmware now; the app switch is hidden (code kept).
const SHOW_TB_CORRECTION_SWITCH = false;

export default function SettingsScreen({ navigation, route, panel }: any) {
  const { colors, mode, setMode } = useTheme();
  // Settings / About sub-tabs -- About used to be a section at the very
  // bottom of this screen, a long scroll past every setting to reach.
  const update = useUpdate();
  const [settingsTab, setSettingsTab] = useState<'settings' | 'update' | 'about'>('settings');
  const [draggingStat, setDraggingStat] = useState(false);
  // Android Back: from Update/About return to the main Settings page first.
  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        if (settingsTab !== 'settings') {
          setSettingsTab('settings');
          return true;
        }
        return false;
      });
      return () => sub.remove();
    }, [settingsTab]),
  );
  // Always open on Settings, never on whichever sub-tab was showing last:
  // this screen stays mounted while you're on other tabs, so reset when
  // leaving it, and when the Settings tab itself is tapped.
  useEffect(() => {
    const offBlur = navigation.addListener('blur', () => setSettingsTab('settings'));
    // 'tabPress' only exists on a tab navigator; inside the tablet overlay (a stack screen) there is no such event.
    let offPress: () => void = () => {};
    try { offPress = navigation.addListener('tabPress', () => setSettingsTab('settings')); } catch {}
    return () => {
      offBlur();
      offPress();
    };
  }, [navigation]);
  const [username, setUsername] = useState('');
  const [token, setToken] = useState('');
  const [hasSaved, setHasSaved] = useState(false);
  // What's actually loaded right now, shown read-only (see maskedToken
  // below) -- separate from `token` above, which is only ever the NEW
  // value being typed in to replace it (see the hasSaved-gated fields
  // below: the two are never shown/editable at the same time).
  const [loadedToken, setLoadedToken] = useState('');
  const [keepAwake, setKeepAwake] = useState(false);
  const [cloudBackup, setCloudBackup] = useState(true);
  const [restoring, setRestoring] = useState(false);
  const [hapticTaps, setHapticTaps] = useState(true);
  const [hapticResults, setHapticResults] = useState(true);
  // Default true ("stay connected") -- matches loadStayConnectedInBackground
  // Preference()'s own default, so this starts on the right value even
  // before that first load resolves rather than flashing "off" for a frame.
  const [stayConnectedInBackground, setStayConnectedInBackground] = useState(true);
  // Default OFF -- see preferences.ts's loadVerboseLoggingPreference/
  // HomeScreen.tsx's appendLog for what this actually gates (the BLE hex
  // dumps and full raw-result-body dump, not the ordinary connect/measure
  // milestones and errors, which always show regardless of this setting).
  const [verboseLogging, setVerboseLogging] = useState(false);
  const [testReportId, setTestReportId] = useState('');
  const [tbCorrection, setTbCorrection] = useState(false);
  const [tbFlipped, setTbFlipped] = useState(false);
  const [munkiHours, setMunkiHours] = useState('1');
  const [tkScale, setTkScale] = useState(String(getTkRawPerLm()));
  const [tkWindow, setTkWindow] = useState(String(getTkWindowS()));
  const [help, setHelp] = useState<{ title: string; text: string } | null>(null);
  const [flickerWithReading, setFlickerWithReading] = useState(false);
  const [sideTabMode, setSideTabMode] = useState<SideTabMode>('remember');
  const [ledSuggestions, setLedSuggestions] = useState(true);
  const [autoConnect, setAutoConnect] = useState(true);
  // Which measurements show on the Main tab's result card, and in what
  // order -- starts from the built-in default so the list renders
  // immediately (not empty) while loadStatDisplayPrefs() resolves.
  const [statPrefs, setStatPrefs] = useState<StatDisplayPrefs>(defaultStatDisplayPrefs());

  // "Generate token" modal -- logs into hCRI.io with a username/email +
  // password and mints a brand-new named API token, instead of making
  // someone copy one over by hand from Profile -> API on the website. See
  // generateApiToken.ts for the two-request login-then-create flow.
  const [tokenModalVisible, setTokenModalVisible] = useState(false);
  const [genEmail, setGenEmail] = useState('');
  const [genPassword, setGenPassword] = useState('');
  // The password box is always hidden when the window opens; the eye button reveals it until pressed again or the window closes.
  const [genShowPassword, setGenShowPassword] = useState(false);
  const [genTokenName, setGenTokenName] = useState(DEFAULT_GENERATED_TOKEN_NAME);
  const tokenScrollRef = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const kbHeight = useKeyboardHeight(true);
  const { width: winW, height: winH } = useWindowDimensions();
  const [foldableSeen, setFoldableSeen] = useState(false);
  const unfolded = isSquareWindow(winW, winH);
  const isFoldable = unfolded || foldableSeen; // a device that has ever been unfolded keeps the foldable-only settings, folded or not
  useEffect(() => { loadFoldableSeen().then(setFoldableSeen).catch(() => {}); }, []);
  const insets = useSafeAreaInsets();
  const layoutMode = useLayoutMode();
  const wide = layoutMode !== 'compact';
  // Inside the overlay: toggles on the left, measurements in the middle, and (landscape) About as a third column.
  const settingsW = useContentWidth();
  const columns = !!panel && wide && settingsW >= 640;
  const aboutColumn = columns && layoutMode === 'dashboard' && settingsW >= 960;
  const kbUp = kbHeight > 0;
  const [genBusy, setGenBusy] = useState(false);

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
    loadBackupEnabled().then(setCloudBackup).catch(() => {});
    loadHapticTapsPreference().then(setHapticTaps);
    loadHapticResultsPreference().then(setHapticResults);
    loadStayConnectedInBackgroundPreference().then(setStayConnectedInBackground);
    loadVerboseLoggingPreference().then(setVerboseLogging);
    loadTestReportIdPreference().then(setTestReportId);
    loadTbCorrectionPreference().then(setTbCorrection);
    loadMunkiCalHoursPreference().then((h) => setMunkiHours(String(h)));
    loadTkScalePreference(TK_RAW_PER_LM_DEFAULT).then((v) => { setTkRawPerLm(v); setTkScale(String(v)); });
    loadTbFlipPreference().then((v) => setTbFlipped(v === true));
    loadFlickerWithReadingPreference().then(setFlickerWithReading);
    loadSideTabModePreference().then(setSideTabMode).catch(() => {});
    loadLedSuggestionsPreference().then(setLedSuggestions);
    loadAutoConnectPreference().then(setAutoConnect);
    loadStatDisplayPrefs().then(setStatPrefs);
    // Intentionally run once on mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Both handlers use the functional setState form and persist from the
  // freshly-computed `next` value, rather than closing over the
  // `statPrefs` variable above -- that would be a stale read if, say, a
  // fast double-tap on two different checkboxes both fired from the same
  // render's closure.
  const handleReorder = (newOrder: string[]) => {
    setStatPrefs((prev) => {
      const next: StatDisplayPrefs = { order: newOrder, enabled: prev.enabled };
      saveStatDisplayPrefs(next).catch(() => {});
      return next;
    });
  };

  const handleToggleStat = (id: string) => {
    setStatPrefs((prev) => {
      const enabled = new Set(prev.enabled);
      if (enabled.has(id)) enabled.delete(id);
      else enabled.add(id);
      const next: StatDisplayPrefs = { order: prev.order, enabled };
      saveStatDisplayPrefs(next).catch(() => {});
      return next;
    });
  };

  const resetStatsToDefault = () => {
    const next = defaultStatDisplayPrefs();
    setStatPrefs(next);
    saveStatDisplayPrefs(next).catch(() => {});
  };

  const toggleHapticTaps = async (value: boolean) => {
    setHapticTaps(value);
    setTapHapticsEnabled(value);
    if (value) hapticTap(); // let them feel what they just turned on
    await saveHapticTapsPreference(value);
  };

  const toggleHapticResults = async (value: boolean) => {
    setHapticResults(value);
    setResultHapticsEnabled(value);
    if (value) hapticSuccess();
    await saveHapticResultsPreference(value);
  };

  const toggleAutoConnect = async (value: boolean) => {
    setAutoConnect(value);
    await saveAutoConnectPreference(value);
  };

  const toggleLedSuggestions = async (value: boolean) => {
    setLedSuggestions(value);
    await saveLedSuggestionsPreference(value);
  };
  const chooseSideTabMode = (m: SideTabMode) => {
    setSideTabMode(m);
    saveSideTabModePreference(m).catch(() => {});
  };
  const toggleFlickerWithReading = async (value: boolean) => {
    setFlickerWithReading(value);
    await saveFlickerWithReadingPreference(value);
  };

  const toggleTbFlip = async (value: boolean) => {
    setTbFlipped(value);
    setTbFlip(value); // sent to a connected Torch Bearer right away, and to the next one that connects
    await saveTbFlipPreference(value);
  };

  const commitTkWindow = async () => {
    const n = Number(tkWindow.replace(',', '.'));
    const v = Number.isFinite(n) && n >= 10 ? Math.min(Math.round(n), 86400) : getTkWindowS();
    setTkWindow(String(v));
    setTkWindowS(v);
    await saveTkWindowPreference(v);
  };

  const commitTkScale = async () => {
    const n = Number(tkScale.replace(',', '.'));
    const v = Number.isFinite(n) && n > 0 ? n : getTkRawPerLm();
    setTkScale(String(v));
    setTkRawPerLm(v);
    await saveTkScalePreference(v);
  };

  const commitMunkiHours = async () => {
    const n = Number(munkiHours.replace(',', '.'));
    const h = Number.isFinite(n) && n >= 0 ? Math.min(n, 999) : 4;
    setMunkiHours(String(h));
    setMunkiCalHours(h);
    await saveMunkiCalHoursPreference(h);
  };

  const toggleTbCorrection = async (value: boolean) => {
    setTbCorrection(value);
    setTbCorrectionEnabled(value); // applies to the very next Torch Bearer scan
    await saveTbCorrectionPreference(value);
  };

  const toggleCloudBackup = async (value: boolean) => {
    setCloudBackup(value);
    await saveBackupEnabled(value);
    if (value) scheduleBackup(500);   // catches up on anything not backed up yet
  };

  const restoreBackup = async () => {
    if (restoring) return;
    setRestoring(true);
    const r = await restoreFromBackup();
    setRestoring(false);
    if (!r.ok) {
      Alert.alert('Could not restore', r.message ?? 'Something went wrong. Try again.');
    } else if (r.total === 0) {
      Alert.alert('Nothing to restore', 'Your hCRI.io account has no backed-up readings yet.');
    } else if (r.added === 0) {
      Alert.alert('Already up to date', 'All of your backed-up readings are already in History.');
    } else {
      Alert.alert('Restored', `Added ${r.added} item${r.added === 1 ? '' : 's'} (readings and saved flickers) to History.`);
    }
  };

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

  const toggleStayConnectedInBackground = async (value: boolean) => {
    // Same "feel instant" reasoning as toggleKeepAwake above. HomeScreen
    // reads this preference itself (via a ref refreshed on focus, not from
    // this component's state) the next time the app is backgrounded, so it
    // doesn't need to be told about this change directly either.
    setStayConnectedInBackground(value);
    await saveStayConnectedInBackgroundPreference(value);
  };

  const toggleVerboseLogging = async (value: boolean) => {
    // Same "feel instant" reasoning as toggleKeepAwake above. Unlike
    // keepAwake, nothing needs to react to this mid-connection -- it's read
    // via a ref the next time appendLog is called (see HomeScreen.tsx),
    // not consulted once at connect/disconnect time -- so there's nothing
    // else to notify here.
    setVerboseLogging(value);
    await saveVerboseLoggingPreference(value);
  };

  // Shared by the manual Save button and the "generate token" flow below --
  // pulled out so the generate flow can persist the username/token it just
  // got back from the server directly, rather than calling setUsername()/
  // setToken() and then save() in the same tick and reading back its own
  // not-yet-applied state (React state updates aren't synchronous).
  const persistCredentials = async (newUsername: string, newToken: string) => {
    await saveHcriCredentials({ username: newUsername, token: newToken });
    setUsername(newUsername);
    // loadedToken (what the locked view's maskSecret() reads) was only
    // ever set by the mount-time loadHcriCredentials() effect -- never
    // here, so right after a fresh Save it was still '', and maskSecret('')
    // returns '' (nothing renders). Only leaving Settings and coming back
    // re-ran that effect and actually populated it. Setting it directly
    // from what was just saved fixes the immediate case without waiting on
    // a round trip back through storage.
    setLoadedToken(newToken);
    setToken('');
    setHasSaved(true);
    scheduleBackup(1000);   // sends any readings that were waiting for a token
  };

  const save = async () => {
    if (!username.trim() || !token.trim()) {
      Alert.alert('Missing information', 'Enter both your username and API token.');
      return;
    }
    await persistCredentials(username.trim(), token.trim());
    Alert.alert('Saved');
  };

  const forget = async () => {
    await clearHcriCredentials();
    setUsername('');
    setToken('');
    setLoadedToken('');
    setHasSaved(false);
  };

  const openTokenModal = () => {
    // Pre-fill with whatever's already typed in the Username field, if
    // anything -- saves retyping it for the common case of "I have a
    // username, I just don't have a token yet". Password and the token
    // name always start fresh.
    setGenEmail(username.trim());
    setGenPassword('');
    setGenTokenName(DEFAULT_GENERATED_TOKEN_NAME);
    setTokenModalVisible(true);
  };

  const closeTokenModal = () => {
    if (genBusy) return; // don't let a backdrop tap abandon an in-flight request
    setTokenModalVisible(false);
    // Clear the password out of state the moment the modal's gone -- same
    // "never hang onto it longer than it has to" spirit as generateApiToken.ts
    // itself never persisting or logging it.
    setGenPassword('');
    setGenShowPassword(false);
  };

  const generateToken = async () => {
    const email = genEmail.trim();
    const name = genTokenName.trim() || DEFAULT_GENERATED_TOKEN_NAME;
    if (!email || !genPassword) {
      Alert.alert('Missing information', 'Enter both your username or email and your password.');
      return;
    }
    setGenBusy(true);
    try {
      const result = await generateApiToken(email, genPassword, name);
      setGenPassword('');
      setGenShowPassword(false);
      setTokenModalVisible(false);
      // Same locked-view, "Forget Credentials to change it" behavior as
      // manually pasting a token in and tapping Save -- generating one
      // isn't a different kind of credential, so it shouldn't end up in a
      // different state afterward.
      await persistCredentials(result.username, result.token);
      Alert.alert('Token created', `"${name}" was created and saved.`);
    } catch (e: any) {
      Alert.alert('Could not create a token', e?.message || 'Something went wrong. Please try again.');
    } finally {
      setGenBusy(false);
    }
  };

  const openForgotPassword = () => {
    Linking.openURL(FORGOT_PASSWORD_URL).catch(() => {
      Alert.alert('Could not open browser', `Visit ${FORGOT_PASSWORD_URL} directly instead.`);
    });
  };

  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    scrollArea: { flex: 1 },
    // Same heading style as History's page title.
    screenTitle: { fontSize: 20, fontWeight: '700', color: colors.text, paddingHorizontal: 16, paddingTop: 16 },
    columnsRow: { flex: 1, flexDirection: 'row' },
    column: { flex: 1, minWidth: 0 },
    columnDivider: { borderLeftWidth: 1, borderLeftColor: colors.cardBorder },
    titleRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 16 },
    backLink: { color: colors.accent, fontSize: 16, fontWeight: '600' },
    tabBarWrap: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 4 },
    // Padding lives here (the scrollable content) rather than on the
    // ScrollView's own `style` -- padding on the outer style can clip the
    // last bit of content at the bottom of a scroll on some platforms.
    // paddingBottom is generous, not just enough to clear the content itself
    // -- this screen has no SafeAreaView of its own, so nothing else is
    // reserving room for the home indicator/nav bar below the last field,
    // and the draggable measurement list (DraggableStatList) can run long
    // enough that a tighter value left it crowding the bottom of the screen.
    contentContainer: { padding: 16, paddingBottom: 56 },
    label: { color: colors.muted, marginTop: 14, marginBottom: 6 },
    input: {
      backgroundColor: colors.card,
      color: colors.text,
      padding: 11,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.cardBorder,
    },
    // Visually distinct from `input` (no editable-looking border/background)
    // so it reads as "locked display", not just a disabled text field.
    lockedField: {
      backgroundColor: colors.card,
      padding: 11,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.cardBorder,
    },
    // Matches `input`'s own text color rather than a dimmer gray -- a dimmer
    // tone on this box's near-black background read as "I can't see the
    // key, maybe it's too dark" in practice, even though it technically had
    // enough contrast on paper.
    lockedFieldText: { color: colors.text, fontFamily: 'monospace', fontSize: 14 },
    hint: { color: colors.mutedFaint, fontSize: 12, marginTop: 10, lineHeight: 16 },
    // Provides the gap above the Save button; noTopMargin below cancels out
    // PrimaryButton's own default marginTop so it doesn't stack on top of this.
    saveButtonWrap: { marginTop: 18 },
    noTopMargin: { marginTop: 0 },
    // Save + the "generate token" icon button sit side by side in this row
    // -- Save takes the remaining width, the icon button is a fixed-size
    // square next to it rather than a second full-width button, since it's
    // a secondary/occasional action, not an equal alternative to Save.
    saveRow: { flexDirection: 'row', alignItems: 'stretch', gap: 10 },
    saveRowButton: { flex: 1 },
    generateTokenButton: {
      width: 50,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      backgroundColor: colors.card,
      alignItems: 'center',
      justifyContent: 'center',
    },
    generateTokenHint: { color: colors.mutedFaint, fontSize: 11.5, marginTop: 8, lineHeight: 15 },

    // "Generate token" modal -- same overlay/sheet treatment as MainTab's
    // device-picker modal, for a consistent feel across the app.
    modalBackdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.6)',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
    },
    modalSheet: {
      width: '100%',
      maxWidth: 400,
      backgroundColor: colors.card,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      padding: 18,
    },
    modalTitle: { color: colors.text, fontSize: 16, fontWeight: '700', marginBottom: 4 },
    modalSubtitle: { color: colors.muted, fontSize: 13, marginBottom: 14, lineHeight: 18 },
    modalLabel: { color: colors.muted, marginTop: 12, marginBottom: 6, fontSize: 13 },
    forgotPasswordLink: { alignSelf: 'flex-end', marginTop: 8 },
    forgotPasswordText: { color: colors.info, fontSize: 12.5 },
    modalCancel: { alignItems: 'center', paddingVertical: 12, marginTop: 6 },
    modalCancelText: { color: colors.muted, fontSize: 13, fontWeight: '600' },
    // No borderTop/marginTop like toggleRow below -- this is the first
    // section on the screen, directly under the credentials form, so there's
    // nothing above it yet to separate from.
    appearanceSection: { marginTop: 28 },
    appearanceLabel: { color: colors.text, fontSize: 14, fontWeight: '600', marginBottom: 10 },
    // Segmented control: three equal-width options sharing one pill-shaped
    // track, rather than three separate buttons -- makes clear they're a
    // single mutually-exclusive choice, not three independent toggles.
    modeSegment: {
      flexDirection: 'row',
      backgroundColor: colors.card,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      padding: 3,
    },
    modeOption: {
      flex: 1,
      paddingVertical: 9,
      borderRadius: 8,
      alignItems: 'center',
    },
    modeOptionActive: { backgroundColor: colors.accent },
    modeOptionText: { color: colors.muted, fontSize: 13, fontWeight: '600' },
    // Matches PrimaryButton's own accent-background text color (colors.text,
    // not colors.background) so this reads as the same "selected/accent"
    // treatment used everywhere else in the app.
    modeOptionTextActive: { color: colors.text },

    toggleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: 28,
      paddingTop: 20,
      borderTopWidth: 1,
      borderTopColor: colors.cardBorder,
    },
    toggleTextWrap: { flex: 1, marginRight: 12 },
    toggleLabel: { color: colors.text, fontSize: 14, fontWeight: '600', marginBottom: 4 },
    toggleHint: { color: colors.muted, fontSize: 12, lineHeight: 16 },

    sectionHeader: {
      marginTop: 28,
      marginBottom: 2,
      color: colors.muted,
      fontSize: 12,
      fontWeight: '700',
      letterSpacing: 0.8,
      textTransform: 'uppercase',
    },
    sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', marginTop: 28, marginBottom: 6 },
    sectionHeaderInline: {
      color: colors.muted,
      fontSize: 12,
      fontWeight: '700',
      letterSpacing: 0.8,
      textTransform: 'uppercase',
    },
    settingRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.cardBorder,
    },
    settingLabelWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', marginRight: 12 },
    settingLabel: { color: colors.text, fontSize: 14, fontWeight: '600', flexShrink: 1 },
    settingBlock: { paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.cardBorder },
    settingBlockLabelRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
    helpCircle: { width: 22, height: 22, alignItems: 'center', justifyContent: 'center', marginLeft: 8 },
    helpBody: { color: colors.text, fontSize: 14, lineHeight: 20 },

    statsSection: {
      marginTop: 28,
      paddingTop: 20,
      borderTopWidth: 1,
      borderTopColor: colors.cardBorder,
    },
    statsHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    statsTitle: { color: colors.text, fontSize: 14, fontWeight: '600' },
    statsResetLink: { color: colors.info, fontSize: 12.5 },
    statsHint: { color: colors.muted, fontSize: 12, lineHeight: 16, marginTop: 4, marginBottom: 14 },

    aboutSection: {
      marginTop: 28,
      paddingTop: 20,
      borderTopWidth: 1,
      borderTopColor: colors.cardBorder,
    },
    aboutTitle: { color: colors.text, fontSize: 14, fontWeight: '600', marginBottom: 12 },
  });

  // Every setting is a single line: its name, a small (?) that opens the explanation, and the control.
  const helpButton = (title: string, text: string) => (
    <TouchableOpacity
      onPress={() => setHelp({ title, text })}
      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      accessibilityRole="button"
      accessibilityLabel={`About ${title}`}
    >
      <View style={styles.helpCircle}>
        <Svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke={colors.muted} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <Circle cx={12} cy={12} r={10} />
          <Path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
          <Path d="M12 17h.01" />
        </Svg>
      </View>
    </TouchableOpacity>
  );
  const settingRow = (label: string, helpText: string, control: React.ReactNode) => (
    <View style={styles.settingRow}>
      <View style={styles.settingLabelWrap}>
        <Text style={styles.settingLabel}>{label}</Text>
        {helpButton(label, helpText)}
      </View>
      {control}
    </View>
  );
  const switchRow = (label: string, helpText: string, value: boolean, onChange: (v: boolean) => void) =>
    settingRow(label, helpText, <AppSwitch accessibilityLabel={label} value={value} onValueChange={onChange} />);
  const sectionHeader = (title: string) => <Text style={styles.sectionHeader}>{title}</Text>;

  // The Settings page in two parts so tablets can lay them out as columns (see `columns`).
  const settingsLeft = (
    <>
      {/* Which build you're looking at, at a glance -- came up more than
          once this session when testing against a build that was already
          a few fixes behind develop. See buildInfo.ts for how this stays
          in sync with the native versionName/versionCode. */}
      <VersionStamp />

      <View style={[styles.sectionHeaderRow, { marginTop: 8 }]}>
        <Text style={styles.sectionHeaderInline}>hCRI.io account</Text>
        {helpButton(
          'hCRI.io account',
          hasSaved
            ? 'Your credentials are saved on this device. To use a different account or key, forget the current credentials first. “Forget Credentials” only removes the token from this device; deleting the account itself is done on hcri.io.'
            : "Enter your hCRI.io username and API token, then tap Save. Don't have a token? Tap the key button to sign in with your hCRI.io username and password and create one."
        )}
      </View>

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
            autoCorrect={false}
            textContentType="username"
            autoComplete="username"
            importantForAutofill="yes"
            placeholder="username"
            placeholderTextColor={colors.mutedFaint}
          />

          <Text style={styles.label}>hCRI.io API Token</Text>
          <TextInput
            style={styles.input}
            value={token}
            onChangeText={setToken}
            autoCapitalize="none"
            autoCorrect={false}
            textContentType="password"
            autoComplete="password"
            importantForAutofill="yes"
            secureTextEntry
            placeholder="hcri_..."
            placeholderTextColor={colors.mutedFaint}
          />

          <View style={[styles.saveButtonWrap, styles.saveRow]}>
            <PrimaryButton title="Save" onPress={save} style={[styles.noTopMargin, styles.saveRowButton]} />
            {/* Don't have a token yet? Logs into hCRI.io with a username +
                password and mints a brand-new one -- see generateApiToken.ts.
                A separate icon button rather than folded into Save itself:
                this is a different action (create a new token on the
                server) from Save (persist whatever's already typed in). */}
            <TouchableOpacity
              style={styles.generateTokenButton}
              onPress={openTokenModal}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityLabel="Generate a new API token"
            >
              <Icon name="key" color={colors.accent} size={ICON_SIZE.primary} />
            </TouchableOpacity>
          </View>
        </>
      )}

      {/* Accounts live on hCRI.io (the app only holds an optional API token), so account deletion is the website's
          page; "Forget Credentials" above only removes the token from this device. */}
      <TouchableOpacity
        accessibilityRole="link"
        onPress={() => Linking.openURL(DELETE_ACCOUNT_URL).catch(() => Alert.alert('Could not open the link', DELETE_ACCOUNT_URL))}
        style={{ paddingVertical: 12 }}
      >
        <Text style={[styles.hint, { textDecorationLine: 'underline' }]}>Delete my hCRI.io account (opens hcri.io)</Text>
      </TouchableOpacity>

      {/* "Generate token" modal -- logs in, creates a named API token, and
          saves it (same as tapping Save manually), then closes. Dismissing
          via the backdrop/Cancel just closes the overlay without creating
          anything, same as leaving the fields above blank. */}
      <Modal visible={tokenModalVisible} transparent animationType="fade" onRequestClose={closeTokenModal}>
        <TouchableOpacity style={[styles.modalBackdrop, { paddingTop: insets.top + 12, paddingBottom: kbUp ? 10 + kbHeight : insets.bottom + 12 }]} activeOpacity={1} onPress={closeTokenModal}>
          <TouchableOpacity style={[styles.modalSheet, { maxHeight: Math.max(200, winH - kbHeight - insets.top - (kbUp ? 0 : insets.bottom) - 24 - (kbUp ? 10 : 12)), padding: 14 }]} activeOpacity={1} onPress={() => {}}>
           <ScrollView ref={tokenScrollRef} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} bounces={false}>
            <Text style={styles.modalTitle}>Generate API Token</Text>
            {!kbUp && (
              <Text style={styles.modalSubtitle}>
                Sign in with your hCRI.io username and password to create a new API token. Your password is
                used once to sign in and is never stored.
              </Text>
            )}

            <Text style={[styles.modalLabel, { marginTop: 8, marginBottom: 4 }]}>hCRI.io Username or Email</Text>
            <TextInput
              style={[styles.input, { padding: 9 }]}
              value={genEmail}
              onChangeText={setGenEmail}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              textContentType="username"
              autoComplete="username"
              importantForAutofill="yes"
              editable={!genBusy}
              placeholder="username or email"
              placeholderTextColor={colors.mutedFaint}
            />

            <Text style={[styles.modalLabel, { marginTop: 8, marginBottom: 4 }]}>Password</Text>
            <View>
              <TextInput
                style={[styles.input, { padding: 9, paddingRight: 46 }]}
                value={genPassword}
                onChangeText={setGenPassword}
                autoCapitalize="none"
                autoCorrect={false}
                textContentType="password"
                autoComplete="current-password"
                importantForAutofill="yes"
                secureTextEntry={!genShowPassword}
                keyboardType={genShowPassword && Platform.OS === 'android' ? 'visible-password' : 'default'}
                editable={!genBusy}
                placeholder="password"
                placeholderTextColor={colors.mutedFaint}
              />
              <HintPressable
                hint={genShowPassword ? 'Hide password' : 'Show password'}
                onPress={() => setGenShowPassword((v) => !v)}
                disabled={genBusy}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="button"
                accessibilityLabel={genShowPassword ? 'Hide password' : 'Show password'}
                style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 44, alignItems: 'center', justifyContent: 'center' }}
              >
                <Svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke={genShowPassword ? colors.accent : colors.muted} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <Path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z" />
                  {genShowPassword && <Path d="M3 3l18 18" />}
                </Svg>
              </HintPressable>
            </View>
            <TouchableOpacity onPress={openForgotPassword} disabled={genBusy} style={styles.forgotPasswordLink}>
              <Text style={styles.forgotPasswordText}>Forgot password?</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={openForgotPassword} disabled={genBusy} style={styles.forgotPasswordLink}>
              <Text style={styles.forgotPasswordText}>Need an account? Sign up at hcri.io</Text>
            </TouchableOpacity>

            <Text style={[styles.modalLabel, { marginTop: 8, marginBottom: 4 }]}>Token Name</Text>
            <TextInput
              style={[styles.input, { padding: 9 }]}
              value={genTokenName}
              onChangeText={setGenTokenName}
              onFocus={() => setTimeout(() => tokenScrollRef.current?.scrollToEnd({ animated: true }), 120)}
              editable={!genBusy}
              placeholder={DEFAULT_GENERATED_TOKEN_NAME}
              placeholderTextColor={colors.mutedFaint}
            />

            <View style={[styles.saveButtonWrap, { marginTop: 12 }]}>
              <PrimaryButton
                title={genBusy ? 'Generating…' : 'Generate & Save'}
                onPress={generateToken}
                disabled={genBusy}
                style={styles.noTopMargin}
              />
            </View>
            <TouchableOpacity style={[styles.modalCancel, { paddingVertical: 8 }]} onPress={closeTokenModal} disabled={genBusy}>
              <Text style={styles.modalCancelText}>Cancel</Text>
            </TouchableOpacity>
           </ScrollView>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {sectionHeader('Display')}
      <View style={styles.settingBlock}>
        <View style={styles.settingBlockLabelRow}>
          <Text style={styles.settingLabel}>Appearance</Text>
          {helpButton('Appearance', 'Light, dark, or follow the phone\'s setting.')}
        </View>
        <View style={styles.modeSegment}>
          {THEME_MODE_OPTIONS.map((opt) => {
            const active = mode === opt.value;
            return (
              <TouchableOpacity
                key={opt.value}
                style={[styles.modeOption, active && styles.modeOptionActive]}
                onPress={() => setMode(opt.value)}
              >
                <Text style={[styles.modeOptionText, active && styles.modeOptionTextActive]}>{opt.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {isFoldable && (
      <View style={styles.settingBlock}>
        <View style={styles.settingBlockLabelRow}>
          <Text style={styles.settingLabel}>Foldable side panel opens on</Text>
          {helpButton('Foldable side panel', 'On a nearly square unfolded screen the right-hand column switches between History and Data. Choose which one it opens on, or have it remember the last one you used.')}
        </View>
        <View style={styles.modeSegment}>
          {([['remember', 'Last used'], ['history', 'History'], ['data', 'Data']] as [SideTabMode, string][]).map(([value, label]) => {
            const active = sideTabMode === value;
            return (
              <TouchableOpacity key={value} style={[styles.modeOption, active && styles.modeOptionActive]} onPress={() => chooseSideTabMode(value)}>
                <Text style={[styles.modeOptionText, active && styles.modeOptionTextActive]}>{label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
      )}

      {sectionHeader('Connection')}
      {switchRow('Auto-connect to meter', 'On by default. The app looks for your meter when it opens and when you switch back to it, and skips the attempt while Bluetooth is off. Turn off to connect only when you tap Connect to Meter.', autoConnect, toggleAutoConnect)}
      {switchRow('Stay connected in background', "Keeps the meter connected when you switch away from the app or lock the screen, so coming back doesn't need a fresh reconnect. Turn off to disconnect the meter whenever the app isn't in the foreground instead (saves the meter's battery, at the cost of reconnecting every time).", stayConnectedInBackground, toggleStayConnectedInBackground)}
      {switchRow('Keep screen awake', 'Prevents the screen from locking during a session with the meter connected. Uses more battery.', keepAwake, toggleKeepAwake)}

      {sectionHeader('Backup')}
      {switchRow('Back up readings to hCRI.io', "Saves your reading history and saved flickers to your own hCRI.io account after each change, so reinstalling the app or changing phones doesn't lose it. Needs your API token (see hCRI.io account above); readings taken before you sign in are sent once you do. Backed-up readings are private to you: they are not reports and nobody else can see them. Deleting a reading here removes it from the backup too.", cloudBackup, toggleCloudBackup)}
      {hasSaved && (
        <View style={styles.saveButtonWrap}>
          <PrimaryButton title={restoring ? 'Restoring…' : 'Restore readings from backup'} onPress={restoreBackup} variant="outline" style={styles.noTopMargin} />
        </View>
      )}

      {sectionHeader('Bridge')}
      {/* The spectral correction now lives in the bridge firmware (the app only applies it for older firmware, always on).
          The switch is kept in code in case it is needed again: set SHOW_TB_CORRECTION_SWITCH to true. */}
      {SHOW_TB_CORRECTION_SWITCH && switchRow('Spectrum correction', "Adjusts the Torch Bearer's spectrum so its CCT, Duv and color-rendering numbers line up with the HPCS meter (it reads a few percent high in CCT without it). Leave on for normal use; turn off to see the raw, uncorrected spectrum. Applies to new scans, and saved CSVs say which one was used.", tbCorrection, toggleTbCorrection)}
      {switchRow('Flip screen', "Turns the bridge's screen 180° so it reads upright the other way round (the arrow then points to the button at the bottom left). Takes effect on the bridge right away while it is connected, and it keeps the setting. Needs the latest bridge firmware.", tbFlipped, toggleTbFlip)}

      {sectionHeader('ColorMunki')}
      {settingRow(
        'Calibration limit (hours)',
        "The ColorMunki's dark reference drifts as it warms up. Once the last calibration is older than this, the Take reading button asks you to recalibrate first. 0 turns the check off. The bridge also forgets the calibration whenever it is powered off.",
        <TextInput
          accessibilityLabel="ColorMunki calibration limit in hours"
          style={[styles.input, { width: 64, textAlign: 'center', marginTop: 0 }]}
          value={munkiHours}
          onChangeText={setMunkiHours}
          onEndEditing={commitMunkiHours}
          onBlur={commitMunkiHours}
          keyboardType="decimal-pad"
          returnKeyType="done"
          maxLength={5}
        />
      )}

      {sectionHeader('TKLamp tester')}
      {settingRow(
        'Counts per lumen',
        "The TKLamp tester sends a raw sensor count, and the app divides it by this number to show lumens. The default, 313.2, was measured on one calibrated tester using its 2150 lm calibration lamp. Each tester (and each recalibration) can come out a little different, so if the app disagrees with the lamp, set it from the live screen with a lamp of known output, or type a number here. A bigger number shows fewer lumens.",
        <TextInput
          accessibilityLabel="TKLamp counts per lumen"
          style={[styles.input, { width: 84, textAlign: 'center', marginTop: 0 }]}
          value={tkScale}
          onChangeText={setTkScale}
          onEndEditing={commitTkScale}
          onBlur={commitTkScale}
          keyboardType="decimal-pad"
          returnKeyType="done"
          maxLength={8}
        />
      )}

      {settingRow(
        'Chart width (seconds)',
        'How many seconds the live and saved runtime charts show across the screen. The lumen scale starts at 0 and only grows, so it never changes when you swipe. A longer run scrolls sideways: swipe the chart to look back, or tap Latest to jump to now.',
        <TextInput
          accessibilityLabel="TKLamp chart width in seconds"
          style={[styles.input, { width: 84, textAlign: 'center', marginTop: 0 }]}
          value={tkWindow}
          onChangeText={setTkWindow}
          onEndEditing={commitTkWindow}
          onBlur={commitTkWindow}
          keyboardType="number-pad"
          returnKeyType="done"
          maxLength={5}
        />
      )}

      {sectionHeader('Readings')}
      {switchRow('LED suggestions', "On by default. After a reading, hCRI.io suggests the LED (brand, model and CCT) from the shape of the spectrum and the reading's title, and you confirm it with one tap. Turn off to stop those requests and hide the suggestion cards. You can still add LED details yourself with the LED button.", ledSuggestions, toggleLedSuggestions)}
      {switchRow('Capture flicker with each reading', 'After each reading, also take a one-shot flicker capture (frequency, percent flicker, flicker index and waveform). Adds a few seconds per reading and only works on meters that support flicker. Saved with the reading, shown on its Flicker page, included in shared CSVs, and uploaded with the reading to hCRI.io (attached to its report). Even when off, you can add a flicker sample to a reading from the Flicker tab before uploading it.', flickerWithReading, toggleFlickerWithReading)}

      {sectionHeader('Feedback')}
      {switchRow('Button taps', 'A short tick when you press a button in the bar at the bottom of the Main screen.', hapticTaps, toggleHapticTaps)}
      {switchRow('Reading and upload results', 'A buzz when a reading or upload finishes, and a double buzz when one fails.', hapticResults, toggleHapticResults)}

      {sectionHeader('Troubleshooting')}
      {switchRow('Verbose logging', 'Adds full wavelength-by-wavelength data and Bluetooth connection/transmission details to the debug log, for troubleshooting a specific problem with Share Debug Log. Off by default -- the standard log already covers connection and measurement status.', verboseLogging, toggleVerboseLogging)}
      {IS_DEV_BUILD && (
        <View style={[styles.settingBlock, { marginBottom: 16 }]}>
          <View style={styles.settingBlockLabelRow}>
            <Text style={styles.settingLabel}>Test report number (developer)</Text>
            {helpButton('Test report number', `“Show a test reading” loads this public report from ${HCRI_API_HOST} instead of a random one, including its first flicker reading if it has one. Leave blank for a random report.`)}
          </View>
          <TextInput
            style={styles.input}
            value={testReportId}
            onChangeText={(v) => {
              const digits = v.replace(/\D/g, '');
              setTestReportId(digits);
              saveTestReportIdPreference(digits).catch(() => {});
            }}
            keyboardType="number-pad"
            placeholder="e.g. 1234 (blank = random)"
            placeholderTextColor={colors.mutedFaint}
            accessibilityLabel="Test report number"
          />
        </View>
      )}

      <Modal visible={help !== null} transparent animationType="fade" onRequestClose={() => setHelp(null)}>
        <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={() => setHelp(null)}>
          <TouchableOpacity style={styles.modalSheet} activeOpacity={1} onPress={() => {}}>
            <Text style={styles.modalTitle}>{help?.title}</Text>
            <Text style={styles.helpBody}>{help?.text}</Text>
            <TouchableOpacity style={styles.modalCancel} onPress={() => setHelp(null)}>
              <Text style={styles.modalCancelText}>Close</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </>
  );
  const settingsRight = (
      <View style={styles.statsSection}>
        <View style={styles.statsHeaderRow}>
          <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
            <Text style={styles.statsTitle}>Main Screen Measurements</Text>
            {helpButton('Main Screen Measurements', 'Check which measurements show on the Main tab after a reading. Hold the dotted handle and drag a row to reorder it.')}
          </View>
          <TouchableOpacity onPress={resetStatsToDefault}>
            <Text style={styles.statsResetLink}>Reset to Default</Text>
          </TouchableOpacity>
        </View>
        <View style={{ height: 14 }} />
        <DraggableStatList
          order={statPrefs.order}
          enabled={statPrefs.enabled}
          labelFor={(id) => STAT_METRIC_BY_ID[id]?.label ?? id}
          onReorder={handleReorder}
          onToggle={handleToggleStat}
          onDragActiveChange={setDraggingStat}
        />
      </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={panel ? [] : IS_DEV_BUILD ? ['left', 'right'] : ['top', 'left', 'right']}>
      {!panel && <Text style={styles.screenTitle}>Settings</Text>}
      {!aboutColumn && (
      <View style={styles.tabBarWrap}>
        <TabBar
          tabs={[
            { key: 'settings', label: 'Settings' },
            // The Update tab checks Google Play (Android) or the published production TestFlight build (iOS, production builds only).
            ...(Platform.OS === 'android' || (Platform.OS === 'ios' && iosUpdatesSupported) ? [{ key: 'update' as const, label: 'Update', badge: update.status === 'available' }] : []),
            { key: 'about', label: 'About' },
          ]}
          active={settingsTab}
          onChange={setSettingsTab}
        />
      </View>
      )}
      {settingsTab === 'update' && (Platform.OS === 'android' || iosUpdatesSupported) ? (
        <ScrollView automaticallyAdjustKeyboardInsets style={styles.scrollArea} contentContainerStyle={styles.contentContainer} scrollEnabled={!draggingStat} keyboardShouldPersistTaps="handled">
          <VersionStamp />
          <UpdateTab />
        </ScrollView>
      ) : settingsTab === 'about' ? (
        <ScrollView automaticallyAdjustKeyboardInsets style={styles.scrollArea} contentContainerStyle={styles.contentContainer} scrollEnabled={!draggingStat} keyboardShouldPersistTaps="handled">
          <AboutTab />
        </ScrollView>
      ) : columns ? (
        <View style={styles.columnsRow}>
          <ScrollView automaticallyAdjustKeyboardInsets style={styles.column} contentContainerStyle={styles.contentContainer} scrollEnabled={!draggingStat} keyboardShouldPersistTaps="handled">
            {settingsLeft}
          </ScrollView>
          <ScrollView automaticallyAdjustKeyboardInsets style={[styles.column, styles.columnDivider]} contentContainerStyle={styles.contentContainer} scrollEnabled={!draggingStat} keyboardShouldPersistTaps="handled">
            {settingsRight}
          </ScrollView>
          {aboutColumn && (
            <ScrollView style={[styles.column, styles.columnDivider]} contentContainerStyle={styles.contentContainer} keyboardShouldPersistTaps="handled">
              <AboutTab />
            </ScrollView>
          )}
        </View>
      ) : (
    <ScrollView automaticallyAdjustKeyboardInsets style={styles.scrollArea} contentContainerStyle={styles.contentContainer} scrollEnabled={!draggingStat} keyboardShouldPersistTaps="handled">
      {settingsLeft}
      {settingsRight}
    </ScrollView>
      )}
    </SafeAreaView>
  );
}
