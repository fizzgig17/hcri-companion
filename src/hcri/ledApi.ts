// src/hcri/ledApi.ts
//
// LED suggestion + saving LED details on an uploaded report. Both need the
// person's API token (same one uploads use). Only brand/model/CCT text is
// exchanged; the site never returns anything about other people's reports.

import { HCRI_API_BASE } from './apiConfig';
import { MeterResult } from '../ble/parseResult';

const BASE = `${HCRI_API_BASE}/index.php/api/v1`;

export interface LedDetails { brand?: string; model?: string; cct?: string }
export interface LedSuggestion { brand: string; model: string; cct: string | null }

/** Returns the clear winner for this spectrum, or null (no match / offline / error). */
export async function fetchLedSuggestion(spectrum: MeterResult['spectrum'], token: string): Promise<LedSuggestion | null> {
  if (!token || !spectrum?.length) return null;
  try {
    const res = await fetch(`${BASE}/led_suggest`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ wls: spectrum.map((p) => p.nm), vals: spectrum.map((p) => p.value) }),
    });
    if (!res.ok) return null;
    const j = await res.json();
    const s = j?.suggestion;
    return s && s.brand && s.model ? { brand: s.brand, model: s.model, cct: s.cct ?? null } : null;
  } catch {
    return null;
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
