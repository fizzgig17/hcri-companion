// src/hcri/liveStation.ts
//
// Live station: sends a TKLamp run to hCRI.io while it records, so it can be watched from the website or this app
// (hCRI.io -> Runtime -> Live station, or the ?live= link), and so hCRI.io can email about problems. Readings are averaged
// into one value per second and sent in small batches; the server keeps the run, and a batch that does not arrive is simply
// sent again with the next one. See hcri.io api/v1_live.php.

import { HCRI_API_BASE } from './apiConfig';
import fetchWithTimeout from './fetchWithTimeout';
import { loadHcriCredentials } from '../storage/secureStorage';
import { LiveRelay } from './liveRelay';

const LIVE_URL = `${HCRI_API_BASE}/index.php/api/v1/live`;
const SHARED_URL = `${HCRI_API_BASE}/index.php/api/live_shared`;

export interface LiveSettings {
  emailDone: boolean;
  emailLow: boolean;
  emailStale: boolean;
  emailError: boolean;
  lowLm: number;
  staleMin: number;
}
export interface LiveRunSummary {
  runId: string;
  kind: 'run' | 'monitor';
  label: string;
  unit: string;
  status: 'idle' | 'running' | 'finished' | 'error';
  message: string;
  points: number;
  intervalSeconds: number;
  last: number | null;
  startedAt: string | null;
  lastAt: string | null;
  ageSeconds: number | null;
  stale: boolean;
}
/** What the owner typed about the light being tested; shown on the live pages. */
export interface LiveInfo {
  title: string;
  details: string;
}
export interface LiveStationInfo {
  enabled: boolean;
  token: string | null;
  url: string | null;
  settings: LiveSettings;
  info: LiveInfo;
  run: LiveRunSummary;
}
export interface LiveShared {
  live: boolean;
  from: number;
  values: number[];
  run: LiveRunSummary | null;
  info?: LiveInfo;
}

async function call(token: string, method: 'GET' | 'POST', body?: object): Promise<any> {
  const res = await fetchWithTimeout(LIVE_URL, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }, 20000);
  const text = await res.text();
  let j: any = null;
  try { j = JSON.parse(text); } catch { /* not JSON */ }
  if (!res.ok) throw new Error(j?.error || `hCRI.io returned ${res.status}.`);
  return j;
}

export const getLiveStation = (token: string): Promise<LiveStationInfo> => call(token, 'GET');
export const liveAction = (token: string, body: object): Promise<LiveStationInfo> => call(token, 'POST', body);

/** The public view of a station, for the in-app Live screen. `since` = readings already held (only used while the run is short). */
export async function fetchLiveShared(stationToken: string, since = -1): Promise<LiveShared> {
  const res = await fetchWithTimeout(`${SHARED_URL}?t=${encodeURIComponent(stationToken)}${since >= 0 ? `&since=${since}` : ''}`, { method: 'GET' }, 20000);
  const j = await res.json().catch(() => null);
  if (!res.ok) throw new Error(j?.error || `hCRI.io returned ${res.status}.`);
  return j;
}

// ── The run in progress (module level, used by the TKLamp screen) ────────

let active: LiveRelay | null = null;    // the run being recorded
let monitor: LiveRelay | null = null;   // the plain live reading while no run is recording

function makeRelay(kind: 'run' | 'monitor', getLabel: () => string): LiveRelay {
  // Readings are collected from the first second; whether to send them is worked out meanwhile (signed in, switched on).
  const tokenP: Promise<string | null> = (async () => {
    const creds = await loadHcriCredentials().catch(() => null);
    if (!creds?.token) return null;
    // The switch lives on hCRI.io (so it can be changed from the website too): ask it, once per run.
    const info = await getLiveStation(creds.token).catch(() => null);
    return info?.enabled ? creds.token : null;
  })();
  const relay = new LiveRelay(`${kind === 'run' ? 'r' : 'm'}${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`, getLabel, async (b) => {
    const t = await tokenP;
    if (!t) return { count: 0, enabled: false };
    return call(t, 'POST', b);
  }, kind);
  relay.start();
  return relay;
}

/** Starts sending a run if the person is signed in and has Live station switched on (here or on the website). */
export function startLiveRun(getLabel: () => string): void {
  stopLiveMonitor();
  if (active) active.stopTimers();
  active = makeRelay('run', getLabel);
}

/** While no run records, the tester's live number goes to the station too, so it shows "Live" rather than nothing. */
export function liveMonitorAdd(ms: number, lm: number): void {
  if (!monitor) monitor = makeRelay('monitor', () => 'Live reading');
  monitor.add(ms, lm);
}

export function stopLiveMonitor(): void {
  const m = monitor;
  monitor = null;
  if (m) m.finish('finished').catch(() => {});
}

export function liveAdd(ms: number, lm: number): void {
  if (active) active.add(ms, lm);
}

export function finishLiveRun(status: 'finished' | 'error', message = ''): void {
  const r = active;
  active = null;
  if (r) r.finish(status, message).catch(() => {});
}
