// src/ble/bridgeFirmware.ts
//
// Firmware update of the ESP32 bridge over Bluetooth: the pure parts (packets, checksums, release file names). The
// bridge side is "Firmware update" in hcri-esp32-bridge/src/main.cpp; the Bluetooth transfer itself is
// MeterConnection.updateBridgeFirmware(). Kept free of React Native so the tests can run it directly.

export const TB_OTA_UUID = '7a1c0005-5b2e-4f0a-9c3d-2e8f6b4a1d00';
export const TB_INFO_UUID = '7a1c0006-5b2e-4f0a-9c3d-2e8f6b4a1d00';

export const BRIDGE_REPO = 'fizzgig17/hcri-esp32-bridge';

export type BridgeBoard = 's3' | 'pro';

export interface BridgeInfo {
  protocol: number;
  /** The firmware can receive an update over Bluetooth. */
  canUpdate: boolean;
  board: BridgeBoard;
  /** App slot the bridge is running from (0 or 1). */
  slot: number;
  /** Git commit the firmware was built from ("dev" when it was built without git). */
  commit: string;
}

/** Reads the bridge's info characteristic: [proto][flags][board][slot][0] then the git commit as text. Null if it is not one. */
export function parseBridgeInfo(b: Uint8Array): BridgeInfo | null {
  if (b.length < 5 || b[0] < 1) return null;
  let commit = '';
  for (let i = 5; i < b.length; i++) {
    const c = b[i];
    if (c >= 0x20 && c < 0x7f) commit += String.fromCharCode(c);
  }
  return { protocol: b[0], canUpdate: (b[1] & 1) !== 0, board: b[2] === 1 ? 'pro' : 's3', slot: b[3] & 1, commit: commit.trim() };
}

export function boardByte(board: BridgeBoard): number {
  return board === 'pro' ? 1 : 0;
}

export function boardLabel(board: BridgeBoard): string {
  return board === 'pro' ? 'T-Display S3 Pro' : 'T-Display S3';
}

/** The release holds the S3's app as firmware.bin and the Pro's as firmware-pro.bin, each with its own checksum file. */
export function releaseAssetNames(board: BridgeBoard): { bin: string; sums: string } {
  return board === 'pro' ? { bin: 'firmware-pro.bin', sums: 'SHA256SUMS-pro.txt' } : { bin: 'firmware.bin', sums: 'SHA256SUMS.txt' };
}

/** Development builds of the app follow the development firmware, released builds the released one. */
export function releaseTag(devBuild: boolean): string {
  return devBuild ? 'dev-latest' : 'prod-latest';
}

export function releaseDownloadUrl(tag: string, name: string): string {
  return `https://github.com/${BRIDGE_REPO}/releases/download/${tag}/${name}`;
}

/** The hash for `name` from a sha256sum listing ("<64 hex>  <name>", the name optionally starred); null if there is none. */
export function parseSums(text: string, name: string): string | null {
  for (const line of text.split(/\r?\n/)) {
    const m = /^([0-9a-fA-F]{64})\s+\*?(.+?)\s*$/.exec(line.trim());
    if (m && m[2].split('/').pop() === name) return m[1].toLowerCase();
  }
  return null;
}

/** Fields of an ESP-IDF app image that matter here: the git commit the firmware stamps into it, and when it was built. */
export interface ImageInfo {
  commit: string;
  date: string;
  time: string;
}

/** Checks the image looks like an ESP32 app and reads its description (esp_app_desc_t sits 0x20 bytes in); null if not one. */
export function parseImageInfo(img: Uint8Array): ImageInfo | null {
  if (img.length < 0x20 + 112 || img[0] !== 0xe9) return null;
  const dv = new DataView(img.buffer, img.byteOffset, img.byteLength);
  if (dv.getUint32(0x20, true) !== 0xabcd5432) return null;
  const text = (from: number, len: number) => {
    let s = '';
    for (let i = 0; i < len; i++) {
      const c = img[0x20 + from + i];
      if (c === 0) break;
      s += String.fromCharCode(c);
    }
    return s;
  };
  return { commit: text(16, 32), date: text(96, 16), time: text(80, 16) };
}

/** True when both name the same commit (first 7 characters); a build with no git ("dev") is never taken for a match. */
export function sameCommit(a: string, b: string): boolean {
  const x = a.trim().toLowerCase().slice(0, 7);
  const y = b.trim().toLowerCase().slice(0, 7);
  return x.length === 7 && x === y && /^[0-9a-f]{7}$/.test(x);
}

/** Bytes of firmware per Bluetooth write for this ATT MTU (3 bytes ATT header and 5 bytes op + offset come off). */
export function otaPayloadSize(mtu: number | null | undefined): number {
  const m = mtu && mtu > 23 ? mtu : 23;
  return Math.max(16, Math.min(240, m - 3 - 5));
}

// ------------------------------------------------------------------------------------------ packets

/** 01 | size u32 | sha256[32] | board u8 */
export function buildOtaBegin(size: number, sha: Uint8Array, board: BridgeBoard): Uint8Array {
  const p = new Uint8Array(38);
  p[0] = 0x01;
  new DataView(p.buffer).setUint32(1, size, true);
  p.set(sha.subarray(0, 32), 5);
  p[37] = boardByte(board);
  return p;
}

/** 02 | offset u32 | bytes */
export function buildOtaData(offset: number, bytes: Uint8Array): Uint8Array {
  const p = new Uint8Array(5 + bytes.length);
  p[0] = 0x02;
  new DataView(p.buffer).setUint32(1, offset, true);
  p.set(bytes, 5);
  return p;
}

export const OTA_END = new Uint8Array([0x03]);
export const OTA_ABORT = new Uint8Array([0x04]);

export type OtaEvent =
  | { type: 'begin'; slot: number }
  | { type: 'progress'; received: number }
  | { type: 'done' }
  | { type: 'resend'; expected: number }
  | { type: 'error'; code: number };

/** One notification from the update characteristic (81 begin, 82 progress, 83 done, E1 resend, E0 error); null if it is none of them. */
export function parseOtaEvent(b: Uint8Array): OtaEvent | null {
  if (b.length < 1) return null;
  const u32 = () => (b.length >= 5 ? new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(1, true) : -1);
  switch (b[0]) {
    case 0x81: return { type: 'begin', slot: b.length > 1 ? b[1] : 0 };
    case 0x82: { const r = u32(); return r < 0 ? null : { type: 'progress', received: r }; }
    case 0x83: return { type: 'done' };
    case 0xe1: { const r = u32(); return r < 0 ? null : { type: 'resend', expected: r }; }
    case 0xe0: return { type: 'error', code: b.length > 1 ? b[1] : 0 };
    default: return null;
  }
}

export function otaErrorText(code: number): string {
  switch (code) {
    case 1: return 'The bridge refused the update (wrong board type, or the file is the wrong size).';
    case 2: return 'The bridge could not write the update to its flash memory.';
    case 3: return 'The bridge was not ready for the update. Try again.';
    case 4: return 'The update did not arrive completely. Try again, with the phone closer to the bridge.';
    case 5: return 'The update was damaged on the way (checksum mismatch). Nothing was changed. Try again.';
    case 6: return 'The bridge did not accept the new firmware. Nothing was changed.';
    default: return `The bridge reported an error (${code}).`;
  }
}

// ------------------------------------------------------------------------------------------ SHA-256

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** SHA-256 of `data`. Plain JavaScript, so no native module is needed; about a tenth of a second for the 0.7 MB firmware. */
export function sha256(data: Uint8Array): Uint8Array {
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const len = data.length;
  const total = (((len + 8) >> 6) + 1) << 6;   // data, 0x80, zeros, 8-byte bit length: a multiple of 64
  const buf = new Uint8Array(total);
  buf.set(data);
  buf[len] = 0x80;
  const dv = new DataView(buf.buffer);
  dv.setUint32(total - 8, Math.floor(len / 0x20000000), false);   // high word of the bit length
  dv.setUint32(total - 4, (len << 3) >>> 0, false);
  const w = new Uint32Array(64);
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15], b = w[i - 2];
      const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3);
      const s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0; h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0; h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + hh) >>> 0;
  }
  const out = new Uint8Array(32);
  const odv = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) odv.setUint32(i * 4, h[i], false);
  return out;
}

export function toHexString(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i++) s += (b[i] < 16 ? '0' : '') + b[i].toString(16);
  return s;
}
