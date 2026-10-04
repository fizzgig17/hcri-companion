// src/hcri/getReportLink.ts
//
// Turns a just-uploaded report's {id, isPublic} (see UploadResult in
// uploadToHcri.ts) into a copyable hcri.io link.
//
// A public report's link needs no extra request -- it's just
// SITE_URL/?report={id}, same shape ReportDetail.jsx's own copyLink()
// builds on the website. A private (explore-excluded) report has no
// share_token yet, and the only endpoint that can mint/fetch one
// (reports_item.php's shareAction PATCH) requires a session JWT, which
// this app never has -- it only ever holds a long-lived API token (see
// generateApiToken.ts / secureStorage.ts). POST /api/v1/reports/:id/share
// (api/v1_share.php) is the narrow, API-token-authenticated counterpart
// added specifically for this: it reuses the report's existing
// share_token if one's already set, rather than minting a new one (and
// so silently invalidating a link already handed out) on every tap.

import { HCRI_API_BASE } from './apiConfig';
import { maskSecret } from '../utils/maskSecret';

function shareUrl(reportId: number): string {
  return `${HCRI_API_BASE}/index.php/api/v1/reports/${reportId}/share`;
}

export interface ReportLinkResult {
  success: boolean;
  /** The ready-to-copy hcri.io URL. Only set when success is true. */
  link?: string;
  /** User-facing reason it failed, safe to show directly in an Alert. */
  message?: string;
}

/**
 * Resolves the copyable link for report `reportId`. `isPublic` comes
 * straight from the upload response, so a public report's link is built
 * locally with no request at all; a private one calls the new share
 * endpoint above.
 */
export async function getReportLink(
  reportId: number,
  isPublic: boolean,
  token: string,
  log?: (msg: string) => void
): Promise<ReportLinkResult> {
  if (isPublic) {
    // Same host the upload itself just went to (HCRI_API_BASE is both the
    // API and site origin -- see apiConfig.ts), so this always matches
    // whichever hcri.io this build talks to (dev vs. production) with no
    // separate "site URL" of its own to keep in sync.
    return { success: true, link: `${HCRI_API_BASE}/?report=${reportId}` };
  }

  const url = shareUrl(reportId);
  log?.(`POST ${url} key=${maskSecret(token)}`);

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (e: any) {
    return { success: false, message: e?.message || 'Could not reach the server.' };
  }

  const text = await response.text();
  if (!response.ok) {
    let reason = text;
    try {
      const parsed = JSON.parse(text);
      if (parsed.error) reason = parsed.error;
    } catch {
      // leave `reason` as the raw text
    }
    return { success: false, message: reason || `Could not get a link (${response.status})` };
  }

  try {
    const data = JSON.parse(text);
    if (typeof data.link === 'string' && data.link) {
      return { success: true, link: data.link };
    }
  } catch {
    // fall through to the generic failure below
  }
  return { success: false, message: 'Server did not return a link.' };
}
