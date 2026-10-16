// src/ble/meterLabel.ts
//
// What the app calls a meter on screen (Main status row, "Switch meter" list).
// HPCS meters advertise "<model>-<serial>" (e.g. "HPCS-330P-0635249"); people
// only need the model there. The full name (with serial) is still what the
// rest of the app uses for field offsets, CSVs and uploads.

import { BRIDGE_NAME, isTorchBearerName } from './torchBearer';

/** "HPCS-330P-0635249" -> "HPCS-330P". Names without a trailing serial are returned unchanged. */
export function hpcsModelName(name: string | null | undefined): string | null {
  if (!name) return null;
  return name.replace(/[-_ ]\d{4,}$/, '');
}

/**
 * Label for one meter in the "Switch meter" list. A bridge is always called "hCRI Bridge", followed by what is
 * plugged into it when that is known ("hCRI Bridge · ColorMunki"), so a bridge reads the same whether or not it is
 * the one currently connected. HPCS meters show the model only.
 * @param attached what is behind the bridge if known ('ColorMunki' | 'Torch Bearer'), else null.
 */
export function meterListLabel(advertisedName: string | null | undefined, isBridge: boolean, attached: string | null): string {
  if (isBridge || isTorchBearerName(advertisedName)) return attached ? `${BRIDGE_NAME} · ${attached}` : BRIDGE_NAME;
  return hpcsModelName(advertisedName) || '(unnamed)';
}
