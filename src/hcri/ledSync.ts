// src/hcri/ledSync.ts
//
// Sends a reading's confirmed LED details and its other categories (light brand / model, optic, lumens, current) to its
// hCRI.io report. Safe to call any time (after an upload, after Categorize): each part does nothing unless the reading
// has that part, an uploaded report, and hasn't been sent yet. Returns true when everything that was due went through.

import { loadHistory, updateReadingLed } from '../storage/readingHistory';
import { loadHcriCredentials } from '../storage/secureStorage';
import { saveCategoryDetails, saveLedDetails } from './ledApi';
import { ledsOfReading } from './leds';

export async function syncLedForReading(id: string): Promise<boolean> {
  try {
    const r = (await loadHistory()).find((x) => x.id === id);
    if (!r || !r.reportId) return false;
    const leds = ledsOfReading(r);
    // No LEDs: only send when the person removed them on purpose (an empty list replaces the report's LEDs).
    const ledDue = !r.ledSynced && (leds.length > 0 || !!r.ledCleared);
    const cats: Record<string, string> = {};
    for (const [k, v] of Object.entries(r.categories ?? {})) if (v && v.trim()) cats[k] = v.trim();
    const catDue = r.catSynced === false && Object.keys(cats).length > 0;
    if (!ledDue && !catDue) return false;
    const creds = await loadHcriCredentials();
    if (!creds?.token) return false;
    let ok = true;
    if (ledDue) {
      const sent = await saveLedDetails(r.reportId, leds, creds.token);
      if (sent) await updateReadingLed(id, { ledSynced: true, ...(leds.length ? { ledCleared: false } : {}) });
      ok = ok && sent;
    }
    if (catDue) {
      const sent = await saveCategoryDetails(r.reportId, cats, creds.token);
      if (sent) await updateReadingLed(id, { catSynced: true });
      ok = ok && sent;
    }
    return ok;
  } catch {
    return false;
  }
}
