// src/hcri/uploadRuntimeToHcri.ts
//
// Uploads one recorded output-over-time curve to the signed-in user's private Runtime list on hCRI.io
// (POST /api/v1/runtime, JSON {items:[{label, group, unit, intervalSeconds, values}]}). A curve with the same label is
// replaced, so re-uploading a run under the same name updates it. Returns an error message, or null on success.

import { HCRI_API_BASE } from './apiConfig';
import fetchWithTimeout, { UPLOAD_TIMEOUT_MS } from './fetchWithTimeout';

const HCRI_RUNTIME_URL = `${HCRI_API_BASE}/index.php/api/v1/runtime`;

export interface RuntimeUpload {
  label: string;
  group?: string;
  unit?: string;
  intervalSeconds: number;
  values: number[];
}

export async function uploadRuntimeToHcri(item: RuntimeUpload, token: string): Promise<string | null> {
  try {
    const response = await fetchWithTimeout(HCRI_RUNTIME_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: [item] }),
    }, UPLOAD_TIMEOUT_MS);
    if (response.ok) return null;
    let detail = '';
    try {
      const j = await response.json();
      detail = typeof j?.error === 'string' ? j.error : typeof j?.message === 'string' ? j.message : '';
    } catch {}
    if (response.status === 401 || response.status === 403) return 'hCRI.io did not accept your sign-in. Check your account in Settings.';
    if (response.status === 404) return 'hCRI.io does not have Runtime yet. Try again after the site is updated.';
    return detail || `hCRI.io returned ${response.status}.`;
  } catch (e: any) {
    return e?.message ?? 'Could not reach hCRI.io.';
  }
}
