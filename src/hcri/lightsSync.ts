// src/hcri/lightsSync.ts
//
// Keeps the phone's lights and hCRI.io in step.
//
//  syncLight(id): sends one light to hCRI.io, in this order: create it (or update its name/notes), set its categories,
//  upload every reading of the light that has no report yet (a reading uploaded before is left as it is), link all its
//  reports to the light, put them in this phone's order, take off the ones removed here, then read the light back
//  (trend numbers, counts, readings that only exist on the server).
//  pullLights(): brings down the account's lights. A light with no unsent changes is replaced by what hCRI.io has;
//  one with unsent changes is kept as it is until it is synced. Lights that exist only on the server are added.
//
// Nothing is ever deleted on hCRI.io except a report's link to a light (and the light itself, when the person deletes it).

import { loadHistory, setReadingReportLink } from '../storage/readingHistory';
import { loadHcriCredentials } from '../storage/secureStorage';
import { loadLights, patchLight, saveLights, LocalLight, serverCats } from '../storage/lightsStore';
import { buildCsv } from './buildCsv';
import { uploadReadingToHcri } from './uploadFlickerToHcri';
import {
  LIGHT_KINDS, ServerLight, attachServerReports, createServerLight, getServerLight, listServerLights,
  orderServerReports, patchServerLight, removeServerReport, setServerCategories,
} from './lightsApi';

export interface SyncResult { ok: boolean; message: string; uploaded: number; failedReadings: number }
type Log = (m: string) => void;

const fail = (message: string, uploaded = 0, failedReadings = 0): SyncResult => ({ ok: false, message, uploaded, failedReadings });

export async function syncLight(id: string, log?: Log, progress?: (m: string) => void): Promise<SyncResult> {
  const creds = await loadHcriCredentials().catch(() => null);
  const token = creds?.token;
  if (!token) return fail('Add your hCRI.io API token first.');
  let light = (await loadLights()).find((l) => l.id === id);
  if (!light) return fail('That light no longer exists.');

  // 1. the light itself
  progress?.('Sending the light…');
  let serverId = light.serverId;
  if (!serverId) {
    const r = await createServerLight(token, light.name, light.notes);
    if (!r.ok) return fail(`Could not create the light: ${r.error}`);
    serverId = r.data.id;
    light = (await patchLight(id, () => ({ serverId }), false)) ?? light;
    log?.(`Light "${light.name}" created on hCRI.io (#${serverId})`);
  } else if (light.dirty) {
    const r = await patchServerLight(token, serverId, light.name, light.notes);
    if (!r.ok) return fail(`Could not update the light: ${r.error}`);
  }

  // 2. categories (only the kinds that differ from what the server has)
  const have = serverCats(light.server);
  for (const k of LIGHT_KINDS) {
    const want = (light.cats[k] ?? []).filter(Boolean);
    const cur = have[k] ?? [];
    if (want.join('\u0001') === cur.join('\u0001')) continue;
    progress?.('Sending categories…');
    const r = await setServerCategories(token, serverId, k, want);
    if (!r.ok) return fail(`Could not set the categories: ${r.error}`);
  }

  // 3. readings: upload the ones with no report yet
  const history = await loadHistory();
  let uploaded = 0, failedReadings = 0;
  const reportIds: string[] = [];
  let n = 0;
  for (const rid of light.readingIds) {
    n++;
    const rd = history.find((h) => h.id === rid);
    if (!rd) continue;                                  // deleted from History since
    if (rd.reportId != null) { reportIds.push(String(rd.reportId)); continue; }
    progress?.(`Uploading reading ${n} of ${light.readingIds.length}…`);
    const res = await uploadReadingToHcri(rd.result, buildCsv(rd.result), rd.label, token, log);
    if (res.success && res.reportId != null) {
      await setReadingReportLink(rd.id, res.reportId, !!res.isPublic);
      reportIds.push(String(res.reportId));
      uploaded++;
    } else {
      failedReadings++;
      log?.(`Light "${light.name}": could not upload "${rd.label}": ${res.message}`);
    }
  }

  // 4. link + order, then take off what was removed here
  progress?.('Linking readings…');
  if (reportIds.length) {
    const a = await attachServerReports(token, serverId, reportIds);
    if (!a.ok) return fail(`Could not add the readings: ${a.error}`, uploaded, failedReadings);
    // Keep readings that are on the light on the server but not on this phone after the ones placed here.
    const others = (a.data.light.readings ?? []).map((r) => r.id).filter((x) => !reportIds.includes(x));
    const o = await orderServerReports(token, serverId, [...reportIds, ...others]);
    if (!o.ok) return fail(`Could not order the readings: ${o.error}`, uploaded, failedReadings);
  }
  for (const rid of light.removedReportIds) await removeServerReport(token, serverId, rid);

  // 5. read it back
  const back = await getServerLight(token, serverId);
  if (!back.ok) return fail(`Sent, but could not read the light back: ${back.error}`, uploaded, failedReadings);
  const incomplete = failedReadings > 0;
  await patchLight(id, () => ({ server: back.data, removedReportIds: [], dirty: incomplete, syncedAt: Date.now() }), false);
  return {
    ok: !incomplete,
    message: incomplete ? `${failedReadings} reading${failedReadings === 1 ? '' : 's'} could not be uploaded; try Sync again.` : 'In sync with hCRI.io.',
    uploaded, failedReadings,
  };
}

/** Maps a server light onto this phone: readings that exist in History (by report id) become local readings. */
async function adopt(s: ServerLight, existing?: LocalLight): Promise<LocalLight> {
  const history = await loadHistory();
  const byReport = new Map(history.filter((h) => h.reportId != null).map((h) => [String(h.reportId), h.id]));
  const ids = (s.readings ?? []).map((r) => byReport.get(r.id)).filter((x): x is string => !!x);
  return {
    id: existing?.id ?? `srv-${s.id}`, serverId: s.id, name: s.name, notes: s.notes || '', cats: serverCats(s),
    readingIds: ids, removedReportIds: [], dirty: false, createdAt: existing?.createdAt ?? Date.now(), server: s, syncedAt: Date.now(),
  };
}

export async function pullLights(log?: Log): Promise<{ ok: boolean; message: string }> {
  const creds = await loadHcriCredentials().catch(() => null);
  if (!creds?.token) return { ok: false, message: 'Add your hCRI.io API token first.' };
  const r = await listServerLights(creds.token);
  if (!r.ok) return { ok: false, message: r.error };
  const local = await loadLights();
  const out: LocalLight[] = [];
  const seen = new Set<number>();
  for (const s of r.data) {
    seen.add(s.id);
    const mine = local.find((l) => l.serverId === s.id);
    if (mine?.dirty) { out.push({ ...mine, server: { ...s, readings: mine.server?.readings } }); continue; }
    // The list has no per-reading detail; fetch it so readings can be matched to this phone's History.
    const d = await getServerLight(creds.token, s.id);
    out.push(await adopt(d.ok ? d.data : s, mine));
  }
  // Lights not on the server (never synced) stay; ones that were deleted elsewhere are dropped unless they have unsent changes.
  for (const l of local) if (!l.serverId || (!seen.has(l.serverId) && l.dirty)) out.push(l);
  await saveLights(out.sort((a, b) => b.createdAt - a.createdAt));
  log?.(`Lights: ${r.data.length} on hCRI.io`);
  return { ok: true, message: `${r.data.length} light${r.data.length === 1 ? '' : 's'} on hCRI.io` };
}
