// src/hcri/uploadFlickerToHcri.ts
//
// Creates a flicker reading on hCRI.io and attaches it to an already-uploaded
// report. Always best-effort: it never throws and never changes the report
// upload's own outcome (older servers without the flicker API just 404).

import { HCRI_API_BASE } from './apiConfig';
import type { MeterResult, FlickerCapture } from '../ble/parseResult';
import { uploadToHcri, UploadResult } from './uploadToHcri';

const HCRI_FLICKER_URL = `${HCRI_API_BASE}/index.php/api/v1/flicker`;

export async function uploadFlickerToHcri(
  flicker: FlickerCapture,
  opts: { reportId?: number; label: string; model?: string; notes?: string },
  token: string,
  log?: (msg: string) => void
): Promise<boolean> {
  try {
    const settings: Record<string, number> = {};
    if (typeof flicker.sampleIdx === 'number') settings.sampleIdx = flicker.sampleIdx;
    if (typeof flicker.gear === 'number') settings.gear = flicker.gear;
    const body: Record<string, unknown> = {
      frequencyHz: flicker.frequencyHz,
      percentFlicker: flicker.percentFlicker,
      flickerIndex: flicker.flickerIndex,
      cycleMs: flicker.cycleMs,
      waveform: flicker.waveform,
      label: opts.label,
      capturedAt: new Date().toISOString(),
    };
    if (typeof opts.reportId === 'number') body.reportId = opts.reportId;
    if (opts.notes) body.notes = opts.notes;
    if (typeof flicker.spanMs === 'number') body.spanMs = flicker.spanMs;
    if (opts.model) body.model = opts.model;
    if (Object.keys(settings).length) body.settings = settings;

    const response = await fetch(HCRI_FLICKER_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      log?.(`Flicker upload skipped (${response.status})${opts.reportId ? ' -- the report itself was uploaded' : ''}.`);
      return false;
    }
    log?.(opts.reportId ? `Flicker reading attached to report ${opts.reportId}.` : 'Flicker reading uploaded.');
    return true;
  } catch (e: any) {
    log?.(`Flicker upload failed: ${e?.message ?? e}${opts.reportId ? ' -- the report itself was uploaded' : ''}.`);
    return false;
  }
}

/** uploadToHcri + (when the reading has a flicker capture) a best-effort
 * flicker upload attached to the new report. */
export async function uploadReadingToHcri(
  result: MeterResult,
  csv: string,
  label: string,
  token: string,
  log?: (msg: string) => void
): Promise<UploadResult> {
  const res = await uploadToHcri(csv, label, token, log);
  if (res.success && result.flicker && typeof res.reportId === 'number') {
    await uploadFlickerToHcri(
      result.flicker,
      { reportId: res.reportId, label, model: result.deviceName },
      token,
      log
    );
  }
  return res;
}
