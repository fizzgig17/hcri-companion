// src/ble/supportedDevices.ts
//
// The user-facing registry of every meter model this app knows how to read,
// shown on the About tab. This is deliberately separate from the actual
// offset maps in protocol.ts (which are what the parser uses) -- this file
// exists so there's one place that describes things in plain English for a
// person looking at the app, rather than making them read field-offset
// tables to find out what's supported.
//
// IMPORTANT: whenever a new model's offsets get added to protocol.ts
// (a new FIELD_OFFSETS_* map + a branch in getFieldOffsetsForDevice), add a
// matching entry here too -- these two files are meant to be kept in sync
// by hand, not derived from each other, so it's an easy step to forget.

export interface SupportedDevice {
  /** Display name shown on the About tab. */
  model: string;
  /** How the advertised BLE name is matched, in plain English (mirrors the actual check in protocol.ts's getFieldOffsetsForDevice). */
  matchedBy: string;
  /** Whether the field-offset map was derived from and cross-checked against a real captured hex dump + vendor-app reference reading, or is still an unverified guess. */
  verified: boolean;
  /** The date a hex dump was captured/verified, if known. */
  verifiedDate?: string;
  /** Anything worth knowing about this model specifically. */
  notes: string[];
}

export const SUPPORTED_DEVICES: SupportedDevice[] = [
  {
    model: 'HPCS-310',
    matchedBy: 'Advertised name contains "310", but not "310P"',
    verified: true,
    verifiedDate: '2026-09-26',
    notes: [
      'Shorter result layout than the 330-family models -- drops most of the PAR/PPFD block.',
      'Does not report illuminance (lux) -- shown as "—" in this app rather than a wrong number. Confirmed 2026-10-01: a second real debug-log capture shows the only other plausible candidate offset for lux on this model (checked after a cross-check against an independent reference decoder raised the question) parses to values in the hundreds of thousands -- not a real lux reading -- so this really is unreported on the 310, not a byte-offset bug.',
      'Firmware-aware offsets added 2026-10-01: the reference decoder above shows the vendor app shifts several fields (integration time, peak/dark signal) 16 bytes later on firmware newer than 2005. Every real capture seen so far has been on that newer firmware, so this app now branches on it (FIELD_OFFSETS_310_LEGACY) -- but the older-firmware branch itself is unverified against a real device.',
    ],
  },
  {
    model: 'HPCS-310P',
    matchedBy: 'Advertised name contains "310P"',
    verified: true,
    verifiedDate: '2026-10-01',
    notes: [
      'Despite the "310" in its name, byte-for-byte identical layout to the HPCS-330P, not the shorter plain-310 layout -- reuses FIELD_OFFSETS_330P.',
      'Was briefly broken (like 330/330P before it): its name matching the bare "310" pattern too made it get misidentified as a plain HPCS-310 and read with the wrong (shorter) offsets, producing nonsense values. Fixed by checking "310P" before the bare "310" check.',
    ],
  },
  {
    model: 'HPCS-330',
    matchedBy: 'Advertised name contains "330", but not "330P" or "330PRO"/"330 PRO"',
    verified: true,
    verifiedDate: '2026-09-27',
    notes: [
      'Same result layout as the HPCS-310, plus an illuminance (lux) field the 310 lacks. RESOLVED 2026-10-01: an outside reference decoder had raised a different candidate byte offset for lux, close enough in result (~2%) that this app\'s existing offset 188 might have been coincidentally close rather than actually correct. A fresh debug-log capture let both offsets get checked side by side against the same vendor-app Lx reading -- the alternate candidate came out nowhere close (off by 50%+), while offset 188 stayed within the same ~2% reading-to-reading noise seen elsewhere. Offset 188 is confirmed correct.',
      'A distinct model from the HPCS-330P below -- same-looking name, genuinely different byte layout. Don\'t merge these.',
      'Firmware-aware offsets added 2026-10-01: see the matching HPCS-310 note above -- same mechanism, same "not yet verified against an older-firmware unit" caveat (FIELD_OFFSETS_330_LEGACY).',
    ],
  },
  {
    model: 'HPCS-330P',
    matchedBy: 'Advertised name contains "330P" (but not "330PRO"/"330 PRO")',
    verified: true,
    verifiedDate: '2026-09-27',
    notes: [
      'The original layout this app\'s whole protocol was first reverse-engineered against, early in this project -- verified against a real device ("HPCS-330P-0635249").',
      'Was briefly broken (2026-09-27): its name matching the plain "330" pattern too made it get misidentified as a plain HPCS-330 and read with the wrong offsets, producing believable-looking but wrong numbers. Fixed by checking "330P" before the bare "330" check.',
    ],
  },
  {
    model: 'HPCS330Pro',
    matchedBy: 'Advertised name contains "330PRO" or "330 PRO"',
    verified: true,
    verifiedDate: '2026-09-27',
    notes: [
      'Its own distinct layout -- not the same as the plain HPCS-330 or HPCS-330P.',
      'Reports TM-30 Rf/Rg (fidelity/gamut) in addition to CRI Ra/R1-R15, which no other supported model does.',
      'Does not have a confirmed illuminance (lux) field yet -- shown as "—" until one is verified.',
    ],
  },
  {
    model: 'Torch Bearer (via ESP32 bridge)',
    matchedBy: 'Advertised name starts with "Torch Bearer" (the T-Display S3 bridge firmware, not the spectrometer itself)',
    verified: false,
    notes: [
      'Spectrum-only device: CCT, Duv, CRI/R1-R15 and TM-30 Rf/Rg are computed by the app from the spectrum, the same way as for the HPCS meters.',
      'Lux and PAR are calculated from the raw spectrum using the Torch Bearer\'s own units (W/m\u00b2/nm) and have NOT been calibrated against a reference meter yet -- treat them as approximate.',
      'Single reading only for now: Live, Flicker and battery are not available on this device.',
    ],
  },
  {
    model: 'Any other "HPCS*" device',
    matchedBy: 'Fallback default when nothing above matches',
    verified: false,
    notes: [
      'Falls back to the HPCS-330P map as a best guess -- may still be wrong for a genuinely different model.',
      'If you have one of these, a debug-log capture (Logs tab -> Share Debug Log) of a real reading, plus a screenshot of the same reading in the vendor app, is what\'s needed to verify and add real support for it.',
    ],
  },
];
