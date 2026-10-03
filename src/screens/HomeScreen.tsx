// src/screens/HomeScreen.tsx
//
// Owns all app state (BLE connection, status, latest result, debug log)
// and the tab bar. Each tab's actual UI lives in its own file under
// ./tabs/ for modularity -- this file just wires state/callbacks to
// whichever tab is active. Only MainTab touches the connection lifecycle
// (connect/disconnect/scan); Spectrum, Data, and Logs are read-only views
// of whatever the last reading and log happen to be.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, ScrollView, StyleSheet, Alert, AppState } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MeterConnection } from '../ble/MeterConnection';
import { initializeMeter, takeMeasurement } from '../ble/takeMeasurement';
import { MeterResult } from '../ble/parseResult';
import { analyzeSpectrum } from '../utils/spectralAnalysis';
import { buildCsv, defaultLabel } from '../hcri/buildCsv';
import { uploadToHcri } from '../hcri/uploadToHcri';
import { loadHcriCredentials, loadLastDeviceId } from '../storage/secureStorage';
import { loadKeepAwakePreference } from '../storage/preferences';
import { loadStatDisplayPrefs, visibleStatIds, defaultStatDisplayPrefs } from '../storage/statDisplayPrefs';
import { addReading } from '../storage/readingHistory';
import { IS_DEV_BUILD } from '../hcri/buildTarget';
import { shareDebugLog } from '../utils/shareLog';
import { shareSingleReadingCsv } from '../utils/shareCsv';
import { hapticSuccess, hapticFailure } from '../utils/haptics';
import { enableKeepAwake, disableKeepAwake } from '../utils/keepAwake';
import { useTheme } from '../contexts/ThemeContext';
import { useLog } from '../contexts/LogContext';
import { withBackgroundDisconnectSuppressed, isBackgroundDisconnectSuppressed } from '../ble/backgroundDisconnectGuard';
import TabBar from '../components/TabBar';
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
const CONNECT_SCAN_WINDOW_MS = 3000;

export default function HomeScreen({ navigation }: any) {
  const { colors } = useTheme();
  const { log, appendLog, clearLog, refreshVerboseLogging } = useLog();
  const [activeTab, setActiveTab] = useState<TabKey>('main');
  const [status, setStatus] = useState<Status>('disconnected');
  const [result, setResult] = useState<MeterResult | null>(null);
  const [deviceName, setDeviceName] = useState<string | null>(null);
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
        setStatus('disconnected');
        setResult(null);
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
    async (opts?: { preferLastDeviceOnMultiple?: boolean }) => {
      setStatus('connecting');
      try {
        const conn = getConnection();
        // Clears any BLE connection to the meter left over from a previous
        // app/JS session (see MeterConnection.resetStaleConnection() for why
        // this is needed -- it's what used to require a power cycle after
        // reloading the app with the meter still connected). Cheap/harmless
        // when there's nothing stale to clear.
        await conn.resetStaleConnection();
        const candidates = await conn.scanForKnownMeters(CONNECT_SCAN_WINDOW_MS);

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
    [appendLog, getConnection]
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
    connect();
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

  const measure = useCallback(async () => {
    if (!connRef.current) return;
    setStatus('measuring');
    try {
      const r = await takeMeasurement(connRef.current, appendLog);
      setResult(r);
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
        await addReading(r, label);
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
    setStatus('disconnected');
    setResult(null);
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

  // Set only by the backgrounding branch below, and only when there was
  // actually something connected to drop -- distinguishes "disconnected
  // because the app just backgrounded itself" from "already disconnected
  // for some other reason (never connected, meter dropped the link on its
  // own, person tapped Disconnect manually)". The foreground branch uses
  // this to reconnect automatically ONLY in the first case: reconnecting
  // after a deliberate manual disconnect would silently undo the thing the
  // person just chose to do, the moment they switch back to the app.
  const autoDisconnectedRef = useRef(false);

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
        // Coming back to the foreground -- reconnect if (and only if) we're
        // the ones who disconnected on the way out.
        if (autoDisconnectedRef.current) {
          autoDisconnectedRef.current = false;
          appendLog('App back in foreground -- reconnecting to meter...');
          // preferLastDeviceOnMultiple: true -- this is a reconnect, not a
          // fresh choice, so if more than one meter happens to be in range
          // right now, silently go back to the one that was connected
          // before backgrounding rather than popping up a picker the
          // person didn't ask for (see connect()'s own comment on this).
          connect({ preferLastDeviceOnMultiple: true });
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
      if (statusRef.current !== 'disconnected') {
        appendLog(`App moved to ${nextAppState} -- disconnecting meter.`);
        autoDisconnectedRef.current = true;
        disconnect();
      }
    });
    return () => subscription.remove();
  }, [appendLog, connect, disconnect]);

  const upload = useCallback(async () => {
    if (!result) return;
    const creds = await loadHcriCredentials();
    if (!creds) {
      Alert.alert('No hCRI.io account set up', 'Add your username and API token first.', [
        { text: 'Go to Settings', onPress: () => navigation.navigate('Settings') },
        { text: 'Cancel', style: 'cancel' },
      ]);
      return;
    }

    setStatus('uploading');
    const csv = buildCsv(result);
    // Use whatever the person typed as the upload title if there's anything
    // there; fall back to the generated username+timestamp label only when
    // the field's genuinely empty, rather than silently ignoring a typed
    // title.
    const label = uploadTitle.trim() || defaultLabel(creds.username, result.deviceName);
    const res = await uploadToHcri(csv, label, creds.token, appendLog);
    // The raw server response (res.message -- hCRI.io's API returns JSON)
    // still goes to Logs for anyone actually debugging an upload; the
    // popup itself just says what happened, same plain-language style as
    // HistoryScreen's own bulk-upload summary.
    appendLog(res.message);
    Alert.alert(
      res.success ? 'Uploaded' : 'Upload failed',
      res.success ? `Uploaded "${label}".` : `Could not upload "${label}". Check Logs for details.`
    );
    setStatus('connected');
  }, [result, navigation, appendLog, uploadTitle]);

  // History's own rename/delete/upload/share handlers now live in
  // HistoryScreen.tsx -- History is its own top-level tab, not a panel
  // inside Home, so it owns its own copy of the saved-reading list (loaded
  // fresh from storage on focus) rather than reaching back into this
  // screen's state.

  const shareCurrentCsv = useCallback(() => {
    if (!result) return;
    // Same label the current reading would upload under, so "share" and
    // "upload" always agree on what this reading is called.
    const label = uploadTitle.trim() || defaultLabel(cachedUsername, result.deviceName);
    withBackgroundDisconnectSuppressed(() => shareSingleReadingCsv(result, label));
  }, [result, uploadTitle, cachedUsername]);

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
    // paddingTop is deliberately much smaller than the horizontal/bottom
    // padding -- this used to be the gap under the "hCRI Companion"
    // title/gear header, sized for that, not for the empty safe-area inset
    // it backs onto now that the header's gone (SafeAreaView's top edge
    // already reserves room for the status bar/notch on its own).
    content: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 56 },
    tabBarWrap: { marginBottom: 16 },
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
      <ScrollView contentContainerStyle={styles.content}>
        {/* No title/gear header any more -- "hCRI Companion" was just
            branding, not information, and Settings is now its own bottom
            tab rather than a button here (see App.tsx). MainTab's own
            status row (the dot + "Connected"/"Disconnected" text) is the
            first thing on screen now -- one less row of chrome before the
            actual reading. */}
        <View style={styles.tabBarWrap}>
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

        {activeTab === 'main' && (
          <MainTab
            status={status}
            isBusy={isBusy}
            result={result}
            analysis={analysis}
            connect={() => connect()}
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
            statIds={statIds}
            connectedDeviceName={deviceName}
          />
        )}
        {activeTab === 'data' && (
          <DataTab
            result={result}
            analysis={analysis}
            onUpload={upload}
            uploading={status === 'uploading'}
            uploadTitle={uploadTitle}
            onUploadTitleChange={setUploadTitle}
            onShareCsv={shareCurrentCsv}
            cachedUsername={cachedUsername}
          />
        )}
        {activeTab === 'logs' && <LogsTab log={log} onShare={shareLog} onClear={clearLog} />}
      </ScrollView>
    </SafeAreaView>
  );
}
