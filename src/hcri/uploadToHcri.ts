// src/hcri/uploadToHcri.ts
//
// Uploads a built CSV to hCRI.io's multipart upload endpoint. Mirrors the
// ESP32 firmware's uploadToHcri() function, but using fetch + FormData
// (React Native's networking stack), which is simpler than the ESP32's
// hand-rolled HTTPClient multipart body.

import { Buffer } from 'buffer';
import { HCRI_API_BASE } from './apiConfig';
import { maskSecret } from '../utils/maskSecret';
import fetchWithTimeout, { NetworkError, UPLOAD_TIMEOUT_MS } from './fetchWithTimeout';

const HCRI_UPLOAD_URL = `${HCRI_API_BASE}/index.php/api/v1/upload`;

export interface UploadResult {
  success: boolean;
  message: string;
  /** This upload's new report id, and whether it's public -- both come
   * straight back in the upload response itself (ingest_spd_upload()'s
   * return array), so getReportLink.ts can build a public report's link
   * for free, with no extra request. Undefined on failure, or if the
   * response wasn't the JSON shape expected (treated as "can't offer a
   * link for this one" rather than a hard error -- the upload itself
   * already succeeded either way). */
  reportId?: number;
  isPublic?: boolean;
  /** True when the server overwrote the report named by replaceId instead of creating a new one. */
  replaced?: boolean;
}

export async function uploadToHcri(
  csv: string,
  label: string,
  token: string,
  log?: (msg: string) => void,
  /** Id of this reading's existing hCRI.io report: the server overwrites it instead of creating a duplicate. */
  replaceId?: number
): Promise<UploadResult> {
  // Deliberately logs the server + endpoint + label + a masked form of the
  // key actually used -- never `csv` (that's the full wavelength/value
  // data, hundreds of lines per reading) and never the raw `token`. This
  // is what makes "which server did this go to, and under which key"
  // answerable from the Logs tab without reproducing/guessing it, while
  // keeping the log itself small enough to be useful (and shareable via
  // shareDebugLog) rather than dominated by spectral data dumps.
  log?.(`POST ${HCRI_UPLOAD_URL} label="${label}"${replaceId ? ` replaceId=${replaceId}` : ''} key=${maskSecret(token)}`);

  const form = new FormData();
  // React Native's FormData accepts this Blob-like shape for file fields.
  form.append('file', {
    uri: 'data:text/csv;base64,' + Buffer.from(csv).toString('base64'),
    name: `${label}.csv`,
    type: 'text/csv',
  } as any);
  form.append('label', label);
  if (replaceId) form.append('replaceId', String(replaceId));

  let response: Response;
  try {
    response = await fetchWithTimeout(HCRI_UPLOAD_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        // Do NOT set Content-Type manually -- fetch sets the multipart
        // boundary itself when the body is a FormData instance.
      },
      body: form,
    }, UPLOAD_TIMEOUT_MS);
  } catch (e: any) {
    if (e instanceof NetworkError) return { success: false, message: e.message };
    throw e;
  }

  const text = await response.text();
  if (!response.ok) {
    return { success: false, message: `Upload failed (${response.status}): ${text}` };
  }

  // Best-effort parse for id/isPublic -- `text` is logged verbatim above
  // regardless, so a parse failure here only costs the copy-link feature,
  // never the upload's own success/message result.
  let reportId: number | undefined;
  let isPublic: boolean | undefined;
  let replaced: boolean | undefined;
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed.id === 'number') reportId = parsed.id;
    if (typeof parsed.isPublic === 'boolean') isPublic = parsed.isPublic;
    if (typeof parsed.replaced === 'boolean') replaced = parsed.replaced;
  } catch {
    // Not JSON, or not the shape expected -- leave both undefined.
  }

  return { success: true, message: text || 'Uploaded', reportId, isPublic, replaced };
}