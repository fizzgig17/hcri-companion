// src/screens/HistoryScreen.tsx
//
// History used to be a panel inside HomeScreen's own tab bar; it's now its
// own top-level bottom-nav tab (see App.tsx) -- a real destination you can
// jump to directly, not something buried behind Main/Data/Logs. That means
// it owns its own copy of the saved-reading list rather than reaching into
// HomeScreen's state: it loads fresh from storage on mount AND every time
// this tab regains focus (so a reading just taken on Home shows up here
// without needing a manual pull-to-refresh), the same "refresh on focus"
// pattern HomeScreen already uses for cachedUsername/statIds.
//
// Share handlers here go through withBackgroundDisconnectSuppressed (see
// ../ble/backgroundDisconnectGuard.ts) for the same reason HomeScreen's own
// shares do: a share sheet briefly backgrounds the app, and without this
// HomeScreen's AppState listener would read that as "the person switched
// away" and disconnect the meter out from under them -- even though the
// meter connection itself lives entirely in HomeScreen/MainTab, not here.

import React, { useCallback, useEffect, useState } from 'react';
import { Text, ScrollView, StyleSheet, Alert, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Clipboard from '@react-native-clipboard/clipboard';
import { useTheme } from '../contexts/ThemeContext';
import { useLog } from '../contexts/LogContext';
import { withBackgroundDisconnectSuppressed } from '../ble/backgroundDisconnectGuard';
import HistoryTab from './tabs/HistoryTab';
import {
  loadHistory,
  renameReading,
  deleteReading,
  deleteManyReadings,
  setReadingReportLink,
  updateReadingLed,
  SavedReading,
} from '../storage/readingHistory';
import { loadHcriCredentials } from '../storage/secureStorage';
import { buildCsv } from '../hcri/buildCsv';
import { uploadReadingToHcri } from '../hcri/uploadFlickerToHcri';
import { getReportLink } from '../hcri/getReportLink';
import { shareSingleReadingCsv, shareAllReadingsCsv } from '../utils/shareCsv';
import { IS_DEV_BUILD } from '../hcri/buildTarget';
import { tm30InputFromReading } from '../utils/tm30Report';
import { analyzeSpectrum } from '../utils/spectralAnalysis';
import LedPickerModal from '../components/LedPickerModal';
import { EMPTY_LED_LISTS, getCachedLedLists, LedLists, refreshLedLists } from '../hcri/ledLists';
import { fetchLedSuggestion, LedDetails } from '../hcri/ledApi';
import { syncLedForReading } from '../hcri/ledSync';

export default function HistoryScreen({ navigation }: any) {
  const { colors } = useTheme();
  const { appendLog } = useLog();

  const [history, setHistory] = useState<SavedReading[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  // Which saved reading (if any) is currently being uploaded -- see
  // HomeScreen's old comment on the equivalent state, now moved here:
  // separate from a bulk run's own in-progress flag so a single row's
  // spinner and "disable Select mode's controls for the whole run" can be
  // tracked independently.
  const [historyUploadingId, setHistoryUploadingId] = useState<string | null>(null);
  const [historyBulkUploading, setHistoryBulkUploading] = useState(false);
  // Which saved reading's Copy Link button (below) is mid-request right
  // now -- same single-id-at-a-time pattern as historyUploadingId, so only
  // that one row's icon shows a spinner while the rest of the list stays
  // tappable.
  const [copyingLinkId, setCopyingLinkId] = useState<string | null>(null);

  const refreshHistory = useCallback(() => {
    loadHistory()
      .then(setHistory)
      .catch((e: any) => appendLog(`Failed to load reading history: ${e.message}`))
      .finally(() => setHistoryLoading(false));
  }, [appendLog]);

  // LED details: cached dropdown lists, plus a lazy suggestion lookup for readings that were never asked about
  // (needs the API token and internet; quietly does nothing otherwise).
  const [ledLists, setLedLists] = useState<LedLists>(EMPTY_LED_LISTS);
  const [ledPickFor, setLedPickFor] = useState<SavedReading | null>(null);
  useEffect(() => {
    let live = true;
    getCachedLedLists().then((l) => live && setLedLists(l));
    refreshLedLists().then((l) => live && setLedLists(l));
    return () => { live = false; };
  }, []);

  const patchLed = useCallback((id: string, patch: Parameters<typeof updateReadingLed>[1]) => {
    setHistory((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    return updateReadingLed(id, patch);
  }, []);
  const confirmLed = useCallback(async (id: string, d: LedDetails) => {
    setLedPickFor(null);
    await patchLed(id, { led: d, ledSynced: false, ledDismissed: false }).catch(() => {});
    const ok = await syncLedForReading(id);
    if (ok) setHistory((prev) => prev.map((r) => (r.id === id ? { ...r, ledSynced: true } : r)));
  }, [patchLed]);

  useEffect(() => {
    if (historyLoading) return;
    const todo = history.filter((r) => !r.led && !r.ledSuggestion && !r.ledDismissed && !r.result.sampleLabel).slice(0, 8);
    if (!todo.length) return;
    let live = true;
    (async () => {
      const creds = await loadHcriCredentials();
      if (!creds?.token) return;
      for (const r of todo) {
        if (!live) return;
        const s = await fetchLedSuggestion(r.result.spectrum, creds.token, r.label);
        // Network failure and "no match" look the same here; only remember an answer when we got one.
        if (s) await patchLed(r.id, { ledSuggestion: s }).catch(() => {});
      }
    })();
    return () => { live = false; };
  }, [historyLoading, history.length, patchLed]);

  useEffect(() => {
    refreshHistory();
    const unsubscribe = navigation.addListener('focus', refreshHistory);
    return unsubscribe;
  }, [navigation, refreshHistory]);

  /** Renames a History entry by itself -- no upload involved (e.g. committed on blur in HistoryTab). */
  const renameFromHistory = useCallback(async (id: string, label: string) => {
    await renameReading(id, label);
    setHistory((prev) => prev.map((r) => (r.id === id ? { ...r, label } : r)));
  }, []);

  const deleteFromHistory = useCallback(async (id: string) => {
    await deleteReading(id);
    setHistory((prev) => prev.filter((r) => r.id !== id));
  }, []);

  /** Bulk/"delete all" version of deleteFromHistory, for HistoryTab's Select mode -- one storage write for the whole batch (see deleteManyReadings) instead of one deleteReading call per id. */
  const deleteManyFromHistory = useCallback(async (ids: string[]) => {
    await deleteManyReadings(ids);
    const idSet = new Set(ids);
    setHistory((prev) => prev.filter((r) => !idSet.has(r.id)));
  }, []);

  /**
   * Saves a just-succeeded upload's report {id, isPublic} onto the matching
   * History row (see readingHistory.ts's setReadingReportLink) and mirrors
   * that into local state so HistoryTab reflects it immediately rather than
   * waiting for this screen's next focus-triggered refreshHistory(). Shared
   * by both uploadFromHistory and uploadManyFromHistory below -- either
   * one succeeding should leave the row's link current, same requirement
   * as a successful upload from Main/Data (see HomeScreen.tsx's upload()).
   */
  const saveReportLink = useCallback(async (id: string, reportId: number, isPublic: boolean) => {
    try {
      await setReadingReportLink(id, reportId, isPublic);
      syncLedForReading(id);
      setHistory((prev) => prev.map((r) => (r.id === id ? { ...r, reportId, reportIsPublic: isPublic } : r)));
    } catch (e: any) {
      appendLog(`Failed to save report link to history: ${e.message}`);
    }
  }, [appendLog]);

  /**
   * Uploads a past reading under whatever label is passed in (which may be
   * freshly edited, not yet committed to storage). The label is persisted
   * first -- "if you rename them to upload, it should save them with that
   * name as well" -- so it sticks around in History even if the upload
   * itself then fails, rather than the rename only ever having existed
   * transiently as part of one upload request.
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
        const res = await uploadReadingToHcri(entry.result, csv, label, creds.token, appendLog);
        appendLog(res.message);
        if (res.success && typeof res.reportId === 'number' && typeof res.isPublic === 'boolean') {
          await saveReportLink(id, res.reportId, res.isPublic);
        }
        Alert.alert(
          res.success ? 'Uploaded' : 'Upload failed',
          res.success ? `Uploaded "${label}".` : `Could not upload "${label}". Check Logs for details.`
        );
      } finally {
        setHistoryUploadingId(null);
      }
    },
    [history, navigation, appendLog, renameFromHistory, saveReportLink]
  );

  /**
   * Uploads several History entries in one go (Select mode), each under
   * its own already-saved label -- unlike uploadFromHistory, this never
   * renames anything itself, so if a bulk selection still has generic
   * "Reading <date/time>" labels on it, that's what goes up. Fix the name
   * first (same inline field, before switching into Select mode) if
   * that's not what you want.
   *
   * Sequential on purpose, not Promise.all -- keeps historyUploadingId
   * meaningful as "which one is going up right now" (so HistoryTab can
   * show a single moving spinner instead of N at once), and avoids firing
   * a burst of simultaneous requests at hCRI.io for what could be a large
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
            const res = await uploadReadingToHcri(entry.result, csv, entry.label, creds.token, appendLog);
            appendLog(res.message);
            if (res.success) {
              okCount += 1;
              if (typeof res.reportId === 'number' && typeof res.isPublic === 'boolean') {
                await saveReportLink(id, res.reportId, res.isPublic);
              }
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
    [history, navigation, appendLog, saveReportLink]
  );

  /**
   * Resolves a History row's stored {reportId, reportIsPublic} (see
   * readingHistory.ts) into a copyable hcri.io link and puts it on the
   * clipboard -- same getReportLink.ts call HomeScreen's own copy-link
   * button makes for the "current" reading, just reusable for ANY past
   * reading that's ever been uploaded, however long ago.
   */
  // Shared by Copy / Report / TM-30: resolves the stored report's link (a
  // private report's first resolve mints its share link -- see
  // getReportLink.ts) and hands it to `then`. One in-flight flag for all
  // three, so only one request runs at a time.
  const withReportLink = useCallback(
    async (reading: SavedReading, then: (link: string) => void | Promise<void>) => {
      if (typeof reading.reportId !== 'number' || typeof reading.reportIsPublic !== 'boolean') return;
      const creds = await loadHcriCredentials();
      if (!creds) {
        Alert.alert('No hCRI.io account set up', 'Add your username and API token first.', [
          { text: 'Go to Settings', onPress: () => navigation.navigate('Settings') },
          { text: 'Cancel', style: 'cancel' },
        ]);
        return;
      }
      setCopyingLinkId(reading.id);
      try {
        const res = await getReportLink(reading.reportId, reading.reportIsPublic, creds.token, appendLog);
        if (res.success && res.link) {
          await then(res.link);
        } else {
          Alert.alert('Could not get link', res.message || 'Something went wrong. Please try again.');
        }
      } finally {
        setCopyingLinkId(null);
      }
    },
    [navigation, appendLog]
  );

  const copyReportLinkFromHistory = useCallback(
    (reading: SavedReading) =>
      withReportLink(reading, (link) => {
        Clipboard.setString(link);
        appendLog(`Copied report link: ${link}`);
      }),
    [withReportLink, appendLog]
  );

  // Opens the report in the browser; `tm30` appends ?tm30=1 (the report page
  // opens its TM-30 report straight away on that flag). The link already has
  // a query string (?report=ID or ?share=TOKEN), so it's always `&`.
  const openReportFromHistory = useCallback(
    (reading: SavedReading, tm30: boolean) =>
      withReportLink(reading, async (link) => {
        const url = tm30 ? `${link}${link.includes('?') ? '&' : '?'}tm30=1` : link;
        appendLog(`Opening report: ${url}`);
        try {
          await Linking.openURL(url);
        } catch {
          Alert.alert('Could not open the report', 'No browser was available to open the link.');
        }
      }),
    [withReportLink, appendLog]
  );

  const shareOneFromHistory = useCallback((reading: SavedReading) => {
    withBackgroundDisconnectSuppressed(() => shareSingleReadingCsv(reading.result, reading.label));
  }, []);

  const shareManyFromHistory = useCallback(
    (ids: string[]) => {
      const picked = history.filter((r) => ids.includes(r.id));
      if (picked.length === 0) return;
      if (picked.length === 1) {
        withBackgroundDisconnectSuppressed(() => shareSingleReadingCsv(picked[0].result, picked[0].label));
      } else {
        withBackgroundDisconnectSuppressed(() => shareAllReadingsCsv(picked));
      }
    },
    [history]
  );

  const shareAllFromHistory = useCallback(() => {
    withBackgroundDisconnectSuppressed(() => shareAllReadingsCsv(history));
  }, [history]);

  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { padding: 16, paddingBottom: 56 },
    title: { fontSize: 20, fontWeight: '700', color: colors.text, marginBottom: 14 },
  });

  return (
    // 'top' dropped from edges in a dev build -- see the matching comment
    // in HomeScreen.tsx for why: DevBuildBanner already reserves the
    // status-bar/notch inset for itself right above this screen, and
    // requesting it again here double-stacks it into a dead gap.
    <SafeAreaView style={styles.container} edges={IS_DEV_BUILD ? ['left', 'right'] : ['top', 'left', 'right']}>
      {/* keyboardShouldPersistTaps="handled": this ScrollView is a parent (in
          React terms) of the rename popup in HistoryTab, and its default
          ("never") eats the first tap while the keyboard is up -- it just
          dismissed the keyboard and never passed the tap to the popup's Save
          button, so Save took two taps. "handled" lets a tap on a button go
          straight through. */}
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>History</Text>
        <HistoryTab
          history={history}
          loading={historyLoading}
          onRename={renameFromHistory}
          onUploadWithLabel={uploadFromHistory}
          onUploadMany={uploadManyFromHistory}
          onDelete={deleteFromHistory}
          onDeleteMany={deleteManyFromHistory}
          onShareOne={shareOneFromHistory}
          onShareAll={shareAllFromHistory}
          onShareMany={shareManyFromHistory}
          onOpen={(reading) => navigation.navigate('ReadingDetail', { reading })}
          uploadingId={historyUploadingId}
          bulkUploading={historyBulkUploading}
          onCopyLink={copyReportLinkFromHistory}
          onOpenReport={openReportFromHistory}
          onLedConfirm={confirmLed}
          onLedPick={setLedPickFor}
          onLedDismiss={(id) => { patchLed(id, { ledDismissed: true }).catch(() => {}); }}
          onOpenTm30={(reading) => {
            try {
              const analysis = reading.analysis ?? analyzeSpectrum(reading.result.spectrum);
              navigation.navigate('Tm30Report', { input: tm30InputFromReading(reading.result, analysis, reading.label, reading.savedAt) });
            } catch (e: any) {
              Alert.alert('Could not open the TM-30 report', String(e?.message ?? e));
            }
          }}
          copyingLinkId={copyingLinkId}
        />
      </ScrollView>
      <LedPickerModal
        visible={!!ledPickFor}
        lists={ledLists}
        initial={ledPickFor?.led ?? (ledPickFor && ledPickFor.ledSuggestion && ledPickFor.ledSuggestion !== 'none' ? { brand: ledPickFor.ledSuggestion.brand, model: ledPickFor.ledSuggestion.model, cct: ledPickFor.ledSuggestion.cct ?? undefined } : undefined)}
        onSave={(d) => ledPickFor && confirmLed(ledPickFor.id, d)}
        onCancel={() => setLedPickFor(null)}
      />
    </SafeAreaView>
  );
}
