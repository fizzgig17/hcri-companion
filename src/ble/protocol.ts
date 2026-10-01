// src/ble/protocol.ts
//
// All constants describing the Hopoocolor HPCS-330P's BLE protocol, as plain
// data. Nothing in this file talks to the radio -- see MeterConnection.ts for
// that. Keeping this as pure data makes it easy to update if a firmware
// revision ever changes something (a new UUID, a different offset, etc.)
// without having to dig through connection-handling logic.
//
// Source: hpcs330p-ble-protocol-spec.md (reverse-engineered from real BLE
// captures, verified byte-for-byte against the vendor app's own CSV export).

/**
 * Every command, framing rule, and field offset in this file was reverse-
 * engineered against an HPCS-330P specifically, but as far as we've been
 * able to tell this is Hopoocolor's shared BLE protocol across their
 * spectrometer lineup, not something unique to the 330P -- the same command
 * bytes, response framing, and completion-detection behavior should apply
 * to sibling models too. What DOES vary per model is the advertised device
 * name (each model appends its own product code + a per-unit serial
 * number, e.g. "HPCS-330P-0635249").
 *
 * So: match on the common "HPCS" root rather than a specific model number
 * like "HPCS-330P" -- that covers HPCS310, HPCS-330P, and any other model
 * in the same naming scheme without needing to list every one out by hand.
 * This list still exists (rather than one hardcoded string) so you can
 * either broaden it further (e.g. add "OHS" if that USB-only sibling line
 * ever gets a BLE variant) or narrow it back to specific models if a future
 * one turns out to actually speak a different protocol -- in which case
 * that's the point to split this into a per-model driver instead of a
 * shared one. No evidence of that yet.
 */
export const METER_NAME_PREFIXES = ['HPCS'];

/**
 * Whenever a model is added or changed below (a new FIELD_OFFSETS_* map, a
 * new branch in getFieldOffsetsForDevice), also update
 * src/ble/supportedDevices.ts -- that's the plain-English version of this
 * same information shown on the app's About tab, and it isn't derived from
 * this file automatically.
 */

/**
 * IMPORTANT: these UUIDs are placeholders.
 *
 * Every BLE capture we took during reverse-engineering (iOS PacketLogger,
 * Android HCI snoop, USB+Wireshark, and a real Nordic sniffer) reported the
 * data characteristic only by its ATT handle (0x0010), never by its
 * underlying 128-bit UUID -- the sniffing tools we used don't surface that
 * layer. So we've never actually seen the real UUID yet.
 *
 * This is a one-time gap, not an ongoing one: the UUID is a fixed property
 * of the meter's firmware (identical across every unit running the same
 * firmware, exactly like the ATT handle was identical across every capture
 * session we took). Once we find it -- via the discovery step in
 * MeterConnection.ts's first-connect path -- it gets hardcoded here
 * permanently, the same way TARGET_HANDLE was hardcoded in the ESP32
 * firmware.
 *
 * Run the app once, connect to a meter, and check the logs: discoverServices
 * will print every service/characteristic UUID found. Look for the one that
 * is both writable and notifying (properties will show up as
 * Write/WriteWithoutResponse + Notify) -- that's this one. Paste it in below.
 */
export const METER_SERVICE_UUID_PLACEHOLDER = '00000000-0000-0000-0000-000000000000';
export const METER_CHARACTERISTIC_UUID_PLACEHOLDER = '00000000-0000-0000-0000-000000000000';

/** The ATT handle this same characteristic showed up as in every capture we took. Useful only for cross-checking during discovery; react-native-ble-plx addresses characteristics by UUID, not handle. */
export const KNOWN_ATT_HANDLE = 0x0010;

/** Standard CCCD (Client Characteristic Configuration Descriptor) UUID -- not meter-specific, this is a fixed BLE spec constant. */
export const CCCD_UUID = '00002902-0000-1000-8000-00805f9b34fb';

// ---------------------------------------------------------------------------
// Commands. All commands are sent as ATT Write Command (write without
// response) to the single data characteristic. Every payload starts with
// 0x8C followed by a sub-command byte.
// ---------------------------------------------------------------------------

export const CMD_IDENTIFY = [0x8c, 0x00]; // "online" / identify -- send once after connecting
export const CMD_SET_INTEGRAL_MODE_AUTO = [0x8c, 0x02, 0x01]; // send once after connecting
export const CMD_READ_STATE = [0x8c, 0x03]; // poll during completion detection
export const CMD_READ_INTEG_TIME = [0x8c, 0x05]; // poll during completion detection
export const CMD_START_SINGLE_TEST = [0x8c, 0x0e, 0x01];
export const CMD_STOP_SAMPLING = [0x8c, 0x25];
export const CMD_READ_RESULT = [0x8c, 0x13, 0x31]; // reads stored result, does NOT start a measurement

/**
 * NEVER SEND THIS. 0x8C 0x01 (set integration time) forces the meter into
 * locked/manual exposure mode and permanently breaks auto-exposure for every
 * subsequent reading until power-cycled. Documented here only as a warning,
 * not exported for use.
 */
// export const CMD_SET_INTEGRATION_TIME_DO_NOT_USE = [0x8c, 0x01, ...];

// ---------------------------------------------------------------------------
// Completion detection tuning
// ---------------------------------------------------------------------------

/** How often to poll 8C 05 / 8C 03 while waiting for a measurement to finish. */
export const POLL_INTERVAL_MS = 150;

/** Overall give-up timeout. Good-light convergence is typically under 1s; poor lighting can legitimately take several seconds while auto-exposure hunts. 10s balances not cutting off a slow-but-real reading against not leaving the UI stuck too long. */
export const MEASUREMENT_TIMEOUT_MS = 10000;

/** Byte offset of the "test state" field within an 8C 03 reply (0-indexed from the start of the reply, i.e. right after the 8C 03 echo). 0x00 = still testing, 0x01 = test end. */
export const STATE_REPLY_TESTSTATE_OFFSET = 3;
export const STATE_TEST_END = 0x01;

// ---------------------------------------------------------------------------
// Result response field map (§5 of the protocol spec)
//
// Offsets are relative to the response BODY -- i.e. after stripping the
// 4-byte echo+length header that prefixes every 8C 13 response
// (byte 0-1: echo of 8C 13, byte 2-3: big-endian uint16 length of what
// follows). All multi-byte fields are little-endian float32 unless noted.
// ---------------------------------------------------------------------------

export const RESULT_HEADER_LENGTH = 4;

/**
 * The spectrum block's own fixed size, independent of model or firmware --
 * confirmed from the madcook1/hpcs310-ble reference tool (reverse-engineered
 * straight from the vendor Android app, not from a hex dump): the result
 * body always ends with exactly 671 float32 spectrum samples, followed by
 * an 8-byte "visible range" footer (the same StartWave/EndWave float pair
 * parseResult.ts's looksLikeRangeFooter() already detects at runtime).
 * That means where this block STARTS is always derivable from the body's
 * own length -- `body.length - SPECTRUM_BLOCK_BYTES` -- with no need to
 * know which model (or firmware revision) produced it at all, because
 * whatever varies in the metrics preamble ahead of it, this trailing block
 * never moves relative to the end of the body.
 *
 * Cross-checked against every spectrumStart this file used to hardcode per
 * model, before this constant replaced them: 310/330's old 236 == this
 * model's real body length (2928) minus 2692; 330P/310P's old 304 == 2996
 * minus 2692 (2996 is this app's own captured 310P body length, byte for
 * byte); 330Pro's old 384 == 3076 minus 2692 (3076 is the exact body
 * length its own doc comment below already recorded from a real capture).
 * All three check out exactly, which is what makes dropping the hardcoded
 * per-model constant (see FieldOffsetMap below) safe rather than a guess.
 */
export const SPECTRUM_POINT_COUNT = 671;
export const SPECTRUM_FOOTER_BYTES = 8; // StartWave + EndWave, float32 LE each
export const SPECTRUM_BLOCK_BYTES = SPECTRUM_POINT_COUNT * 4 + SPECTRUM_FOOTER_BYTES; // 2692

/**
 * A model's result-body field map. Not every model reports every field --
 * `illuminanceE` (lux) in particular is genuinely absent from the HPCS-310's
 * layout (see FIELD_OFFSETS_310 below), so it's optional here and every
 * consumer (parseResult.ts) needs to handle it being undefined.
 *
 * Deliberately has NO `spectrumStart` field -- unlike every other offset
 * here, the spectrum block's position isn't something to hardcode per
 * model at all; parseResult.ts derives it from the actual received body's
 * length via SPECTRUM_BLOCK_BYTES above, which is correct for every model
 * (and every firmware revision) without needing to special-case any of
 * them. See that constant's own comment for why this is safe.
 */
export interface FieldOffsetMap {
  deviceName: number;
  firmwareVersion: number;
  par?: number;
  illuminanceE?: number;
  cct: number;
  duv: number;
  x: number;
  y: number;
  ra: number;
  r1: number;
  r2: number;
  r3: number;
  r4: number;
  r5: number;
  r6: number;
  r7: number;
  r8: number;
  r9: number;
  r10: number;
  r11: number;
  r12: number;
  r13: number;
  r14: number;
  r15: number;
  /** TM-30 fidelity/gamut indices -- only confirmed present on the HPCS330Pro so far, hence optional. */
  tm30Rf?: number;
  tm30Rg?: number;
  integrationTimeMs: number;
  peakSignal: number;
  darkSignal: number;
  compensateLevel: number;
  timestamp: number;
  timestampLength: number;
}

/**
 * HPCS-330P field map -- the original layout this protocol was reverse-
 * engineered against (see hpcs330p-ble-protocol-spec.md), verified
 * byte-for-byte against the vendor app's own CSV export at the time.
 */
export const FIELD_OFFSETS_330P = {
  deviceName: 0, // ASCII, null-terminated at byte 9
  firmwareVersion: 10, // uint32 LE
  par: 36,
  ppfd: 40,
  ppfdUv: 44,
  ppfdB: 48,
  ppfdG: 52,
  ppfdR: 56,
  ppfdFr: 60,
  ppfdIr: 64,
  kppfv: 68,
  erbRatio: 72,
  ypfd: 76,
  echA: 80,
  echB: 84,
  dli: 88,
  cli: 92,
  illuminanceE: 96, // lux
  candleE: 100,
  cct: 104,
  duv: 108,
  x: 112,
  y: 116,
  u: 120,
  v: 124,
  uPrime: 128,
  vPrime: 132,
  sdcm: 136,
  ra: 140,
  r1: 144,
  r2: 148,
  r3: 152,
  r4: 156,
  r5: 160,
  r6: 164,
  r7: 168,
  r8: 172,
  r9: 176,
  r10: 180,
  r11: 184,
  r12: 188,
  r13: 192,
  r14: 196,
  r15: 200,
  ee: 204, // duplicate of PAR
  spRatio: 208,
  dominantWavelength: 212,
  purity: 216,
  halfWidth: 220,
  peakWavelength: 224,
  centerWavelength: 228,
  centroidWavelength: 232,
  rRatio: 236,
  gRatio: 240,
  bRatio: 244,
  // 248-264: reserved/zero (5 floats)
  integrationTimeMs: 268,
  peakSignal: 272,
  darkSignal: 276,
  compensateLevel: 280,
  // 284-303: 20-byte ASCII timestamp string from the device's own RTC
  timestamp: 284,
  timestampLength: 20,
} as const;

/**
 * HPCS-310P field map -- despite the "310" in its name, this is NOT a
 * shorter-layout model like the plain HPCS-310 below. It's byte-for-byte
 * IDENTICAL to the HPCS-330P layout above. Derived from a real captured
 * debug-log hex dump (device "HPCS-310P", firmware 2008, 2996-byte result
 * body -- same body length as a 330P capture) and confirmed three
 * independent ways against FIELD_OFFSETS_330P's offsets:
 *   - rRatio(236) + gRatio(240) + bRatio(244) = 71.565 + 23.986 + 4.448 =
 *     100.00 (an identity that only holds if those three offsets are right)
 *   - u'(128) == u(120) exactly, and v'(132) == 1.5 * v(124) exactly
 *   - integrationTimeMs(268) read 60.0, matching this same debug log's own
 *     "Integration time stable at 60000us" line word-for-word
 * CCT/Ra/Duv/peakWavelength came out close to but not identical to the
 * vendor-app screenshot reading (1941.8K vs 1972K, Ra 90.05 vs 90.9, Duv
 * -0.00633 vs -0.00601, peak 637.0 vs 639.1nm) -- the same reading-to-
 * reading noise seen on the other models, not a sign of a wrong offset;
 * the debug log shows this particular capture settled at a different
 * integration time (60ms) than whatever the screenshot's reading used.
 * Kept as its own named export (rather than just routing to
 * FIELD_OFFSETS_330P from getFieldOffsetsForDevice) so a future dump that
 * reveals a real difference between the two models has somewhere to go
 * without disturbing the 330P map.
 */
export const FIELD_OFFSETS_310P = FIELD_OFFSETS_330P;

/**
 * HPCS-310 field map -- this model's result body is noticeably shorter than
 * the 330P's: it drops most of the PAR/PPFD/photosynthesis-metric block
 * (17 fields shrink down to just 2: par, ppfd) and drops "ee" (a PAR
 * duplicate) and one of the 5 reserved/unused floats later on. Every offset
 * below was derived by hand from a real captured hex dump on 2026-09-26,
 * cross-checked against: the vendor app's reference reading (CCT 4010K,
 * peakWavelength 450.6nm matched almost exactly), internal identities that
 * must hold regardless of reading (u' == u, v' == 1.5*v, rRatio+gRatio+
 * bRatio == 100), and this app's own debug log from the same session
 * (integrationTimeMs 0.333ms matched "Integration time stable at 333us",
 * and the ASCII timestamp bytes decoded to a plausible date/time string).
 *
 * Notably, illuminanceE (lux) is NOT present in this layout at all -- the
 * 310 simply doesn't report it the way the 330P does. That's the root
 * cause of the original "CCT/Lux wrong on the 310" bug: the old single
 * fixed-offset map was reading both from the wrong bytes entirely, because
 * everything past the shrunk preamble is shifted relative to the 330P.
 * Checked directly (2026-10-01): offsets 184 and 188 on this capture parse
 * to 432507 and 394624 -- wildly implausible as a lux reading (indoor/
 * outdoor light rarely exceeds a few thousand lux), confirming this is
 * genuinely unused/reserved space on this model rather than a real but
 * untested lux field this app is just failing to show.
 */
export const FIELD_OFFSETS_310 = {
  deviceName: 0,
  firmwareVersion: 10,
  par: 36,
  // ppfd: 40 (present but unused by this app)
  cct: 44,
  duv: 48,
  x: 52,
  y: 56,
  // u: 60, v: 64, uPrime: 68, vPrime: 72 (present but unused by this app)
  // sdcm: 76 (present but unused by this app)
  ra: 80,
  r1: 84,
  r2: 88,
  r3: 92,
  r4: 96,
  r5: 100,
  r6: 104,
  r7: 108,
  r8: 112,
  r9: 116,
  r10: 120,
  r11: 124,
  r12: 128,
  r13: 132,
  r14: 136,
  r15: 140,
  // no "ee" field on this model (spRatio follows r15 directly)
  // spRatio: 144, dominantWavelength: 148, purity: 152, halfWidth: 156 (present but unused)
  // peakWavelength: 160, centerWavelength: 164, centroidWavelength: 168 (present but unused)
  // rRatio: 172, gRatio: 176, bRatio: 180 (present but unused -- confirmed summing to ~100)
  // 184-196: reserved (4 floats here, one fewer than the 330P's 5)
  integrationTimeMs: 200,
  peakSignal: 204,
  darkSignal: 208,
  compensateLevel: 212,
  timestamp: 216,
  timestampLength: 20,
  // illuminanceE intentionally omitted -- not present in this model's layout
} as const;

/**
 * HPCS-310 field map for OLDER firmware (iVer <= 2005). NOT yet verified
 * against a real capture -- every HPCS-310/330 dump seen so far (2026-09-26
 * and 2026-09-27) matched FIELD_OFFSETS_310 above, which this session's
 * cross-check against the madcook1/hpcs310-ble reference tool (reverse-
 * engineered from the vendor Android app's own decompiled logic, not a hex
 * dump) confirms corresponds to that tool's ">2005" firmware branch. That
 * same tool's source shows the app inserts 4 extra metric fields (fEML,
 * fEeml, fEmlRatio, fEDI_lx) for firmware > 2005, which don't exist on
 * firmware <= 2005 -- shifting everything from integrationTimeMs onward 16
 * bytes earlier than FIELD_OFFSETS_310. cct/duv/x/y/ra/r1-r15 (and
 * par/illuminanceE, wherever they turn out to really live -- see the open
 * question on FIELD_OFFSETS_310/330's own lux offset) are all BEFORE that
 * insertion point, so none of them need a legacy variant here; only the
 * fields below do. Exists so getFieldOffsetsForDevice can route to it once
 * a real iVer <= 2005 debug-log capture confirms this split actually
 * happens in practice -- until then, getFieldOffsetsForDevice only reaches
 * this via an explicit firmware check, never by default.
 */
export const FIELD_OFFSETS_310_LEGACY = {
  ...FIELD_OFFSETS_310,
  integrationTimeMs: 184,
  peakSignal: 188,
  darkSignal: 192,
  compensateLevel: 196,
  timestamp: 200,
} as const;

/**
 * HPCS-330 field map ("HPCS-330-2515818" -- note: no trailing "P" in the
 * advertised name) -- derived from a real captured hex dump on
 * 2026-09-27. Turns out this model's layout is byte-for-byte IDENTICAL to
 * the HPCS-310's (cct:44, duv:48, ra:80, r1-r15 at 84-140,
 * integrationTimeMs:200, peakSignal:204, darkSignal:208, timestamp:216,
 * spectrumStart:236 -- all confirmed again here), with exactly one
 * addition: this model DOES report illuminanceE (lux), at offset 188,
 * which the 310 doesn't have a working slot for at all.
 *
 * This strongly suggests FIELD_OFFSETS_310's layout is really the shared
 * "HPCS-330 family" layout (310 and plain 330 alike), and the long-standing
 * FIELD_OFFSETS_330P default below -- never verified against a real dump,
 * only assumed from old ESP32-era documentation -- describes something
 * else (maybe a "-330P" with the trailing P, if that's actually a distinct
 * model/firmware; unconfirmed either way). Kept as two separate maps rather
 * than merging them, since nothing has actually verified they're the same
 * thing yet.
 *
 * Verified against the vendor screenshot's reference reading (CCT 3345K,
 * Duv -0.00585, Ra 94.2, R9 96, R12 83, peak wavelength 632nm -- all match
 * to within a fraction of a percent) and the same internal identities used
 * for 310/330Pro (u'==u, v'==1.5*v hold exactly; the ASCII timestamp at 216
 * decodes to "2026-09-26"/"17:51:33"). illuminanceE (1651.7 parsed vs.
 * 1686.34 reference, ~2% off) and peakSignal/darkSignal show the same
 * modest noise seen on Peak/Dark for the other models -- these are raw
 * intensity counts, more sensitive to light-source flicker/timing jitter
 * than the self-normalizing colorimetric ratios (CCT/Ra/etc.), which is
 * consistent with genuine reading-to-reading noise rather than a wrong
 * offset.
 *
 * LUX QUESTION RESOLVED (2026-10-01): the madcook1/hpcs310-ble reference
 * decoder's decompiled logic had raised offset 36 (labeled `par` below) as
 * a possible alternate home for illuminanceE. A fresh debug-log capture of
 * this exact same reading (re-sent by the user) let this get checked
 * directly for the first time: offset 36 parses to 2527.18, nowhere near
 * the screenshot's E(lx) 1686.34 -- not even the same order of magnitude,
 * let alone within noise. Offset 188's 1651.7 (~2% off) is the only
 * plausible candidate of the two, consistent with the same reading-to-
 * reading noise already seen on peakSignal/darkSignal. illuminanceE:188
 * stands confirmed; offset 36 is something else (unidentified -- possibly
 * a PAR/PPFD-family metric given its scale, but not verified against the
 * vendor app's own PAR-mode reading, so still just a guess).
 */
export const FIELD_OFFSETS_330 = {
  deviceName: 0,
  firmwareVersion: 10,
  // par: 36 (present but unverified/unused by this app -- confirmed NOT to be lux, see above)
  cct: 44,
  duv: 48,
  x: 52,
  y: 56,
  // u: 60, v: 64, uPrime: 68, vPrime: 72 (present but unused -- confirmed u'=u, v'=1.5v)
  ra: 80,
  r1: 84,
  r2: 88,
  r3: 92,
  r4: 96,
  r5: 100,
  r6: 104,
  r7: 108,
  r8: 112,
  r9: 116,
  r10: 120,
  r11: 124,
  r12: 128,
  r13: 132,
  r14: 136,
  r15: 140,
  // spRatio:144, dominantWavelength:148, purity:152, halfWidth:156 (present but unused)
  // peakWavelength:160 (confirmed -- matched screenshot's "632nm" exactly)
  // centerWavelength:164, centroidWavelength:168, rRatio:172, gRatio:176, bRatio:180 (present but unused)
  // 184: reserved
  illuminanceE: 188, // lux
  integrationTimeMs: 200,
  peakSignal: 204,
  darkSignal: 208,
  compensateLevel: 212,
  timestamp: 216,
  timestampLength: 20,
} as const;

/**
 * HPCS-330 field map for OLDER firmware (iVer <= 2005) -- same reasoning
 * and same caveat as FIELD_OFFSETS_310_LEGACY above (not yet verified
 * against a real capture; both HPCS-330 dumps seen so far were on firmware
 * matching the modern/">2005" branch).
 *
 * `illuminanceE` is deliberately OMITTED here rather than left at 188 (its
 * offset in FIELD_OFFSETS_330): shifting the tail fields 16 bytes earlier
 * for this firmware branch would put `peakSignal` at that same offset 188,
 * and guessing a different slot for illuminanceE instead would be exactly
 * the kind of unverified lux change this session agreed to hold off on.
 * Note this is a DIFFERENT open question from the modern-firmware one
 * resolved 2026-10-01 (see FIELD_OFFSETS_330's own comment) -- that one
 * confirmed offset 188 is right for firmware > 2005; this one is about
 * where lux would live on firmware <= 2005 instead, which still has no
 * real capture to check against. Better to report lux as unavailable on
 * this branch than silently collide with -- or misreport -- peakSignal.
 */
export const FIELD_OFFSETS_330_LEGACY = {
  ...FIELD_OFFSETS_330,
  illuminanceE: undefined,
  integrationTimeMs: 184,
  peakSignal: 188,
  darkSignal: 192,
  compensateLevel: 196,
  timestamp: 200,
} as const;

/**
 * HPCS330Pro field map -- yet another distinct layout, derived from a real
 * captured hex dump on 2026-09-27 (device advertised as "HPCS330Pro-0626183",
 * firmware 2008, 3076-byte result body). This model's preamble matches the
 * HPCS-310's almost exactly (par:36, cct:44, duv:48, x:52, y:56 -- same
 * offsets), but then diverges: it inserts FOUR extra floats between y and
 * ra -- a second (10-degree observer?) chromaticity pair at 60/64, then u/v
 * (CIE1960) at 68/72, then u'/v' (CIE1976) at 76/80 -- pushing ra/r1-r15
 * eight bytes later than the 310's. It also reports TM-30 Rf/Rg (tm30Rf/
 * tm30Rg), which neither the 330P nor 310 layouts have a slot for at all --
 * this looks like the first model in the lineup with a full TM-30 block, not
 * just CRI Ra/R9.
 *
 * Verified against the vendor app's own reference reading (CCT 3324K, Duv
 * -0.00671, Ra 94.3, TM-30 Rf 93.97, TM-30 Rg 100.47) and internal
 * identities: u' == u and v' == 1.5*v hold exactly (68/72 vs 76/80),
 * integrationTimeMs (348) matches this app's own debug log ("Integration
 * time stable at 57000us" -> 57.0ms, the value the meter actually settled
 * on for this capture -- the screenshot's 69ms was a different capture, at
 * a different integration time, hence the reference CCT/Ra/etc. being close
 * but not identical to this dump's own values, same noise pattern as the
 * 310), and the ASCII timestamp at 364 decodes to a plausible date/time
 * ("2026-09-26" / "17:38:56").
 *
 * par/illuminanceE are left unset here: offset 36 holds a plausible-looking
 * float but nothing in the vendor UI for this model surfaces a PAR or lux
 * figure to check it against, so it's left unmapped rather than guessed --
 * this app doesn't display PAR anyway (removed earlier in favor of R9/Duv).
 */
export const FIELD_OFFSETS_330PRO = {
  deviceName: 0,
  firmwareVersion: 10,
  // par: 36 (present but unverified/unused by this app)
  cct: 44,
  duv: 48,
  x: 52,
  y: 56,
  // x10/y10: 60, 64 (present but unused by this app)
  // u: 68, v: 72, uPrime: 76, vPrime: 80 (present but unused -- confirmed u'=u, v'=1.5v)
  ra: 88,
  r1: 92,
  r2: 96,
  r3: 100,
  r4: 104,
  r5: 108,
  r6: 112,
  r7: 116,
  r8: 120,
  r9: 124,
  r10: 128,
  r11: 132,
  r12: 136,
  r13: 140,
  r14: 144,
  r15: 148,
  tm30Rf: 232,
  tm30Rg: 236,
  integrationTimeMs: 348,
  peakSignal: 352,
  darkSignal: 356,
  compensateLevel: 360,
  timestamp: 364,
  timestampLength: 20,
  // illuminanceE intentionally omitted -- no reference value to confirm a slot for it
} as const;

/**
 * Picks the right field map for a connected device's advertised name.
 *
 * IMPORTANT bug fixed 2026-09-27: "HPCS-330P-0635249" -- a real device, not
 * a hypothetical -- was matching the plain "330" check below and getting
 * FIELD_OFFSETS_330 (the map derived from a device literally named
 * "HPCS-330", no P), because "330P" contains "330" as a substring. That
 * produced badly wrong readings (right ballpark, wrong values) even though
 * the meter itself was working fine -- the vendor app, reading the SAME
 * device, showed correct numbers the whole time. So "330P" now has to be
 * checked explicitly, before the bare "330" check, or it'll never be
 * reached.
 *
 * This also resolves a long-standing open question: FIELD_OFFSETS_330P
 * was originally documented (before this session) as "the original layout
 * this protocol was reverse-engineered against... verified byte-for-byte
 * against the vendor app's own CSV export" -- but nothing in this session
 * had re-confirmed that against a real hex dump, so it'd been getting
 * called "unverified" in more recent comments here. Now that a real
 * "HPCS-330P-0635249" device has actually been seen, matched, and correctly
 * fixed the "way off" readings by routing here instead of FIELD_OFFSETS_330,
 * that original verification claim is corroborated -- "330P" (with the
 * trailing P) really is its own distinct, legitimate device naming pattern,
 * not just a leftover guess.
 *
 * Check order matters throughout: "330PRO" has to be checked before "330P"
 * (which is itself a substring of "330PRO"), and both have to be checked
 * before the bare "330" check, or a more specific model always loses to a
 * less specific one that happens to overlap it as a substring. Same reason
 * "310P" is checked before the bare "310" below -- otherwise an HPCS-310P
 * would match "310" first and silently get the wrong (shorter, 310-family)
 * layout, the exact bug this once was: a real "HPCS-310P" debug-log capture
 * decoded against FIELD_OFFSETS_310 produced nonsense (cct 0.068, duv 2.92).
 *
 * `firmwareVersion` only changes anything for the bare 310/330 branches --
 * see FIELD_OFFSETS_310_LEGACY/FIELD_OFFSETS_330_LEGACY's own comments for
 * where this split comes from (the madcook1/hpcs310-ble reference tool's
 * decompiled app logic, not yet independently verified against a real
 * iVer <= 2005 capture). It's optional and defaults to the modern/">2005"
 * maps when omitted or unknown, since every capture seen so far has been on
 * that branch -- callers that don't have a firmware reading yet (or can't
 * get one before they need an offset map at all) keep today's behavior
 * unchanged.
 */
export const LEGACY_FIRMWARE_CUTOFF = 2005;

export function getFieldOffsetsForDevice(
  deviceName: string | null | undefined,
  firmwareVersion?: number
): FieldOffsetMap {
  const upper = deviceName?.toUpperCase() ?? '';
  const isLegacyFirmware = firmwareVersion !== undefined && firmwareVersion <= LEGACY_FIRMWARE_CUTOFF;
  if (upper.includes('330PRO') || upper.includes('330 PRO')) {
    return FIELD_OFFSETS_330PRO;
  }
  if (upper.includes('330P')) {
    return FIELD_OFFSETS_330P;
  }
  if (upper.includes('310P')) {
    return FIELD_OFFSETS_310P;
  }
  if (upper.includes('310')) {
    return isLegacyFirmware ? FIELD_OFFSETS_310_LEGACY : FIELD_OFFSETS_310;
  }
  if (upper.includes('330')) {
    return isLegacyFirmware ? FIELD_OFFSETS_330_LEGACY : FIELD_OFFSETS_330;
  }
  // Genuinely unrecognized name -- fall back to the 330P map as the best
  // guess, since it's the most-established/longest-verified layout.
  return FIELD_OFFSETS_330P;
}

/**
 * FALLBACK ONLY as of 2026-09-27. It turns out the device's response DOES
 * report its own configured wavelength start directly after all -- see the
 * "visible range" footer parseResult.ts now reads (the last two floats in
 * the body, e.g. 380.0/780.0 or 350.0/800.0 depending on model/firmware
 * state). That footer is per-reading, per-device ground truth and is used
 * in preference to this constant whenever it's present -- which has been
 * every real dump seen so far. This constant now only matters for a
 * model/firmware state that turns out not to report that footer at all, in
 * which case the value below is the best guess, for the reasons laid out
 * in the rest of this comment (now describing a fallback, not the primary
 * source it used to be).
 *
 * This had been assumed as 340nm, which turned out to be measurably wrong: cross-
 * checked on 2026-09-27 against a real HPCS-330P reading's OWN self-reported
 * peakWavelength field (offset 224 in FIELD_OFFSETS_330P -- 639.1nm, already
 * confirmed against that reading's vendor-app screenshot). Finding that same
 * reading's actual spectral peak by index and labeling it under the old
 * 340nm/1nm-per-point assumption gives 629nm -- 10nm off. Labeling it from
 * 350nm instead lines up with the device's own reported 639.1nm almost
 * exactly, and 350nm also matches where the vendor app's own spectrum chart
 * axis starts (see the 330P vendor screenshot: "350 377 404... 800").
 *
 * This matters well past just the on-screen chart: buildCsv.ts uploads each
 * spectrum point to hCRI.io as (wavelength, value) and hCRI.io recomputes
 * every colorimetric number itself from that -- so a wrong start wavelength
 * here silently shifted every CCT/Ra/etc. hCRI.io calculated from an upload,
 * even though the raw intensity VALUES were always read correctly.
 *
 * IMPORTANT CAVEAT: this 10nm correction is only independently confirmed for
 * the ~449-451-point capture case (this HPCS-330P reading had 449 nonzero
 * points). The other observed case -- a wider ~673-674-point capture, seen
 * on the HPCS-310/plain-330/330Pro models -- has NOT been independently
 * re-verified against any of those models' own self-reported reference
 * wavelength, because none of their currently-mapped fields expose one to
 * check against. It's applied uniformly here on the assumption that 350nm is
 * the instrument's one true start point regardless of how many points get
 * captured (a plausible, but not yet proven, reading of the two observed
 * point-counts), rather than two genuinely different start wavelengths. If
 * you get a narrow-band reference light source and a debug-log spectrum
 * dump from a 673-674-point model, comparing its true peak position the same
 * way would settle this for good.
 */
export const ASSUMED_START_WAVELENGTH_NM = 350;
