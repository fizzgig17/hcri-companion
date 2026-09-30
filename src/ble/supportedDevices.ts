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
    matchedBy: 'Advertised name contains "310"',
    verified: true,
    verifiedDate: '2026-09-26',
    notes: [
      'Shorter result layout than the 330-family models -- drops most of the PAR/PPFD block.',
      'Does not report illuminance (lux) -- shown as "—" in this app rather than a wrong number.',
    ],
  },
  {
    model: 'HPCS-330',
    matchedBy: 'Advertised name contains "330", but not "330P" or "330PRO"/"330 PRO"',
    verified: true,
    verifiedDate: '2026-09-27',
    notes: [
      'Same result layout as the HPCS-310, plus a working illuminance (lux) field the 310 lacks.',
      'A distinct model from the HPCS-330P below -- same-looking name, genuinely different byte layout. Don\'t merge these.',
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
    model: 'Any other "HPCS*" device',
    matchedBy: 'Fallback default when nothing above matches',
    verified: false,
    notes: [
      'Falls back to the HPCS-330P map as a best guess -- may still be wrong for a genuinely different model.',
      'If you have one of these, a debug-log capture (Logs tab -> Share Debug Log) of a real reading, plus a screenshot of the same reading in the vendor app, is what\'s needed to verify and add real support for it.',
    ],
  },
];
