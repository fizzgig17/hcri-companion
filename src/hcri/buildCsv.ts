// src/hcri/buildCsv.ts
//
// Builds the CSV payload hCRI.io expects. Per your earlier call on the ESP32
// project, this is deliberately minimal -- just the model name and the raw
// wavelength/value spectrum. Everything else (CCT, Ra, x/y, etc.) is a
// standard colorimetric calculation hCRI.io derives from the spectrum itself,
// so there's no need to duplicate that math here or send it over the wire.

import { MeterResult } from '../ble/parseResult';

export function buildCsv(result: MeterResult): string {
  const lines: string[] = [];
  lines.push(`Model,${result.deviceName || 'HPCS-330P'}`);

  if (result.spectrum.length > 0) {
    lines.push(`StartTestWave,${result.spectrum[0].nm}`);
    lines.push(`EndTestWave,${result.spectrum[result.spectrum.length - 1].nm}`);
  }

  for (const point of result.spectrum) {
    lines.push(`${point.nm},${point.value}`);
  }

  return lines.join('\n');
}

/**
 * A human-readable local date/time/timezone stamp, e.g. "2026-09-28 2:01pm
 * EST" -- used by defaultLabel() below, pulled out on its own since it's
 * the fiddly part (12-hour clock, lowercase am/pm, a timezone abbreviation
 * that plain Date methods don't give you at all).
 */
function friendlyStamp(now: Date): string {
  const y = now.getFullYear();
  const mo = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const datePart = `${y}-${mo}-${d}`;

  let hours = now.getHours();
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const ampm = hours >= 12 ? 'pm' : 'am';
  hours = hours % 12 || 12;
  const timePart = `${hours}:${minutes}${ampm}`;

  // Intl's timeZoneName needs full ICU data to resolve an abbreviation like
  // "EST" -- not guaranteed present in every Hermes build. Falls back to a
  // plain UTC offset (e.g. "UTC-4") rather than silently dropping the
  // timezone entirely if that data isn't available. Uppercased either way
  // -- "EST"/"UTC-4", not "est"/"utc-4" -- matching how a timezone
  // abbreviation is conventionally written everywhere else (the website
  // included), even though the rest of this stamp (am/pm) stays lowercase.
  let tz = '';
  try {
    const part = new Intl.DateTimeFormat('en-US', { timeZoneName: 'short' })
      .formatToParts(now)
      .find((p) => p.type === 'timeZoneName');
    if (part) tz = part.value.toUpperCase();
  } catch {
    // fall through to the offset-based fallback below
  }
  if (!tz) {
    const offsetMin = -now.getTimezoneOffset(); // minutes EAST of UTC
    const sign = offsetMin >= 0 ? '+' : '-';
    tz = `UTC${sign}${Math.abs(offsetMin) / 60}`;
  }

  return `${datePart} ${timePart} ${tz}`;
}

/** Default label when the user hasn't typed/renamed one: username + timestamp + device, e.g. "fizzgig 2026-09-28 2:01pm EST HPCS-330P". Any piece that isn't available (no hCRI.io account set up yet, or called before a device name is known) is just left out rather than leaving a blank placeholder behind. */
export function defaultLabel(username: string | null, deviceName?: string | null): string {
  const parts = [username, friendlyStamp(new Date()), deviceName].filter(
    (p): p is string => !!p && p.trim().length > 0
  );
  return parts.join(' ');
}

/**
 * Combines multiple saved readings into one plain-text export (see
 * shareCsv.ts, HistoryTab.tsx's "Share All as CSV"). Different readings can
 * have different wavelength ranges/point counts (a different model, or the
 * same model with the sensor's auto-exposure landing on a different
 * captured range), so this deliberately isn't one single rectangular table
 * -- that would mean either padding every reading out to the widest range
 * seen (misleading -- looks like real zero-signal data at wavelengths a
 * given reading never actually captured) or silently dropping mismatched
 * columns. Instead each reading gets its own clearly-labeled block, in the
 * exact same Model/StartTestWave/EndTestWave/nm,value shape buildCsv()
 * already produces for a single reading -- just with a "Reading"/"SavedAt"
 * header line in front of each one and a blank line between them, so it's
 * still trivial to tell where one reading ends and the next begins.
 */
export function buildCombinedCsv(readings: { label: string; savedAt: number; result: MeterResult }[]): string {
  return readings
    .map((r) => [`Reading,${r.label}`, `SavedAt,${new Date(r.savedAt).toISOString()}`, buildCsv(r.result)].join('\n'))
    .join('\n\n');
}
