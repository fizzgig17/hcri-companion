// src/hcri/ledSync.ts
//
// Sends a reading's confirmed LED details to its hCRI.io report. Safe to call any time (after an upload, after
// confirming): does nothing unless the reading has LED details, an uploaded report and hasn't been synced yet.

import { loadHistory, updateReadingLed } from '../storage/readingHistory';
import { loadHcriCredentials } from '../storage/secureStorage';
import { saveLedDetails } from './ledApi';
import { ledsOfReading } from './leds';

export async function syncLedForReading(id: string): Promise<boolean> {
  try {
    const r = (await loadHistory()).find((x) => x.id === id);
    const leds = ledsOfReading(r);
    if (!r || !leds.length || !r.reportId || r.ledSynced) return false;
    const creds = await loadHcriCredentials();
    if (!creds?.token) return false;
    const ok = await saveLedDetails(r.reportId, leds, creds.token);
    if (ok) await updateReadingLed(id, { ledSynced: true });
    return ok;
  } catch {
    return false;
  }
}
