// src/hcri/backup.ts
//
// Optional cloud backup of the reading history to the person's own hCRI.io account, using their API token.
// What is sent is stored privately on hCRI.io: it is not a report and is never shown on any public page.
//
//  - Runs by itself a few seconds after the history changes, when the app comes back to the foreground, and once a
//    token is saved. With no token saved nothing happens; the first run after signing in sends everything that
//    hasn't been sent yet ("catches up").
//  - Only new or edited readings are sent. Deleting a reading in the app removes it from the backup too; readings
//    that merely scroll off the end of the history stay in the backup.
//  - Restoring adds back readings the app doesn't have.

import { Alert } from 'react-native';
import { fingerprintOf, planBackup, isRestorableReading, readingItem, flickerItem, isFlickerBackupId, flickerBackupId } from './backupPlan';
import { loadFlickers, mergeRestoredFlickers, isRestorableFlicker, SavedFlicker } from '../storage/flickerHistory';
import { HCRI_API_BASE } from './apiConfig';
import fetchWithTimeout from './fetchWithTimeout';
import { loadHcriCredentials } from '../storage/secureStorage';
import {
  loadHistory,
  mergeRestoredReadings,
  setHistoryChangeListener,
  SavedReading,
} from '../storage/readingHistory';
import {
  loadBackupEnabled,
  loadBackupState,
  loadRestoreDeclined,
  saveRestoreDeclined,
  withBackupState,
} from '../storage/backupState';

const BACKUP_URL = `${HCRI_API_BASE}/index.php/api/v1/backup`;
const UPLOAD_BATCH = 10;
const DELETE_BATCH = 100;
const RESTORE_PAGE = 10;
const BACKUP_DELAY_MS = 4000;

function headers(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

export interface BackupRunResult {
  /** 'done' = nothing left to send; 'skipped' = backup off or no token; 'error' = will retry on the next trigger. */
  status: 'done' | 'skipped' | 'error';
  uploaded: number;
  message?: string;
}

let running = false;
let again = false;
let timer: ReturnType<typeof setTimeout> | null = null;

/** Sends whatever is new, edited or deleted. Safe to call any time; overlapping calls are folded into one more pass. */
export async function runBackup(log?: (m: string) => void): Promise<BackupRunResult> {
  if (running) {
    again = true;
    return { status: 'skipped', uploaded: 0 };
  }
  running = true;
  let uploaded = 0;
  try {
    if (!(await loadBackupEnabled())) return { status: 'skipped', uploaded };
    const creds = await loadHcriCredentials().catch(() => null);
    if (!creds?.token) return { status: 'skipped', uploaded };

    do {
      again = false;
      const items = [...(await loadHistory()).map(readingItem), ...(await loadFlickers()).map(flickerItem)];
      const plan = planBackup(items, await loadBackupState());

      for (let i = 0; i < plan.deleteIds.length; i += DELETE_BATCH) {
        const ids = plan.deleteIds.slice(i, i + DELETE_BATCH);
        const res = await fetchWithTimeout(BACKUP_URL, { method: 'POST', headers: headers(creds.token), body: JSON.stringify({ delete: ids }) });
        if (!res.ok) return fail(res.status, log, uploaded);
        await withBackupState((s) => {
          const set = new Set(ids);
          s.pendingDelete = s.pendingDelete.filter((id) => !set.has(id));
          for (const id of ids) delete s.synced[id];
        });
      }

      for (let i = 0; i < plan.upload.length; i += UPLOAD_BATCH) {
        const batch = plan.upload.slice(i, i + UPLOAD_BATCH);
        const body = JSON.stringify({ items: batch.map((it) => ({ id: it.id, savedAt: it.savedAt, reading: it.payload })) });
        const res = await fetchWithTimeout(BACKUP_URL, { method: 'POST', headers: headers(creds.token), body }, 60000);
        if (!res.ok) return fail(res.status, log, uploaded);
        // Too-large items come back as "skipped"; they're marked as sent so they aren't retried on every run.
        await withBackupState((s) => {
          for (const it of batch) s.synced[it.id] = fingerprintOf(it.payload);
        });
        uploaded += batch.length;
      }
    } while (again);

    await withBackupState((s) => {
      s.lastBackupAt = Date.now();
    });
    if (uploaded) log?.(`Cloud backup: sent ${uploaded} reading(s) to hCRI.io`);
    return { status: 'done', uploaded };
  } catch (e: any) {
    // Offline or a timeout: nothing is lost, the next trigger tries again.
    return { status: 'error', uploaded, message: String(e?.message ?? e) };
  } finally {
    running = false;
  }
}

function fail(status: number, log: ((m: string) => void) | undefined, uploaded: number): BackupRunResult {
  const message = status === 401 || status === 403 ? 'Your hCRI.io API token was not accepted, so readings are not being backed up.' : `hCRI.io answered ${status} to the backup request.`;
  log?.(`Cloud backup: ${message}`);
  return { status: 'error', uploaded, message };
}

/** Backs up after a short pause, so a burst of changes (a reading, then its LED details, then an upload link) is one request. */
export function scheduleBackup(delayMs: number = BACKUP_DELAY_MS, log?: (m: string) => void): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    runBackup(log);
  }, delayMs);
}

/** Call once at startup: backs up on every history change from now on, and does a first catch-up pass. */
export function initBackup(log?: (m: string) => void): void {
  setHistoryChangeListener(() => scheduleBackup(BACKUP_DELAY_MS, log));
  scheduleBackup(2000, log);
}

export interface RestoreResult {
  ok: boolean;
  /** Readings and saved flickers now in History that were not there before. */
  added: number;
  /** Readings the backup holds. */
  total: number;
  message?: string;
}

/** Adds back readings from the backup that the app doesn't have (newest first). Never removes or overwrites anything. */
export async function restoreFromBackup(onProgress?: (done: number, total: number) => void): Promise<RestoreResult> {
  const creds = await loadHcriCredentials().catch(() => null);
  if (!creds?.token) return { ok: false, added: 0, total: 0, message: 'Save your hCRI.io API token in Settings first.' };
  let after = '';
  let total = 0;
  let seen = 0;
  let added = 0;
  try {
    for (let page = 0; page < 1000; page++) {
      const url = `${BACKUP_URL}?limit=${RESTORE_PAGE}${after ? `&after=${encodeURIComponent(after)}` : ''}`;
      const res = await fetchWithTimeout(url, { headers: headers(creds.token) }, 60000);
      if (!res.ok) return { ok: false, added, total, message: res.status === 401 || res.status === 403 ? 'Your hCRI.io API token was not accepted.' : `hCRI.io answered ${res.status}.` };
      const data = await res.json();
      total = Number(data?.total) || total;
      const gone = new Set((await loadBackupState()).pendingDelete);
      const rawItems: any[] = Array.isArray(data?.items) ? data.items : [];
      const readings: SavedReading[] = [];
      const flickers: SavedFlicker[] = [];
      for (const it of rawItems) {
        const p = it?.reading;
        if (typeof it?.id !== 'string' || gone.has(it.id)) continue;
        if (isFlickerBackupId(it.id)) { if (isRestorableFlicker(p)) flickers.push(p); }
        else if (isRestorableReading(p)) readings.push(p);
      }
      seen += rawItems.length;
      if (readings.length || flickers.length) {
        // Mark them as already backed up before they land in the lists, so they aren't sent straight back.
        await withBackupState((s) => {
          for (const r of readings) s.synced[r.id] = fingerprintOf(r);
          for (const f of flickers) s.synced[flickerBackupId(f.id)] = fingerprintOf(f);
        });
        added += await mergeRestoredReadings(readings);
        added += await mergeRestoredFlickers(flickers);
      }
      onProgress?.(seen, total);
      if (!data?.next) break;
      after = String(data.next);
    }
    return { ok: true, added, total };
  } catch (e: any) {
    return { ok: false, added, total, message: String(e?.message ?? e) };
  }
}

/**
 * On a fresh install (empty history, token already saved -- the iOS Keychain keeps it across a reinstall) offers to
 * bring the backup back. Asks once; Settings always has a Restore button.
 */
export async function offerRestoreIfEmpty(onDone?: (r: RestoreResult) => void): Promise<void> {
  try {
    if (!(await loadBackupEnabled()) || (await loadRestoreDeclined())) return;
    if ((await loadHistory()).length > 0 || (await loadFlickers()).length > 0) return;
    const creds = await loadHcriCredentials().catch(() => null);
    if (!creds?.token) return;
    const res = await fetchWithTimeout(`${BACKUP_URL}?limit=1`, { headers: headers(creds.token) });
    if (!res.ok) return;
    const total = Number((await res.json())?.total) || 0;
    if (total <= 0) return;
    Alert.alert(
      'Restore your readings?',
      `Your hCRI.io account has ${total} reading${total === 1 ? '' : 's'} backed up from this app. Restore them to History?`,
      [
        { text: 'Not now', style: 'cancel', onPress: () => { saveRestoreDeclined(true); } },
        { text: 'Restore', onPress: async () => { onDone?.(await restoreFromBackup()); } },
      ]
    );
  } catch {
    // offline or similar: try again next launch
  }
}
