// src/hcri/uploadToHcri.ts
//
// Uploads a built CSV to hCRI.io's multipart upload endpoint. Mirrors the
// ESP32 firmware's uploadToHcri() function, but using fetch + FormData
// (React Native's networking stack), which is simpler than the ESP32's
// hand-rolled HTTPClient multipart body.

import { Buffer } from 'buffer';
import { HCRI_API_BASE } from './apiConfig';

const HCRI_UPLOAD_URL = `${HCRI_API_BASE}/index.php/api/v1/upload`;

export interface UploadResult {
  success: boolean;
  message: string;
}

export async function uploadToHcri(
  csv: string,
  label: string,
  token: string
): Promise<UploadResult> {
  const form = new FormData();
  // React Native's FormData accepts this Blob-like shape for file fields.
  form.append('file', {
    uri: 'data:text/csv;base64,' + Buffer.from(csv).toString('base64'),
    name: `${label}.csv`,
    type: 'text/csv',
  } as any);
  form.append('label', label);

  const response = await fetch(HCRI_UPLOAD_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      // Do NOT set Content-Type manually -- fetch sets the multipart
      // boundary itself when the body is a FormData instance.
    },
    body: form,
  });

  const text = await response.text();
  if (!response.ok) {
    return { success: false, message: `Upload failed (${response.status}): ${text}` };
  }
  return { success: true, message: text || 'Uploaded' };
}