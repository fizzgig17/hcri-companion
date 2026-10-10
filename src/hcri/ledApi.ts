// src/hcri/ledApi.ts
//
// LED suggestion + saving LED details on an uploaded report. Both need the
// person's API token (same one uploads use). Only brand/model/CCT text is
// exchanged; the site never returns anything about other people's reports.

import { HCRI_API_BASE } from './apiConfig';
import { MeterResult } from '../ble/parseResult';

const BASE = `${HCRI_API_BASE}/index.php/api/v1`;

export interface LedDetails { brand?: string; model?: string; cct?: string }
export interface LedSuggestion { brand: string; model: string; cct: string | null; source?: 'spectrum' | 'title' | 'cct' }

/** Returns the clear winner for this spectrum (the reading's title, if given, helps break near-ties), null (answered: no clear match), or undefined (couldn't ask: offline / error). */
export async function fetchLedSuggestion(spectrum: MeterResult['spectrum'], token: string, title?: string): Promise<LedSuggestion | null | undefined> {
  if (!token || !spectrum?.length) return undefined;
  try {
    const res = await fetch(`${BASE}/led_suggest`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ wls: spectrum.map((p) => p.nm), vals: spectrum.map((p) => p.value), title: title?.trim() || undefined }),
    });
    if (!res.ok) return undefined;
    const j = await res.json();
    const s = j?.suggestion;
    if (s && s.brand && s.model) return { brand: s.brand, model: s.model, cct: s.cct ?? null, source: s.source === 'title' ? 'title' : 'spectrum' };
    // No model-level match: the nominal CCT read from the curve is still worth offering (right ~9 times in 10).
    if (typeof j?.cctGuess === 'string' && j.cctGuess) return { brand: '', model: '', cct: j.cctGuess, source: 'cct' };
    return null;
  } catch {
    return undefined;
  }
}

/** Saves LED details on an uploaded report. Returns true if the server accepted it. */
export async function saveLedDetails(reportId: number, d: LedDetails, token: string): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/reports/${reportId}/led`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(d),
    });
    return res.ok;
  } catch {
    return false;
  }
}
