// src/screens/HomeScreen.tsx
//
// Owns all app state (BLE connection, status, latest result, debug log)
// and the tab bar. Each tab's actual UI lives in its own file under
// ./tabs/ for modularity -- this file just wires state/callbacks to
// whichever tab is active. Only MainTab touches the connection lifecycle
// (connect/disconnect/scan); Spectrum, Data, and Logs are read-only views
// of whatever the last reading and log happen to be.

import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, View, ScrollView, StyleSheet, Alert, AppState, Keyboard, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MeterConnection } from '../ble/MeterConnection';
import type { BatteryStatus } from '../ble/protocol';
import { initializeMeter, takeMeasurement, EMPTY_READING_ERROR } from '../ble/takeMeasurement';
import { MeterResult } from '../ble/parseResult';
import { analyzeSpectrum } from '../utils/spectralAnalysis';
import Clipboard from '@react-native-clipboard/clipboard';
import { buildCsv, defaultLabel } from '../hcri/buildCsv';
import { uploadToHcri } from '../hcri/uploadToHcri';
import { getReportLink } from '../hcri/getReportLink';
import { fetchSampleReading } from '../hcri/fetchSampleReading';
import { loadHcriCredentials, loadLastDeviceId } from '../storage/secureStorage';
import { loadKeepAwakePreference, loadStayConnectedInBackgroundPreference } from '../storage/preferences';
import { loadStatDisplayPrefs, visibleStatIds, defaultStatDisplayPrefs } from '../storage/statDisplayPrefs';
import { addReading, recordUpload } from '../storage/readingHistory';
import { IS_DEV_BUILD } from '../hcri/buildTarget';
import { shareDebugLog } from '../utils/shareLog';
import { shareSingleReadingCsv } from '../utils/shareCsv';
import { hapticSuccess, hapticFailure } from '../utils/haptics';
import { enableKeepAwake, disableKeepAwake } from '../utils/keepAwake';
import { useTheme } from '../contexts/ThemeContext';
import { useLog } from '../contexts/LogContext';
import { withBackgroundDisconnectSuppressed, isBackgroundDisconnectSuppressed } from '../ble/backgroundDisconnectGuard';
import TabBar from '../components/TabBar';
import InfoButton from '../components/InfoButton';
import ActionBar from '../components/ActionBar';
import MainTab, { Status, FoundDevice } from './tabs/MainTab';
import DataTab from './tabs/DataTab';
import LogsTab from './tabs/LogsTab';

// 'chrom' and 'spectrum' are both gone as their own tab keys -- Spectrum/
// Chrom/R-Values are now swipeable sub-pages (see SwipablePages) living
// directly on the Main tab, right below its measurement grid, rather than
// a separate tab you have to switch to after every reading. ReadingDetail
// Screen.tsx shows the exact same arrangement for a past reading. 'history'
// and 'about' are gone too -- History is now its own bottom-nav tab
// (HistoryScreen.tsx) and About is a section inside Settings, neither of
// them panels inside Home any more -- see App.tsx for the bottom tab bar.
type TabKey = 'main' | 'data' | 'logs';

// How long a Connect attempt spends collecting matching advertisements
// before deciding how many distinct meters are actually out there. Unlike
// the old scanAndConnect() (gone now -- see MeterConnection.ts), this can't
// just resolve the instant it hears the first match: the whole point is
// knowing whether a SECOND one is also in range, which means waiting out a
// real window rather than racing to the first advertisement.
const CONNECT_SCAN_WINDOW_MS = 5000;
// Space under the Main page, above the pinned action bar.
const MAIN_BOTTOM_PAD = 8;

// Confirmed 2026-10-04 (a debug-report capture): backgrounding the app
// disconnects the meter (see the AppState effect below), and coming back to
// the foreground immediately tries to reconnect -- but in that capture, the
// reconnect's scan started only ~1.7s after the disconnect and came up
// completely empty 3s later, even though the SAME meter had been found
// without any trouble just ~11s before that. The central side (this app)
// finishes its own disconnect quickly, but the PERIPHERAL (the meter) still
// needs its own moment afterward to notice the link dropped and resume
// advertising -- nothing this app's own disconnect() can wait on directly,
// since that's happening entirely on the meter's side. Giving the
// foreground-reconnect path a short head start before it even begins
// scanning (not needed for a manual Connect tap, which already has a human
// pause built in before the person taps it) gives the meter that moment
// instead of racing it.
const FOREGROUND_RECONNECT_DELAY_MS = 1500;

export default function HomeScreen({ navigation }: any) {
  const { colors } = useTheme();
  const { log, appendLog, clearLog, refreshVerboseLogging } = useLog();
  const [activeTab, setActiveTab] = useState<TabKey>('main');
  const [status, setStatus] = useState<Status>('disconnected');
  const [result, setResult] = useState<MeterResult | null>(null);
  const [deviceName, setDeviceName] = useState<string | null>(null);
  // Meter battery (8C C3) -- null until the meter has answered, cleared on disconnect. See the polling effect below.
  const [battery, setBattery] = useState<BatteryStatus | null>(null);
  // The upload title/label the person typed on the Data tab. Deliberately
  // lifted up here rather than kept as local state inside DataTab -- state
  // local to a tab component gets torn down and reset the moment that tab
  // unmounts (which React Native does for inactive tabs in this app's
  // simple activeTab === 'x' && <Tab/> pattern), so a title typed once
  // would vanish the instant you switched to Spectrum and back. Living here
  // in HomeScreen instead means it survives any amount of tab-switching and
  // multiple readings/uploads, and only resets when the app process itself
  // restarts (a fresh useState initializer) -- exactly "persist during a
  // session that isn't reset."
  const [uploadTitle, setUploadTitle] = useState('');
  // Whether the most recent upload attempt for the CURRENT reading
  // succeeded -- drives the small inline checkmark MainTab/DataTab show
  // next to their Upload button instead of a confirmation popup on every
  // single upload. Reset to false the moment a new reading comes in (see
  // measure() below), so a stale checkmark from a previous reading's
  // upload never sits next to a result it doesn't actually describe. A
  // failed attempt doesn't set this at all -- that still raises a real
  // Alert (see upload() below), which is the one outcome worth
  // interrupting for.
  const [uploadSucceeded, setUploadSucceeded] = useState(false);
  // The {id, isPublic} of whichever upload most recently succeeded for the
  // CURRENT reading -- all the copy-link button needs, and all
  // uploadToHcri's response gives it for free (no extra request for a
  // public report; see getReportLink.ts). Cleared alongside
  // uploadSucceeded any time a fresh upload attempt starts, same reasoning
  // as that flag: a link for a PREVIOUS reading's report should never sit
  // next to a checkmark that looks like it's describing this one.
  const [lastUploadedReport, setLastUploadedReport] = useState<{ id: number; isPublic: boolean } | null>(null);
  // The History entry (readingHistory.ts) that measure() just auto-saved
  // the CURRENT reading as -- kept around purely so upload() can write the
  // upload title and the resulting report link back onto that same History
  // row (renameReading/setReadingReportLink) once an upload succeeds,
  // rather than those two staying permanently disconnected the way they
  // were before. Cleared alongside uploadSucceeded/lastUploadedReport the
  // moment a fresh measurement starts, so an upload triggered right after
  // can never accidentally write onto a PREVIOUS reading's History row.
  const [currentReadingId, setCurrentReadingId] = useState<string | null>(null);
  // True while the copy-link button's own request (getReportLink, for a
  // private report only -- a public one resolves with no request) is in
  // flight, so the icon can show a spinner instead of being tappable
  // twice in a row.
  const [copyingLink, setCopyingLink] = useState(false);
  // Cached just for building default labels/previews (defaultLabel()) --
  // the actual upload/measure() paths each load fresh credentials from
  // secureStorage right before they need them, so a stale value here can
  // never cause a reading to upload under the wrong account. This is
  // purely "what should the Upload Title placeholder/preview show right
  // now", which does need to react to Settings changes -- refreshed on
  // mount and again every time this screen regains focus (e.g. coming
  // back from Settings after adding/changing an account).
  const [cachedUsername, setCachedUsername] = useState<string | null>(null);
  // Which measurements MainTab's result card shows, and in what order --
  // the person's own customization from Settings. Starts from the
  // built-in default (defaultStatDisplayPrefs()) so the very first render
  // (before AsyncStorage resolves) shows the same stats it always has,
  // rather than an empty grid for one frame.
  const [statIds, setStatIds] = useState<string[]>(() => visibleStatIds(defaultStatDisplayPrefs()));
  const connRef = useRef<MeterConnection | null>(null);
  // The outer ScrollView both tabs render inside -- handed down to Main/Data
  // so each can scroll its own Upload Title field into view once the
  // keyboard comes up and covers it (see scrollInputIntoView below). Owned
  // here rather than inside each tab since the ScrollView itself is owned
  // here; a tab-local ScrollView ref would have nothing to scroll.
  const scrollRef = useRef<ScrollView>(null);

  // Confirmed 2026-10-04: android:windowSoftInputMode="adjustResize" (see
  // AndroidManifest.xml) resizes the window when the keyboard appears, but
  // that alone doesn't scroll a focused field that's now below the
  // shrunk visible area into view -- the Upload Title field (on both Main
  // and Data) was ending up hidden behind the keyboard with no way to see
  // what you were typing. measureAndScroll takes a ref to the focused
  // TextInput itself (measureLayout needs the actual host component, not
  // just a position) and scrolls it to just below the top of the screen,
  // with a little headroom above.
  const measureAndScroll = useCallback((inputRef: React.RefObject<any>) => {
    const input = inputRef.current;
    const scroller = scrollRef.current;
    if (!input || !scroller) return;
    input.measureLayout(
      scroller,
      (_left: number, top: number) => {
        scroller.scrollTo({ y: Math.max(top - 80, 0), animated: true });
      },
      () => {}
    );
  }, []);

  // Which field (if any) most recently got focus -- kept as a ref, not
  // state, since nothing here needs to re-render off it; it's read back
  // by the keyboardDidShow handler below. Confirmed 2026-10-04: calling
  // measureAndScroll directly from onFocus on a fixed delay (the previous
  // approach) raced the keyboard's own show animation and, separately,
  // the paddingBottom increase below that actually makes room to scroll
  // into -- on a slower show, measuring before either had finished landed
  // short of the field and looked like "it's just not auto-scrolling".
  // Tracking the focused ref here and re-measuring once keyboardDidShow
  // ACTUALLY fires (rather than guessing how long its animation takes)
  // fixes that race. The immediate attempt below still matters for a
  // DIFFERENT case this doesn't cover: switching focus to another field
  // while the keyboard is already up, where keyboardDidShow never fires
  // again (the keyboard's height hasn't changed) -- that scroll has to
  // happen off focus itself, which is why both exist.
  const focusedInputRef = useRef<React.RefObject<any> | null>(null);
  const scrollInputIntoView = useCallback(
    (inputRef: React.RefObject<any>) => {
      focusedInputRef.current = inputRef;
      setTimeout(() => measureAndScroll(inputRef), 120);
    },
    [measureAndScroll]
  );

  // How much extra bottom padding the content needs RIGHT NOW to leave room
  // to scroll a field clear of the keyboard. Confirmed 2026-10-04: the
  // ScrollView's own fixed paddingBottom (56, below -- sized for the home
  // indicator/nav bar, not a keyboard) meant there was simply nowhere left
  // to scroll TO once the keyboard was up -- scrollInputIntoView's own
  // scrollTo() was a no-op near the bottom of the content because the
  // ScrollView had already hit its max scroll offset well short of
  // clearing the keyboard. Tracking the keyboard's real height and adding
  // it as temporary extra padding guarantees there's always enough room
  // below the last bit of content to scroll a lower field all the way
  // clear, no matter how short that tab's content is. 'keyboardDidShow'/
  // 'keyboardDidHide' (not the iOS-only 'Will' variants) fire on both
  // platforms. Reset to 0 on hide so nothing's left over once the keyboard
  // is gone.
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  useEffect(() => {
    const showSub = Keyboard.addListener('keyboardDidShow', (e) => {
      setKeyboardHeight(e.endCoordinates.height);
      // Re-measure now that the keyboard has actually finished showing --
      // see focusedInputRef's own comment above for why this, and not just
      // the onFocus-time attempt, is what fixes the race. Still one more
      // short delay after this: setKeyboardHeight above doesn't take
      // effect in THIS same callback -- it queues a re-render that adds
      // the extra paddingBottom, and the ScrollView needs that render's
      // layout pass to actually commit before its scrollable range grows
      // enough to reach the field. Scrolling synchronously here would race
      // that layout pass the same way the old fixed-delay-from-focus
      // approach raced the keyboard animation.
      if (focusedInputRef.current) {
        setTimeout(() => measureAndScroll(focusedInputRef.current!), 80);
      }
    });
    const hideSub = Keyboard.addListener('keyboardDidHide', () => setKeyboardHeight(0));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, [measureAndScroll]);

  useEffect(() => {
    const loadCachedUsername = () => {
      loadHcriCredentials()
        .then((creds) => setCachedUsername(creds?.username ?? null))
        .catch(() => setCachedUsername(null));
    };
    loadCachedUsername();
    // Also refresh on focus -- otherwise adding/changing the account in
    // Settings and coming back here would still show the OLD username (or
    // none at all) in the Upload Title default until the app fully
    // restarted, since this only ever ran once on mount before.
    const unsubscribe = navigation.addListener('focus', loadCachedUsername);
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigation]);

  useEffect(() => {
    const loadStatIds = () => {
      loadStatDisplayPrefs()
        .then((prefs) => setStatIds(visibleStatIds(prefs)))
        .catch(() => {});
    };
    loadStatIds();
    // Refresh on focus, same reasoning as cachedUsername above -- this
    // screen needs to pick up whatever the person just changed in
    // Settings (reordered/toggled measurements) the moment they come
    // back, not only on the next app launch.
    const unsubscribe = navigation.addListener('focus', loadStatIds);
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigation]);

  // Whether to keep the verbose-only log lines (BLE hex dumps, the raw
  // result body -- see MeterConnection.ts/takeMeasurement.ts's `verbose`
  // flag) when they reach appendLog -- the preference itself now lives in
  // LogContext (shared with HistoryScreen's own appendLog calls), but each
  // screen that cares still refreshes it on focus, same reasoning as
  // cachedUsername/statIds above: picks up a toggle flipped in Settings
  // without needing an app restart.
  useEffect(() => {
    refreshVerboseLogging();
    const unsubscribe = navigation.addListener('focus', refreshVerboseLogging);
    return unsubscribe;
  }, [navigation, refreshVerboseLogging]);

  // Computed ONCE per reading, here, and threaded down to every tab that
  // shows a colorimetric number (Main, Spectrum, Data) -- rather than each
  // tab importing spectralAnalysis and calling analyzeSpectrum() on its own.
  // That would still be *correct* (same function, same inputs, same
  // outputs), but a single shared computation is what actually guarantees
  // "the same algorithm for every calculation in the app" stays true as the
  // app grows -- there is exactly one CCT/Duv/Ra/R9 number in memory for a
  // given result, not three independent calls that happen to agree today.
  const analysis = useMemo(() => (result ? analyzeSpectrum(result.spectrum) : null), [result]);

  // Reuse a single MeterConnection (and the native BleManager it owns)
  // across every Connect attempt. Creating a fresh one each press left the
  // old one's BleManager alive with no cleanup -- Android's BLE stack
  // throttles/ignores scan requests once you rack up enough abandoned
  // scan sessions like that, which is why reconnecting only ever worked
  // again after a full app restart (a fresh process resets the throttle).
  const getConnection = useCallback((): MeterConnection => {
    if (!connRef.current) {
      connRef.current = new MeterConnection(appendLog, () => {
        // Fires when the meter actually drops the BLE link (powered off,
        // out of range, etc.) -- without this, the UI just kept showing
        // "Connected" forever after the fact.
        //
        // Deliberately leaves `result` (the last reading) alone -- see
        // disconnect()'s own comment just below on why a disconnect,
        // whatever caused it, is no longer what clears the Main tab's
        // result card.
        setStatus('disconnected');
        setDeviceName(null);
      });
    }
    return connRef.current;
  }, [appendLog]);

  // The candidates from the most recent scan that found more than one
  // matching meter -- kept around even after connecting (NOT cleared the
  // moment a device is picked/auto-chosen), so MainTab's "switch meter"
  // icon can reopen the exact same list later without a fresh scan. Reset
  // to null whenever a scan comes back with 0 or 1 matches, since then
  // there's nothing to switch between. `devicePickerVisible` is the
  // separate, short-lived flag for whether the overlay itself is up right
  // now -- it starts true the moment multiMeterCandidates is first set
  // (from connect()'s own scan) and goes false on a pick/dismiss, while
  // multiMeterCandidates itself lives on for the icon.
  const [multiMeterCandidates, setMultiMeterCandidates] = useState<FoundDevice[] | null>(null);
  const [devicePickerVisible, setDevicePickerVisible] = useState(false);

  // Guards against stacking a second identical popup if the app-launch
  // connect and a quick Connect tap both land while the first is still up.
  const bluetoothAlertOpenRef = useRef(false);
  const showBluetoothOffAlert = useCallback(() => {
    if (bluetoothAlertOpenRef.current) return;
    bluetoothAlertOpenRef.current = true;
    const done = () => {
      bluetoothAlertOpenRef.current = false;
    };
    Alert.alert(
      'Bluetooth is off',
      'Bluetooth is required to take readings. Turn it on, then tap Connect to Meter.',
      [
        {
          text: 'Open Settings',
          onPress: () => {
            done();
            Linking.sendIntent('android.settings.BLUETOOTH_SETTINGS').catch(() => Linking.openSettings());
          },
        },
        { text: 'OK', style: 'cancel', onPress: done },
      ],
      { cancelable: true, onDismiss: done }
    );
  }, []);

  /**
   * `preferLastDeviceOnMultiple`: used by the "app came back to the
   * foreground after we auto-disconnected it" path below, NOT by a fresh
   * app launch or a manual tap on Connect. In that one case, popping up a
   * picker the person didn't ask for every time they switch back to the
   * app (with some other meter now also in range) would be more annoying
   * than useful -- reconnecting to whichever meter was connected right
   * before backgrounding is almost always what's actually wanted. If that
   * meter isn't among what's currently in range (out of range now, or this
   * is the very first connect of the session with nothing recorded yet),
   * this still falls back to the normal picker rather than guessing.
   */
  const connect = useCallback(
    async (opts?: { preferLastDeviceOnMultiple?: boolean; promptIfBluetoothOff?: boolean }) => {
      // Clear a test reading in the same batch as the status change, so it
      // never gets a rendered frame beside the "Connecting…" button.
      if (resultRef.current?.sampleLabel) {
        setResult(null);
        setUploadTitle('');
        setUploadSucceeded(false);
        setLastUploadedReport(null);
        setCurrentReadingId(null);
      }
      setStatus('connecting');
      try {
        const conn = getConnection();
        // Only the two "the person is actively trying to connect" entry
        // points ask for this (app launch and the Connect to Meter button)
        // -- NOT the foreground-return auto-reconnect, which would otherwise
        // pop this up every time they switch back to the app with Bluetooth
        // off. Anything other than a definite 'PoweredOff' (including an
        // 'Unknown' while permissions are still being granted) just carries
        // on into the normal flow below.
        if (opts?.promptIfBluetoothOff && (await conn.getBluetoothState()) === 'PoweredOff') {
          appendLog('Bluetooth is off -- prompting.');
          showBluetoothOffAlert();
          setStatus('disconnected');
          return;
        }
        // Clears any BLE connection to the meter left over from a previous
        // app/JS session (see MeterConnection.resetStaleConnection() for why
        // this is needed -- it's what used to require a power cycle after
        // reloading the app with the meter still connected). Cheap/harmless
        // when there's nothing stale to clear.
        await conn.resetStaleConnection();
        const lastIdForScan = await loadLastDeviceId().catch(() => null);
        const candidates = await conn.scanForKnownMeters(CONNECT_SCAN_WINDOW_MS, { preferDeviceId: lastIdForScan });

        if (candidates.length === 0) {
          setMultiMeterCandidates(null);
          throw new Error('Meter not found -- make sure it is powered on and in range');
        }

        if (candidates.length === 1) {
          setMultiMeterCandidates(null);
          await conn.connectToDevice(candidates[0].id);
          await initializeMeter(conn);
          setDeviceName(conn.getDeviceName());
          setStatus('connected');
          return;
        }

        // More than one match -- remember the list either way (so the
        // switch-meter icon works later even if we silently pick one
        // below), then decide whether that's a silent pick or a picker.
        const mapped = candidates.map((d) => ({ id: d.id, name: d.name, rssi: d.rssi }));
        setMultiMeterCandidates(mapped);

        const lastId = opts?.preferLastDeviceOnMultiple ? await loadLastDeviceId().catch(() => null) : null;
        const lastMatch = lastId ? candidates.find((d) => d.id === lastId) : undefined;
        if (lastMatch) {
          await conn.connectToDevice(lastMatch.id);
          await initializeMeter(conn);
          setDeviceName(conn.getDeviceName());
          setStatus('connected');
          return;
        }

        // Either this is a fresh launch/manual Connect (always asks when
        // there's more than one), or it's a foreground-reconnect that
        // couldn't find the previously-connected meter among what's in
        // range now -- either way, nothing safe to guess, so ask.
        setDevicePickerVisible(true);
        setStatus('disconnected');
      } catch (e: any) {
        appendLog(`Connect failed: ${e.message}`);
        setStatus('disconnected');
      }
    },
    [appendLog, getConnection, showBluetoothOffAlert]
  );

  /** Called when the person taps a device in the picker overlay -- whether it just opened from connect()'s own scan, or was reopened later via the "switch meter" icon while already connected to a different one of the same candidates. */
  const selectDeviceFromPicker = useCallback(
    async (deviceId: string) => {
      setDevicePickerVisible(false);
      setStatus('connecting');
      try {
        const conn = getConnection();
        // Only relevant for the switch-meter case: a previous meter may
        // still be connected, and connectToDevice() doesn't drop an
        // existing connection on its own before opening a new one.
        if (conn.isConnected()) {
          await conn.disconnect();
        }
        await conn.connectToDevice(deviceId);
        await initializeMeter(conn);
        setDeviceName(conn.getDeviceName());
        setStatus('connected');
      } catch (e: any) {
        appendLog(`Connect failed: ${e.message}`);
        setStatus('disconnected');
      }
    },
    [appendLog, getConnection]
  );

  /** The "switch meter" icon next to the status row -- reopens the overlay with the already-known candidate list, no rescan. Only ever enabled (see MainTab) when multiMeterCandidates actually has 2+ entries. */
  const openDevicePicker = useCallback(() => {
    setDevicePickerVisible(true);
  }, []);

  const dismissDevicePicker = useCallback(() => {
    setDevicePickerVisible(false);
  }, []);

  // Starting to connect a meter ends the "test reading" -- the sample's stats/charts,
  // its note, and the upload title all go away, back to the empty state,
  // rather than leaving someone else's spectrum on screen looking like a
  // real reading. Reads `result` through a ref so this fires only on the
  // status change itself, not every time a result changes.
  const resultRef = useRef(result);
  resultRef.current = result;
  useEffect(() => {
    // 'connecting' is the moment Connect to Meter is tapped -- clear then,
    // not once the connection finishes.
    if (status === 'disconnected' || !resultRef.current?.sampleLabel) return;
    setResult(null);
    setUploadTitle('');
    setUploadSucceeded(false);
    setLastUploadedReport(null);
    setCurrentReadingId(null);
  }, [status]);

  // Tapping the Home tab always lands on Main -- including when you're
  // already on Home looking at Data or Logs (standard tab-bar behavior:
  // tapping a tab takes you to its starting page) -- and scrolls it back
  // to the top.
  // Android Back: from Data/Logs go back to Main first (Main then lets the tab navigator / system
  // handle it, which returns to the app's first screen or leaves the app).
  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        if (activeTab !== 'main') {
          setActiveTab('main');
          return true;
        }
        return false;
      });
      return () => sub.remove();
    }, [activeTab]),
  );

  useEffect(() => {
    const unsubscribe = navigation.addListener('tabPress', () => {
      setActiveTab('main');
      scrollRef.current?.scrollTo({ y: 0, animated: true });
    });
    return unsubscribe;
  }, [navigation]);

  // Try to connect automatically as soon as the app opens, rather than
  // requiring a manual tap on "Connect to Meter" every time -- if the
  // meter's already powered on and in range, this gets straight to
  // "Connected" with no user action needed. If it's not found (meter off,
  // out of range, etc.) this just fails quietly into the normal
  // disconnected state, same as if Connect had been pressed and timed out;
  // the button is still there to retry manually. No preferLastDeviceOnMultiple
  // here -- this is a fresh app launch, not a reconnect, so if more than one
  // meter is in range it should pop up the picker same as a manual tap
  // would, not silently guess.
  useEffect(() => {
    connect({ promptIfBluetoothOff: true });
    // Intentionally run once on mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep-awake, gated by the Settings toggle (see preferences.ts). Checked
  // fresh on every status change rather than cached once, so toggling the
  // setting mid-session takes effect on the NEXT connect/disconnect without
  // needing to restart the app. "While connected to a device" is read as
  // any non-disconnected status (connecting/connected/measuring/uploading),
  // not just the exact instant a reading is in progress -- disableKeepAwake()
  // is always safe to call even when it was never enabled.
  useEffect(() => {
    let cancelled = false;
    if (status === 'disconnected') {
      disableKeepAwake();
      return;
    }
    loadKeepAwakePreference().then((enabled) => {
      if (!cancelled && enabled) enableKeepAwake();
    });
    return () => {
      cancelled = true;
    };
  }, [status]);

  // Safety net for the case where HomeScreen itself unmounts while keep-awake
  // is active (e.g. ErrorBoundary caught a crash and remounted this screen
  // fresh) -- the status-keyed effect above wouldn't get a chance to clean
  // up on its own in that case, since its own cleanup only runs on the NEXT
  // status change, which never comes if this component is gone.
  useEffect(() => {
    return () => disableKeepAwake();
  }, []);

  // Manual escape hatch for the same stale-connection problem connect()
  // already guards against automatically -- for the case where it still
  // doesn't help on its own (e.g. this is the very first launch after
  // installing this fix, so there's no persisted last-device-id yet to
  // clear) and a visible "try this" action is more useful than silently
  // retrying the same thing. Explicitly clears, then does a normal connect.
  const resetConnection = useCallback(async () => {
    const conn = getConnection();
    appendLog('Manual reset requested -- clearing any stale connection...');
    await conn.resetStaleConnection().catch((e: any) => appendLog(`Reset failed: ${e.message}`));
    await connect();
  }, [appendLog, getConnection, connect]);

  // "Show a test reading" (Main tab, no meter connected): loads a random
  // public hCRI.io report's spectrum into the result view so the stats and
  // charts can be tried out without a meter. Deliberately NOT saved to
  // History and blocked from Upload/Share (see isSampleBlocked below) --
  // it's someone else's data, not a reading this person took.
  const [loadingTestReading, setLoadingTestReading] = useState(false);
  const showTestReading = useCallback(async () => {
    if (loadingTestReading) return;
    setLoadingTestReading(true);
    try {
      const sample = await fetchSampleReading();
      setResult(sample);
      setUploadSucceeded(false);
      setLastUploadedReport(null);
      setCurrentReadingId(null);
      appendLog(`Loaded test reading from hCRI.io: ${sample.sampleLabel}`);
    } catch (e: any) {
      appendLog(`Test reading failed: ${e.message}`);
      Alert.alert('Could not load a test reading', e.message ?? 'Check your connection and try again.');
    } finally {
      setLoadingTestReading(false);
    }
  }, [loadingTestReading, appendLog]);

  const blockSampleAction = useCallback((what: string) => {
    Alert.alert('Test reading', `This is a sample from a public hCRI.io report, so it can't be ${what}. Take a real reading to do that.`);
  }, []);

  const measure = useCallback(async () => {
    if (!connRef.current) return;
    setStatus('measuring');
    try {
      // An all-zero result (the meter handing back an empty buffer, seen on
      // the first reading after connecting) is retried once automatically
      // rather than shown as a blank chart with nonsense stats.
      let r: MeterResult;
      try {
        r = await takeMeasurement(connRef.current, appendLog);
      } catch (e: any) {
        if (e?.name !== EMPTY_READING_ERROR) throw e;
        appendLog('Meter returned an empty reading -- retrying once...');
        r = await takeMeasurement(connRef.current, appendLog);
      }
      setResult(r);
      // A fresh reading hasn't been uploaded yet -- clears any checkmark
      // left over from the PREVIOUS reading's upload, which would
      // otherwise keep showing next to a result it no longer describes.
      setUploadSucceeded(false);
      setCurrentReadingId(null);
      setStatus('connected');
      hapticSuccess();

      // Auto-save every completed measurement to History -- this is what
      // makes History a real record of the session rather than something
      // you have to remember to do manually per reading. Uses the same
      // username+timestamp+device default the upload title fields fall
      // back to, so a reading you never got around to renaming still
      // uploads under something identifiable rather than a bare
      // timestamp -- renaming (from the History tab) is still how you give
      // it a more meaningful name. History is now its own top-level screen
      // (HistoryScreen.tsx) with its own copy of the saved list, loaded
      // fresh from storage on focus -- so this just persists the reading;
      // it doesn't need to update any local list here.
      try {
        const creds = await loadHcriCredentials();
        const label = defaultLabel(creds?.username ?? null, r.deviceName);
        const saved = await addReading(r, label);
        // So a later upload() of THIS reading can sync its title and
        // report link back onto this exact History row -- see
        // currentReadingId's own comment above.
        setCurrentReadingId(saved.id);
      } catch (e: any) {
        // Don't let a storage hiccup here look like the measurement itself
        // failed -- the reading is still shown/usable, it just didn't get
        // added to History this time.
        appendLog(`Failed to save reading to history: ${e.message}`);
      }
    } catch (e: any) {
      appendLog(`Measurement failed: ${e.message}`);
      setStatus('connected');
      hapticFailure();
      // Root cause of "it shows the same reading every time" (2026-09-28):
      // on a failed measurement (most commonly a timeout), `result` was
      // simply never touched -- so the Main tab kept showing whatever the
      // LAST successful reading happened to be, with no visible sign that
      // anything had gone wrong. The failure message only ever reached
      // appendLog (the Logs tab), which nothing steers you toward checking
      // after a normal-looking "reading". That silence is what made a
      // failed reading indistinguishable from a genuine duplicate one.
      // A real Alert here is the fix -- it's the one place in this flow
      // the person is guaranteed to actually see, right when it happens.
      Alert.alert('Measurement failed', e.message ?? 'The meter did not respond in time. Try again.');
    }
  }, [appendLog]);

  const disconnect = useCallback(async () => {
    if (!connRef.current) return;
    try {
      await connRef.current.disconnect();
    } catch (e: any) {
      appendLog(`Disconnect failed: ${e.message}`);
    }
    // Update immediately rather than waiting on the onDisconnected callback --
    // that callback fires from the device's own disconnect event, which is
    // reliable when the meter drops the link on its own, but a
    // user-initiated disconnect should feel instant.
    //
    // Confirmed 2026-10-03: `result` used to be cleared right here too,
    // wiping the Main tab's result card the instant the meter dropped --
    // whether that was a manual Disconnect tap, the meter losing power or
    // range on its own, or the AppState background-disconnect above. That
    // made the last reading disappear far more often than the person
    // actually wanted it gone, since none of those are "I'm done, forget
    // this reading" -- they're all just "not connected to a meter right
    // now." The reading itself is still sitting right there in
    // MainTab/SpectrumTab's props either way (disconnected just hides the
    // Take Reading/Disconnect buttons under it -- see MainTab.tsx), so
    // there's no reason to throw it away: it should persist across any
    // number of connects/disconnects within the same app session, and
    // only actually reset on a genuine cold start, which already happens
    // for free since `result`'s useState(null) above starts fresh every
    // time this component mounts from scratch.
    setStatus('disconnected');
    setDeviceName(null);
  }, [appendLog]);

  // Disconnects the meter the moment the app leaves the foreground
  // (minimized, switched away from, screen locked) -- matches the stock
  // Hopoocolor app, which drops the BLE link on close/minimize; this app
  // previously stayed connected indefinitely in the background instead.
  // Left connected, a backgrounded app keeps the meter's BLE radio awake
  // (draining its battery for no reason once nobody's looking at it) and,
  // on Android in particular, risks the exact stale-connection state
  // resetStaleConnection()/resetConnection() above exist to clean up.
  //
  // Reads live status off a ref rather than depending on `status` directly,
  // so this effect subscribes to AppState exactly once for the component's
  // lifetime instead of tearing down and re-adding the listener on every
  // status change.
  const statusRef = useRef(status);
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  // Meter battery: read once shortly after each (re)entry into 'connected'
  // -- which also happens right after every reading and upload finishes --
  // then every 60s while it stays connected. Never runs during 'measuring'
  // (the effect only polls while status === 'connected'), so it can't
  // overlap a reading. A missing/invalid answer just leaves the last value
  // (or nothing) showing.
  useEffect(() => {
    if (status === 'disconnected') {
      setBattery(null);
      return;
    }
    if (status !== 'connected') return;
    let cancelled = false;
    const poll = async () => {
      const conn = connRef.current;
      if (!conn || !conn.isConnected()) return;
      const b = await conn.readBattery();
      if (!cancelled && b && statusRef.current === 'connected') setBattery(b);
    };
    const first = setTimeout(poll, 400);
    const id = setInterval(poll, 60000);
    return () => {
      cancelled = true;
      clearTimeout(first);
      clearInterval(id);
    };
  }, [status]);

  // Whether a share sheet (or anything else that briefly hands control to
  // the OS) is up right now -- see ../ble/backgroundDisconnectGuard.ts.
  // Sharing a CSV (shareCsv.ts's RNShare.open) puts up the native share
  // sheet, which iOS reports as the app going 'inactive' -- the exact same
  // AppState transition as the app switcher or an incoming call, which is
  // genuinely supposed to disconnect per the comment above. Without this,
  // every single CSV share disconnected the meter, which isn't "the person
  // switched away from the app" at all -- they're still looking at it,
  // just with a system sheet over it. Lives in a shared module, not a ref
  // here, because History (its own top-level tab now, not a panel inside
  // Home) can also put up a share sheet and needs to be able to set this
  // same flag.

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextAppState) => {
      if (nextAppState === 'active') {
        // Coming back to the foreground -- always try to reconnect if
        // there's no meter connected right now, no matter WHY there isn't
        // one: this used to only fire when THIS app's own backgrounding
        // branch (below) was what disconnected it, which meant coming
        // back to a meter that was already disconnected before
        // backgrounding (or never connected at all this session) just sat
        // there disconnected until the person tapped Connect themselves.
        // statusRef.current (not the `status` that triggered this effect
        // -- see this effect's own dep comment) is checked rather than
        // skipped entirely, so this doesn't fire a redundant connect() on
        // top of one already in flight (mount's own connect(), a manual
        // tap, a reconnect from a previous foreground event) or try to
        // "reconnect" something that's already connected.
        if (statusRef.current === 'disconnected') {
          appendLog('App back in foreground -- reconnecting to meter...');
          // 'connecting' right away, even though the actual scan is about
          // to be held off for a moment (see FOREGROUND_RECONNECT_DELAY_MS
          // above) -- otherwise the status row would just keep showing
          // "Disconnected" for that whole delay, looking like nothing was
          // happening rather than like a reconnect already in progress.
          setStatus('connecting');
          setTimeout(() => {
            // Status could have changed during the delay (the person
            // backgrounded again, or tapped Connect/Disconnect themselves)
            // -- only actually follow through if it's still exactly the
            // "waiting to reconnect" state this timer was set up for.
            if (statusRef.current !== 'connecting') return;
            // preferLastDeviceOnMultiple: true -- this is a reconnect, not a
            // fresh choice, so if more than one meter happens to be in range
            // right now, silently go back to the one that was connected
            // before backgrounding rather than popping up a picker the
            // person didn't ask for (see connect()'s own comment on this).
            connect({ preferLastDeviceOnMultiple: true });
          }, FOREGROUND_RECONNECT_DELAY_MS);
        }
        return;
      }
      // 'background' and 'inactive' both mean "not what the person is
      // currently looking at" (iOS also passes through 'inactive' briefly
      // for things like the app switcher or an incoming call, which should
      // disconnect same as a real background) -- EXCEPT when it's our own
      // share sheet doing that, which isn't the person leaving the app.
      if (isBackgroundDisconnectSuppressed()) {
        appendLog(`App moved to ${nextAppState} during a share -- not disconnecting.`);
        return;
      }
      if (statusRef.current === 'disconnected') return;
      // Stay-connected is the default (see preferences.ts) -- most trips to
      // the background are brief (checking something else, a screen lock,
      // an incoming call) and not actually "done with this session," so
      // dropping the BLE link on every single one of those used to mean a
      // full re-scan/re-handshake on every return trip. Flipping the
      // Settings toggle off restores the original always-disconnect
      // behavior (and its battery savings) for anyone who'd rather have
      // that instead.
      //
      // Read fresh from storage right here, rather than off a ref kept in
      // sync by this screen's own focus events -- this screen can easily
      // still be mounted-but-not-focused (the bottom tab bar keeps every
      // tab's screen alive) when the person flips this in Settings and
      // then backgrounds the app straight from there, never revisiting
      // Main first. A focus-refreshed ref would stay stale through
      // exactly that path, which is what made the toggle look like it
      // wasn't being respected.
      loadStayConnectedInBackgroundPreference().then((stayConnected) => {
        // Re-check what's actually true by the time this resolves (still
        // backgrounded, still connected, not mid-share) rather than acting
        // on whatever was true when the AppState event first fired --
        // this is an async gap, however short, and the app could have
        // come back to the foreground or started a share in the meantime.
        if (AppState.currentState === 'active') return;
        if (isBackgroundDisconnectSuppressed()) return;
        if (statusRef.current === 'disconnected') return;
        if (stayConnected) {
          appendLog(`App moved to ${nextAppState} -- staying connected (see Settings to change this).`);
          return;
        }
        appendLog(`App moved to ${nextAppState} -- disconnecting meter.`);
        disconnect();
      });
    });
    return () => subscription.remove();
  }, [appendLog, connect, disconnect]);

  const upload = useCallback(async () => {
    if (!result) return;
    if (result.sampleLabel) {
      blockSampleAction('uploaded');
      return;
    }
    // Tapping Upload is "I'm done editing the title" regardless of whether
    // the field still has focus -- the keyboard sitting there through the
    // whole upload (and the extra scroll padding it forces, see
    // keyboardHeight above) just wastes screen space for something no
    // longer being typed into. Dismissing up front, not after the upload
    // resolves, also means a slow request doesn't leave it hanging open
    // for no reason in the meantime.
    Keyboard.dismiss();
    const creds = await loadHcriCredentials();
    if (!creds) {
      Alert.alert('No hCRI.io account set up', 'Add your username and API token first.', [
        { text: 'Go to Settings', onPress: () => navigation.navigate('Settings') },
        { text: 'Cancel', style: 'cancel' },
      ]);
      return;
    }

    setStatus('uploading');
    // Clears any checkmark (and copy-link icon) left over from a previous
    // attempt on this same reading while this one is in flight, rather
    // than leaving a stale "succeeded" showing during a retry.
    setUploadSucceeded(false);
    setLastUploadedReport(null);
    const csv = buildCsv(result);
    // Use whatever the person typed as the upload title if there's anything
    // there; fall back to the generated username+timestamp label only when
    // the field's genuinely empty, rather than silently ignoring a typed
    // title.
    const label = uploadTitle.trim() || defaultLabel(creds.username, result.deviceName);
    const res = await uploadToHcri(csv, label, creds.token, appendLog);
    // The raw server response (res.message -- hCRI.io's API returns JSON)
    // still goes to Logs for anyone actually debugging an upload either way.
    appendLog(res.message);
    if (res.success) {
      // No confirmation popup on success any more -- MainTab/DataTab show
      // a small inline checkmark next to the Upload button instead, so a
      // routine upload doesn't need a tap-to-dismiss modal every time.
      setUploadSucceeded(true);
      hapticSuccess();
      // Only set when the server actually returned both fields (see
      // UploadResult's own comment) -- an older/unexpected response shape
      // just means no copy-link icon shows, not a broken upload.
      if (typeof res.reportId === 'number' && typeof res.isPublic === 'boolean') {
        setLastUploadedReport({ id: res.reportId, isPublic: res.isPublic });
      }
      // Sync this upload back onto the matching History row -- the title
      // just uploaded under (so a custom title typed here shows up as this
      // reading's name in History too, not just in the upload itself) and
      // the resulting report link (so History can offer the same Copy
      // Link affordance later, even after this reading stops being the
      // "current" one). One atomic recordUpload() call, not a separate
      // rename + setReadingReportLink fired side by side -- two concurrent
      // read-modify-writes race each other and the later one to finish
      // silently clobbers the other's change, which is exactly what made
      // some uploaded readings end up with a synced title but no Copy Link
      // (or neither) instead of both. Best-effort: a storage hiccup here
      // shouldn't make an otherwise-successful upload look like it failed.
      if (currentReadingId) {
        recordUpload(currentReadingId, label, res.reportId, res.isPublic).catch((e: any) =>
          appendLog(`Failed to sync upload to history: ${e.message}`)
        );
      }
    } else {
      // A failure is still worth interrupting for -- this is the one
      // outcome that keeps the real Alert.
      hapticFailure();
      Alert.alert('Upload failed', `Could not upload "${label}". Check Logs for details.`);
    }
    setStatus('connected');
  }, [result, navigation, appendLog, uploadTitle, currentReadingId, blockSampleAction]);

  // Resolves the current lastUploadedReport into a link (see
  // getReportLink.ts) and puts it on the clipboard. Needs its own fresh
  // credentials load (same reasoning as upload() above -- never trust a
  // cached token) since this can be tapped a while after the upload
  // itself finished.
  const copyReportLink = useCallback(async () => {
    if (!lastUploadedReport) return;
    const creds = await loadHcriCredentials();
    if (!creds) {
      Alert.alert('No hCRI.io account set up', 'Add your username and API token first.', [
        { text: 'Go to Settings', onPress: () => navigation.navigate('Settings') },
        { text: 'Cancel', style: 'cancel' },
      ]);
      return;
    }
    setCopyingLink(true);
    const res = await getReportLink(
      lastUploadedReport.id,
      lastUploadedReport.isPublic,
      creds.token,
      appendLog
    );
    setCopyingLink(false);
    if (res.success && res.link) {
      Clipboard.setString(res.link);
      appendLog(`Copied report link: ${res.link}`);
    } else {
      Alert.alert('Could not get link', res.message || 'Something went wrong. Please try again.');
    }
  }, [lastUploadedReport, navigation, appendLog]);

  // History's own rename/delete/upload/share handlers now live in
  // HistoryScreen.tsx -- History is its own top-level tab, not a panel
  // inside Home, so it owns its own copy of the saved-reading list (loaded
  // fresh from storage on focus) rather than reaching back into this
  // screen's state.

  const shareCurrentCsv = useCallback(() => {
    if (!result) return;
    if (result.sampleLabel) {
      blockSampleAction('shared');
      return;
    }
    // Same label the current reading would upload under, so "share" and
    // "upload" always agree on what this reading is called.
    const label = uploadTitle.trim() || defaultLabel(cachedUsername, result.deviceName);
    withBackgroundDisconnectSuppressed(() => shareSingleReadingCsv(result, label));
  }, [result, uploadTitle, cachedUsername, blockSampleAction]);

  const shareLog = useCallback(() => {
    withBackgroundDisconnectSuppressed(() => shareDebugLog(log));
  }, [log]);

  const isBusy = status === 'connecting' || status === 'measuring' || status === 'uploading';

  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    // paddingBottom is extra-generous (not just enough to clear the home
    // indicator/nav bar) because this ScrollView is shared by every tab --
    // Data's own content (collapsible sections expanded) can run
    // considerably taller than Main's, and this is the one padding value
    // that has to leave room for that without the bottom-most content ever
    // crowding the edge of the screen.
    //
    // paddingTop isn't needed any more at all -- it used to be the gap
    // under the "hCRI Companion" title/gear header, then (once that was
    // dropped) the gap under the safe-area inset; now tabBarWrap below
    // supplies its own bottom padding as the gap between the docked tab
    // bar and the first bit of scrolling content, so this would just be a
    // second gap stacked on top of that one.
    content: { paddingHorizontal: 16, paddingBottom: 56 + keyboardHeight },
    // Main fits the screen without scrolling (see MainTab availableHeight).
    mainArea: { flex: 1, paddingHorizontal: 16, paddingBottom: MAIN_BOTTOM_PAD },
    // Explicit flex:1 (new now that this ScrollView is conditionally
    // rendered as a sibling of LogsTab -- see the activeTab==='logs'
    // branch above) rather than relying on it picking up the remaining
    // space implicitly -- makes it behave identically to LogsTab's own
    // flex:1 root either way, instead of leaving which one actually fills
    // the screen down to however Yoga happens to size an unstyled
    // ScrollView here.
    scrollArea: { flex: 1 },
    // The docked header sitting above the ScrollView -- NOT inside its
    // contentContainerStyle any more (see the TabBar render below): a
    // sibling View here can't scroll away with the rest of the content,
    // which is the whole point of docking it (made it possible to jump to
    // Logs/Data without scrolling back to the top of a long tab first).
    // Carries the horizontal padding content's contentContainerStyle also
    // has, since this View is now a sibling of the ScrollView rather than
    // living inside its padded content area.
    tabBarWrap: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12, flexDirection: 'row', alignItems: 'center' },
    tabBarFlex: { flex: 1 },
    headerInfo: { marginLeft: 10 },
  });

  return (
    // 'top' dropped from edges when a dev build's orange banner (see
    // App.tsx/DevBuildBanner.tsx) is showing -- it sits directly above
    // this screen and already has its OWN SafeAreaView reserving the
    // status-bar/notch inset for itself. react-native-safe-area-context's
    // insets are a fixed measurement of the device's physical safe area,
    // not a shrinking budget that accounts for how much of it a sibling
    // already used -- so with both this screen AND the banner each
    // requesting the 'top' edge, the inset got reserved twice, stacking
    // into a large dead gap above the tab bar that's only there in dev
    // builds. Production builds have no banner, so 'top' is still needed
    // there to clear the status bar/notch directly.
    <SafeAreaView style={styles.container} edges={IS_DEV_BUILD ? ['left', 'right'] : ['top', 'left', 'right']}>
      {/* Docked -- a sibling of the ScrollView below, not inside it, so it
          stays on screen no matter how far down a long Data tab you've
          scrolled. No title/gear header any more -- "hCRI Companion" was
          just branding, not information, and Settings is now its own
          bottom tab rather than a button here (see App.tsx). */}
      <View style={styles.tabBarWrap}>
        <View style={styles.tabBarFlex}>
          <TabBar
            tabs={[
              { key: 'main', label: 'Main' },
              { key: 'data', label: 'Data' },
              { key: 'logs', label: 'Logs' },
            ]}
            active={activeTab}
            onChange={setActiveTab}
          />
        </View>
        <InfoButton
          title="About hCRI Companion"
          message="hCRI Companion connects to your Hopoocolor spectrometer over Bluetooth, takes a reading and shows its spectrum and lighting stats (CCT, CRI and TM-30 Rf/Rg). Every reading is saved to History, and you can optionally upload it to your hCRI.io account to see its full TM-30 report and share it. To upload, add your hCRI.io username and API token in Settings. Tap Settings to choose which measurements show. No meter handy? Test reading loads a random public hCRI.io report so you can try the charts (sample data: it isn't saved or uploadable). Meter won't connect? Press and hold Connect to Meter to reset the connection."
          style={styles.headerInfo}
        />
      </View>
      {/* Logs is NOT rendered inside this ScrollView -- see LogsTab.tsx's
          own file-level comment for why: nested inside here, dragging
          past the end of the log's own inner scroller used to hand the
          gesture off to THIS ScrollView, dragging the tab bar above (and
          LogsTab's own Share/Clear buttons) up off-screen with it. As a
          flex:1 sibling instead, there's nothing above it that CAN
          scroll, so that hand-off has nowhere to go. */}
      {activeTab === 'logs' ? (
        <LogsTab log={log} onShare={shareLog} onClear={clearLog} />
      ) : (
      activeTab === 'main' ? (
      <View style={styles.mainArea}>
          <MainTab
            status={status}
            isBusy={isBusy}
            result={result}
            analysis={analysis}
            connect={() => connect({ promptIfBluetoothOff: true })}
            onShowTestReading={showTestReading}
            loadingTestReading={loadingTestReading}
            measure={measure}
            disconnect={disconnect}
            resetConnection={resetConnection}
            devicePickerDevices={multiMeterCandidates}
            devicePickerVisible={devicePickerVisible}
            onOpenDevicePicker={openDevicePicker}
            onSelectDevice={selectDeviceFromPicker}
            onDismissDevicePicker={dismissDevicePicker}
            onUpload={upload}
            uploading={status === 'uploading'}
            uploadSucceeded={uploadSucceeded}
            canCopyLink={!!lastUploadedReport}
            copyingLink={copyingLink}
            onCopyLink={copyReportLink}
            statIds={statIds}
            connectedDeviceName={deviceName}
            battery={battery}
            uploadTitle={uploadTitle}
            onUploadTitleChange={setUploadTitle}
            cachedUsername={cachedUsername}
            scrollInputIntoView={scrollInputIntoView}
          />
      </View>
      ) : (
      <ScrollView ref={scrollRef} style={styles.scrollArea} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {activeTab === 'data' && (
          <DataTab
            result={result}
            analysis={analysis}
            onUpload={upload}
            uploading={status === 'uploading'}
            uploadSucceeded={uploadSucceeded}
            canCopyLink={!!lastUploadedReport}
            copyingLink={copyingLink}
            onCopyLink={copyReportLink}
            scrollInputIntoView={scrollInputIntoView}
            uploadTitle={uploadTitle}
            onUploadTitleChange={setUploadTitle}
            onShareCsv={shareCurrentCsv}
            cachedUsername={cachedUsername}
          />
        )}
      </ScrollView>
      ))}
      {activeTab === 'main' && (
        <ActionBar
          status={status}
          hasReading={!!(result && analysis)}
          isSample={!!result?.sampleLabel}
          connect={() => connect({ promptIfBluetoothOff: true })}
          measure={measure}
          disconnect={disconnect}
          onShowTestReading={showTestReading}
          loadingTestReading={loadingTestReading}
          onUpload={upload}
          uploading={status === 'uploading'}
          uploadSucceeded={uploadSucceeded}
          canCopyLink={!!lastUploadedReport}
          copyingLink={copyingLink}
          onCopyLink={copyReportLink}
          onResetConnection={resetConnection}
        />
      )}
    </SafeAreaView>
  );
}
