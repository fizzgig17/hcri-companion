// src/hcri/leds.ts
//
// A reading can carry more than one LED, each with its own brand, model and CCT. `led` (the first LED) is kept on
// every reading so older code paths and stored readings keep working; `leds` is the full list.

import { LedDetails } from './ledApi';

export const MAX_LEDS = 8;

export function hasLed(l?: LedDetails | null): boolean {
  return !!(l && (l.brand?.trim() || l.model?.trim() || l.cct?.trim()));
}

/** The reading's LEDs (empty blanks dropped): `leds` if present, else the single older `led`. */
export function ledsOfReading(r: { led?: LedDetails; leds?: LedDetails[] } | null | undefined): LedDetails[] {
  if (!r) return [];
  const list = r.leds && r.leds.length ? r.leds : r.led ? [r.led] : [];
  return list.filter((l) => hasLed(l));
}

/** "Nichia 519A · 3000K" */
export function ledLine(l: LedDetails): string {
  const name = [l.brand, l.model].filter(Boolean).join(' ');
  return name + (l.cct ? `${name ? ' · ' : ''}${l.cct}` : '');
}

/** All LEDs on one line: "Nichia 519A · 1800K + Luminus SST-20-DR". */
export function ledsLine(leds: LedDetails[]): string {
  return leds.map(ledLine).filter(Boolean).join(' + ');
}

/** The fields to store on a reading for a confirmed list: `led` is the first, `leds` the whole list. */
export function ledPatch(leds: LedDetails[]): { led?: LedDetails; leds?: LedDetails[] } {
  const clean = leds.filter(hasLed).map((l) => ({ brand: l.brand?.trim() ?? '', model: l.model?.trim() ?? '', cct: l.cct?.trim() ?? '' }));
  return { led: clean[0], leds: clean };
}
