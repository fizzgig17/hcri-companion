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
 * The meter advertises a name starting with this prefix, e.g.
 * "HPCS-330P-0635249" (it appends a per-unit serial number). Always match on
 * prefix, never exact string.
 */
export const METER_NAME_PREFIX = 'HPCS-330P';

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

/** Overall give-up timeout. 20s was confirmed safely long even in poor lighting; good-light convergence is typically under 1s. */
export const MEASUREMENT_TIMEOUT_MS = 20000;

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

export const FIELD_OFFSETS = {
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
  spectrumStart: 304, // float32 array, one value per nm, to end of body
} as const;

/**
 * The device's response never reports its own configured wavelength start.
 * Two ranges were observed in practice (350-800nm / 451 points, and a wider
 * range / 673-674 points) but neither is encoded in the response -- it's a
 * device-side setting with no readback. Use this as a labeling default
 * unless/until a way to read the real configured range is found.
 */
export const ASSUMED_START_WAVELENGTH_NM = 340;
