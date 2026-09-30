// src/screens/HomeScreen.tsx
//
// Owns all app state (BLE connection, status, latest result, debug log)
// and the tab bar. Each tab's actual UI lives in its own file under
// ./tabs/ for modularity -- this file just wires state/callbacks to
// whichever tab is active. Only MainTab touches the connection lifecycle
// (connect/disconnect/scan); Spectrum, Data, and Logs are read-only views
// of whatever the last reading and log happen to be.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MeterConnection } from '../ble/MeterConnection';
import { initializeMeter, takeMeasurement } from '../ble/takeMeasurement';
import { MeterResult } from '../ble/parseResult';
import { analyzeSpectrum } from '../utils/spectralAnalysis';
import { buildCsv, defaultLabel } from '../hcri/buildCsv';
import { uploadToHcri } from '../hcri/uploadToHcri';
import { loadHcriCredentials } from '../storage/secureStorage';
import { loadKeepAwakePreference } from '../storage/preferences';
import { loadHistory, addReading, renameReading, deleteReading, SavedReading } from '../storage/readingHistory';
import { METER_NAME_PREFIXES } from '../ble/protocol';
import { shareDebugLog } from '../utils/shareLog';
import { shareSingleReadingCsv, shareAllReadingsCsv } from '../utils/shareCsv';
import { hapticSuccess, hapticFailure } from '../utils/haptics';
import { enableKeepAwake, disableKeepAwake } from '../utils/keepAwake';
import { colors } from '../theme';
import TabBar from '../components/TabBar';
import MainTab, { Status, FoundDevice } from './tabs/MainTab';
import SpectrumTab from './tabs/SpectrumTab';
import DataTab from './tabs/DataTab';
import HistoryTab from './tabs/HistoryTab';
import AboutTab from './tabs/AboutTab';
import LogsTab from './tabs/LogsTab';

// 'chrom' is gone as its own tab key -- it's now a swipeable sub-page
// inside SpectrumTab (see SwipablePages), matching how the vendor app
// visually groups Spec./Chrom. together rather than scattering them
// across unrelated top-level tabs.
type TabKey = 'main' | 'spectrum' | 'data' | 'history' | 'about' | 'logs';

export default function HomeScreen({ navigation }: any) {
  const [activeTab, setActiveTab] = useState<TabKey>('main');
  const [status, setStatus] = useState<Status>('disconnected');
  const [result, setResult] = useState<MeterResult | null>(null);
  const [log, setLog] = useState<string[]>([]);
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
  const connRef = useRef<MeterConnection | null>(null);

  // Every completed measurement, persisted locally (see
  // ../storage/readingHistory.ts) -- loaded once on mount, then kept in
  // sync in-memory by every operation that changes it (a new reading,
  // rename, delete) rather than re-reading from storage after each one.
  const [history, setHistory] = useState<SavedReading[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  // Which saved reading (if any) is currently being uploaded FROM the
  // History tab -- separate from status === 'uploading', which is only for
  // the current/latest reading's own upload on the Data tab. Keeping these
  // separate means uploading an old reading from History doesn't make the
  // whole app look busy/disable the Main tab's Take Reading button.
  const [historyUploadingId, setHistoryUploadingId] = useState<string | null>(null);
  // Separate from historyUploadingId (which row's spinner is showing right
  // now, moving through the list one at a time during a bulk run) -- this
  // is just "is a bulk run in progress at all", so HistoryTab can disable
  // its Select mode controls for the whole duration rather than only
  // around whichever single row happens to be mid-upload at any instant.
  const [historyBulkUploading, setHistoryBulkUploading] = useState(false);

  useEffect(() => {
    loadHistory()
      .then(setHistory)
      .catch((e) => appendLog(`Failed to load reading history: ${e.message}`))
      .finally(() => setHistoryLoading(false));
    // Intentionally run once on mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // Computed ONCE per reading, here, and threaded down to every tab that
  // shows a colorimetric number (Main, Spectrum, Data) -- rather than each
  // tab importing spectralAnalysis and calling analyzeSpectrum() on its own.
  // That would still be *correct* (same function, same inputs, same
  // outputs), but a single shared computation is what actually guarantees
  // "the same algorithm for every calculation in the app" stays true as the
  // app grows -- there is exactly one CCT/Duv/Ra/R9 number in memory for a
  // given result, not three independent calls that happen to agree today.
  const analysis = useMemo(() => (result ? analyzeSpectrum(result.spectrum) : null), [result]);

  const appendLog = useCallback((msg: string) => {
    // Also mirror to console.log -- React Native forwards this straight to
    // the Metro terminal on the PC whenever the app is connected in debug
    // mode, so you can copy/paste log lines from there without needing to
    // screen-mirror or copy text off the phone itself.
    console.log(`[meter] ${msg}`);
    setLog((prev) => [...prev.slice(-99), msg]);
  }, []);

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

  const connect = useCallback(async () => {
    setStatus('connecting');
    try {
      const conn = getConnection();
      // Clears any BLE connection to the meter left over from a previous
      // app/JS session (see MeterConnection.resetStaleConnection() for why
      // this is needed -- it's what used to require a power cycle after
      // reloading the app with the meter still connected). Cheap/harmless
      // when there's nothing stale to clear.
      await conn.resetStaleConnection();
      await conn.scanAndConnect();
      await initializeMeter(conn);
      setDeviceName(conn.getDeviceName());
      setStatus('connected');
    } catch (e: any) {
      appendLog(`Connect failed: ${e.message}`);
      setStatus('disconnected');
    }
  }, [appendLog, getConnection]);

  // Try to connect automatically as soon as the app opens, rather than
  // requiring a manual tap on "Connect to Meter" every time -- if the
  // meter's already powered on and in range, this gets straight to
  // "Connected" with no user action needed. If it's not found (meter off,
  // out of range, etc.) this just fails quietly into the normal
  // disconnected state, same as if Connect had been pressed and timed out;
  // the button is still there to retry manually.
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

  // Diagnostic: list nearby BLE devices that look like a Hopoocolor meter
  // (name starts with a known prefix, e.g. "HPCS") -- filters out all the
  // other unrelated BLE noise (headphones, watches, etc.) a raw scan picks
  // up, since the only thing worth surfacing here is "is a meter actually
  // advertising, and under what name/RSSI."
  const [scanning, setScanning] = useState(false);
  const [foundDevices, setFoundDevices] = useState<FoundDevice[]>([]);
  const stopScanRef = useRef<(() => void) | null>(null);

  const toggleScan = useCallback(() => {
    if (scanning) {
      stopScanRef.current?.();
      stopScanRef.current = null;
      setScanning(false);
      return;
    }

    setFoundDevices([]);
    setScanning(true);
    const conn = getConnection();
    stopScanRef.current = conn.scanForAllDevices((device) => {
      const name = device.name;
      if (!name || !METER_NAME_PREFIXES.some((prefix) => name.startsWith(prefix))) {
        return; // not a meter -- ignore
      }
      setFoundDevices((prev) => {
        const existing = prev.findIndex((d) => d.id === device.id);
        const entry = { id: device.id, name: device.name, rssi: device.rssi };
        if (existing >= 0) {
          const next = [...prev];
          next[existing] = entry;
          return next;
        }
        return [...prev, entry];
      });
    }, 15000);

    // Auto-flip the button back after the scan's own timeout elapses.
    setTimeout(() => setScanning(false), 15000);
  }, [scanning, getConnection]);

  /** Connect directly to a device tapped in the "Nearby Meters" list, instead of re-running the generic scan-and-match-by-name. */
  const connectToFoundDevice = useCallback(
    async (deviceId: string) => {
      stopScanRef.current?.();
      stopScanRef.current = null;
      setScanning(false);

      setStatus('connecting');
      try {
        const conn = getConnection();
        await conn.resetStaleConnection();
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
      // it a more meaningful name.
      try {
        const creds = await loadHcriCredentials();
        const label = defaultLabel(creds?.username ?? null, r.deviceName);
        const saved = await addReading(r, label);
        setHistory((prev) => [saved, ...prev]);
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
    const res = await uploadToHcri(csv, label, creds.token);
    // The raw server response (res.message -- hCRI.io's API returns JSON)
    // still goes to Logs for anyone actually debugging an upload; the
    // popup itself just says what happened, same plain-language style as
    // the bulk-upload summary in uploadManyFromHistory below.
    appendLog(res.message);
    Alert.alert(
      res.success ? 'Uploaded' : 'Upload failed',
      res.success ? `Uploaded "${label}".` : `Could not upload "${label}". Check Logs for details.`
    );
    setStatus('connected');
  }, [result, navigation, appendLog, uploadTitle]);

  /** Renames a History entry by itself -- no upload involved (e.g. committed on blur in HistoryTab). */
  const renameFromHistory = useCallback(async (id: string, label: string) => {
    await renameReading(id, label);
    setHistory((prev) => prev.map((r) => (r.id === id ? { ...r, label } : r)));
  }, []);

  const deleteFromHistory = useCallback(async (id: string) => {
    await deleteReading(id);
    setHistory((prev) => prev.filter((r) => r.id !== id));
  }, []);

  /**
   * Uploads a past reading from History under whatever label is passed in
   * (which may be freshly edited, not yet committed to storage). The label
   * is persisted first -- "if you rename them to upload, it should save
   * them with that name as well" -- so it sticks around in History even if
   * the upload itself then fails, rather than the rename only ever having
   * existed transiently as part of one upload request.
   */
  const uploadFromHistory = useCallback(
    async (id: string, label: string) => {
      const entry = history.find((r) => r.id === id);
      if (!entry) return;

      const creds = await loadHcriCredentials();
      if (!creds) {
        Alert.alert('No hCRI.io account set up', 'Add your username and API token first.', [
          { text: 'Go to Settings', onPress: () => navigation.navigate('Settings') },
          { text: 'Cancel', style: 'cancel' },
        ]);
        return;
      }

      if (label !== entry.label) {
        await renameFromHistory(id, label);
      }

      setHistoryUploadingId(id);
      try {
        const csv = buildCsv(entry.result);
        const res = await uploadToHcri(csv, label, creds.token);
        appendLog(res.message);
        Alert.alert(
          res.success ? 'Uploaded' : 'Upload failed',
          res.success ? `Uploaded "${label}".` : `Could not upload "${label}". Check Logs for details.`
        );
      } finally {
        setHistoryUploadingId(null);
      }
    },
    [history, navigation, appendLog, renameFromHistory]
  );

  /**
   * Uploads several History entries in one go (HistoryTab's Select mode),
   * each under its own already-saved label -- unlike uploadFromHistory,
   * this never renames anything itself, so if a bulk selection still has
   * generic "Reading <date/time>" labels on it, that's what goes up. Fix
   * the name first (same inline field, before switching into Select mode)
   * if that's not what you want.
   *
   * Sequential on purpose, not Promise.all -- keeps historyUploadingId
   * meaningful as "which one is going up right now" (so HistoryTab can show
   * a single moving spinner instead of N at once), and avoids firing a
   * burst of simultaneous requests at hCRI.io for what could be a large
   * selection. Credentials are checked once up front rather than once per
   * item, so a missing account fails fast instead of after already
   * uploading a few.
   */
  const uploadManyFromHistory = useCallback(
    async (ids: string[]) => {
      if (ids.length === 0) return;

      const creds = await loadHcriCredentials();
      if (!creds) {
        Alert.alert('No hCRI.io account set up', 'Add your username and API token first.', [
          { text: 'Go to Settings', onPress: () => navigation.navigate('Settings') },
          { text: 'Cancel', style: 'cancel' },
        ]);
        return;
      }

      setHistoryBulkUploading(true);
      let okCount = 0;
      let failCount = 0;
      try {
        for (const id of ids) {
          const entry = history.find((r) => r.id === id);
          if (!entry) continue;
          setHistoryUploadingId(id);
          try {
            const csv = buildCsv(entry.result);
            const res = await uploadToHcri(csv, entry.label, creds.token);
            appendLog(res.message);
            if (res.success) {
              okCount += 1;
            } else {
              failCount += 1;
            }
          } catch (e: any) {
            failCount += 1;
            appendLog(`Upload failed for "${entry.label}": ${e.message}`);
          }
        }
      } finally {
        setHistoryUploadingId(null);
        setHistoryBulkUploading(false);
      }

      Alert.alert(
        failCount === 0 ? 'Uploaded' : okCount === 0 ? 'Upload failed' : 'Upload finished',
        failCount === 0
          ? `Uploaded ${okCount} reading${okCount === 1 ? '' : 's'}.`
          : `${okCount} succeeded, ${failCount} failed. Check Logs for details.`
      );
    },
    [history, navigation, appendLog]
  );

  const shareCurrentCsv = useCallback(() => {
    if (!result) return;
    // Same label the current reading would upload under, so "share" and
    // "upload" always agree on what this reading is called.
    const label = uploadTitle.trim() || defaultLabel(cachedUsername, result.deviceName);
    shareSingleReadingCsv(result, label);
  }, [result, uploadTitle, cachedUsername]);

  const shareOneFromHistory = useCallback((reading: SavedReading) => {
    shareSingleReadingCsv(reading.result, reading.label);
  }, []);

  const shareAllFromHistory = useCallback(() => {
    shareAllReadingsCsv(history);
  }, [history]);

  const isBusy = status === 'connecting' || status === 'measuring' || status === 'uploading';

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.title}>hCRI Companion</Text>
            {deviceName && <Text style={styles.deviceSubtitle}>{deviceName}</Text>}
          </View>
          <TouchableOpacity onPress={() => navigation.navigate('Settings')}>
            <Text style={styles.settingsGear}>⚙︎</Text>
          </TouchableOpacity>
        </View>

        <TabBar
          tabs={[
            { key: 'main', label: 'Main' },
            { key: 'spectrum', label: 'Spectrum' },
            { key: 'data', label: 'Data' },
            { key: 'history', label: 'History' },
            { key: 'about', label: 'About' },
            { key: 'logs', label: 'Logs' },
          ]}
          active={activeTab}
          onChange={setActiveTab}
        />

        {activeTab === 'main' && (
          <MainTab
            status={status}
            isBusy={isBusy}
            result={result}
            analysis={analysis}
            connect={connect}
            measure={measure}
            disconnect={disconnect}
            resetConnection={resetConnection}
            scanning={scanning}
            foundDevices={foundDevices}
            toggleScan={toggleScan}
            connectToFoundDevice={connectToFoundDevice}
            onUpload={upload}
            uploading={status === 'uploading'}
          />
        )}
        {activeTab === 'spectrum' && <SpectrumTab result={result} analysis={analysis} />}
        {activeTab === 'data' && (
          <DataTab
            result={result}
            analysis={analysis}
            onUpload={upload}
            uploading={status === 'uploading'}
            uploadTitle={uploadTitle}
            onUploadTitleChange={setUploadTitle}
            onShareCsv={shareCurrentCsv}
            onShareAllCsv={shareAllFromHistory}
            historyCount={history.length}
            cachedUsername={cachedUsername}
          />
        )}
        {activeTab === 'history' && (
          <HistoryTab
            history={history}
            loading={historyLoading}
            onRename={renameFromHistory}
            onUploadWithLabel={uploadFromHistory}
            onUploadMany={uploadManyFromHistory}
            onDelete={deleteFromHistory}
            onShareOne={shareOneFromHistory}
            onShareAll={shareAllFromHistory}
            uploadingId={historyUploadingId}
            bulkUploading={historyBulkUploading}
          />
        )}
        {activeTab === 'about' && <AboutTab />}
        {activeTab === 'logs' && <LogsTab log={log} onShare={() => shareDebugLog(log)} />}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 16, paddingBottom: 40 },

  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  title: { fontSize: 22, fontWeight: '700', color: colors.text },
  deviceSubtitle: { fontSize: 12, color: colors.muted, marginTop: 1 },
  settingsGear: { fontSize: 22, color: colors.muted },
});
