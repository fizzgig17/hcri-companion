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
  if (isBridge || isTorchBearerName(advertisedName)) return attached ? `${BRIDGE_NAME} · ${attached === 'none' ? 'nothing plugged in' : attached}` : BRIDGE_NAME;
  return hpcsModelName(advertisedName) || '(unnamed)';
}

export type BridgeAttached = 'ColorMunki' | 'Torch Bearer' | 'TKLamp' | 'none';

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * What a bridge says is plugged into it, read from its scan response: manufacturer data (base64, company id
 * first) = FF FF 'h' 'C' <0 nothing | 1 Torch Bearer | 2 ColorMunki | 3 TKLamp tester>. Returns null when the field is missing
 * (older bridge firmware), so those bridges keep being listed as before.
 */
export function bridgeAttachedFromAdv(manufacturerData: string | null | undefined): BridgeAttached | null {
  if (!manufacturerData) return null;
  const bytes: number[] = [];
  let acc = 0;
  let bits = 0;
  for (const ch of manufacturerData) {
    if (ch === '=') break;
    const v = B64.indexOf(ch);
    if (v < 0) return null;
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((acc >> bits) & 0xff);
    }
  }
  if (bytes.length < 5 || bytes[0] !== 0xff || bytes[1] !== 0xff || bytes[2] !== 0x68 || bytes[3] !== 0x43) return null;
  return bytes[4] === 1 ? 'Torch Bearer' : bytes[4] === 2 ? 'ColorMunki' : bytes[4] === 3 ? 'TKLamp' : 'none';
}
