// src/hcri/fetchSampleReading.ts
//
// "Show a test reading": pulls a random PUBLIC report from hcri.io and turns
// its spectrum into a MeterResult, so the Main tab's stat grid and charts
// can be tried out with no meter connected. Every stat on screen is derived
// from the spectrum by analyzeSpectrum() (see HomeScreen.tsx), so only the
// spectrum needs to be real -- the device-only fields are zero-filled.
//
// Uses the same unauthenticated endpoints the website's Explore page uses
// (GET /api/explore, GET /api/explore/:id), which only ever return public
// reports when no auth header is sent. Nothing here sends the person's
// token. The result is flagged `sampleLabel` so HomeScreen never saves it
// to History or lets it be uploaded back as if it were a real reading.

import { MeterResult } from '../ble/parseResult';
import { HCRI_API_BASE } from './apiConfig';

const API = `${HCRI_API_BASE}/index.php/api/explore`;
const PER_PAGE = 24;
// Random page picked from at most this many pages -- plenty of variety
// without fetching a deep, rarely-cached page of a very large archive.
const MAX_PAGES = 20;
const TIMEOUT_MS = 10000;

async function getJson(url: string): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`hCRI.io returned ${res.status}`);
    return await res.json();
  } catch (e: any) {
    if (e?.name === 'AbortError') throw new Error('hCRI.io took too long to respond.');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/** Loads one random public report's spectrum as a MeterResult. Throws a user-presentable Error on any failure. */
export async function fetchSampleReading(): Promise<MeterResult> {
  // First page tells us how many pages exist; reuse it if that's the page we land on.
  const first = await getJson(`${API}?perPage=${PER_PAGE}&page=1`);
  const pages = Math.max(1, Math.min(Number(first?.pages) || 1, MAX_PAGES));
  const page = 1 + Math.floor(Math.random() * pages);
  const listing = page === 1 ? first : await getJson(`${API}?perPage=${PER_PAGE}&page=${page}`);
  const candidates: any[] = (listing?.reports ?? []).filter((r: any) => r && typeof r.id === 'number' && !r.private);
  if (candidates.length === 0) throw new Error('No public reports were available.');

  // A report can be missing its spectrum (old/manual entries) -- try a few at random before giving up.
  const pool = [...candidates];
  for (let attempt = 0; attempt < 4 && pool.length > 0; attempt++) {
    const report = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
    const detail = await getJson(`${API}/${report.id}`);
    const wls: number[] = detail?.wls ?? [];
    const vals: number[] = detail?.vals ?? [];
    if (wls.length < 10 || wls.length !== vals.length) continue;
    const label: string = String(detail?.label || report.label || `Report ${report.id}`);
    return {
      deviceName: `Sample: ${label}`,
      firmwareVersion: 0,
      cct: 0,
      ra: 0,
      lux: null,
      par: 0,
      peakSignal: 0,
      darkSignal: 0,
      integrationTimeMs: 0,
      compensateLevel: 0,
      x: 0,
      y: 0,
      duv: 0,
      rIndices: Array(15).fill(0),
      tm30Rf: null,
      tm30Rg: null,
      timestampOnDevice: String(detail?.createdAt ?? ''),
      spectrum: wls.map((nm, i) => ({ nm: Number(nm), value: Number(vals[i]) })),
      sampleLabel: label,
    };
  }
  throw new Error('Could not find a public report with spectrum data. Try again.');
}
