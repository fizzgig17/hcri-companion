// src/utils/maskSecret.ts
//
// Shared "first 10 ... last 10" masking for anything secret-shaped (the
// hCRI.io API token, right now) that's still useful to show/log enough of
// to confirm "yes, that's the right key" without ever printing the whole
// thing -- used both by SettingsScreen (showing which key is currently
// loaded) and uploadToHcri's per-call log line (see HomeScreen.tsx).

/**
 * Masks a secret as `first10...last10`. Falls back to a single `***` for
 * anything too short to usefully split (< 24 chars -- short enough that
 * showing 10+10 of it would reveal most or all of the value anyway,
 * defeating the point of masking it).
 */
export function maskSecret(value: string): string {
  if (!value) return '';
  if (value.length < 24) return '***';
  return `${value.slice(0, 10)}...${value.slice(-10)}`;
}
