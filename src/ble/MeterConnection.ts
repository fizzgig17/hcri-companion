// src/ble/MeterConnection.ts
//
// Owns the actual BLE connection to one HPCS-330P meter: scanning, connecting,
// discovery (including the one-time UUID-logging step -- see protocol.ts for
// why that's needed), subscribing to notifications, reassembling fragmented
// responses, and sending commands. Nothing in here knows about the
// measurement-completion algorithm (that's takeMeasurement.ts) or about
// hCRI.io (that's in ../hcri/).
//
// Requires: react-native-ble-plx (already installed in this project).

import { BleManager, Device, Characteristic, Subscription } from 'react-native-ble-plx';
import { Buffer } from 'buffer';
import { PermissionsAndroid, Platform } from 'react-native';
import {
  METER_NAME_PREFIXES,
  METER_SERVICE_UUID_PLACEHOLDER,
  METER_CHARACTERISTIC_UUID_PLACEHOLDER,
  RESULT_HEADER_LENGTH,
} from './protocol';
import {
  saveLastDeviceId,
  loadLastDeviceId,
  saveLastServiceUuid,
  loadLastServiceUuid,
} from '../storage/secureStorage';

// Likely the REAL reason the previous fix (resetStaleConnection, persisting
// a device ID / service UUID and calling cancelDeviceConnection from a NEW
// manager) still didn't help on its own, per the 2026-09-28 report of still
// needing a power cycle after every reload: `new BleManager()` doesn't just
// reset this class's own JS-side state -- react-native-ble-plx creates a
// genuinely separate native "client" for every BleManager() call, each with
// its OWN connection tracking. A connection opened by an OLD client (the
// one that existed before a reload, then got abandoned when that JS context
// was torn down without ever calling disconnect()/destroy() on it) is
// invisible to and uncancelable by a NEW client -- even one running in the
// very same app process a moment later. resetStaleConnection() was asking
// the new manager to cancel a connection the new manager has no way to
// reach, which is consistent with it having no effect.
//
// The actual fix has to stop a second native client from ever being
// created in the first place: keep exactly ONE BleManager for the whole
// app's lifetime by stashing it on `global` rather than `new`-ing a fresh
// one every time this class is constructed. IMPORTANT scope limit: this
// only helps across a reload that keeps the same JS engine alive underneath
// (e.g. Metro's Fast Refresh, or the dev-menu "Reload") -- `global` itself
// gets recreated by a genuinely fresh app process (a full rebuild/reinstall,
// or the app being killed and relaunched), so this can't do anything about
// that case; whether it actually helps depends on which kind of "push new
// code" is happening. See the caption on this file for what to check next
// if it doesn't.
declare global {
  // eslint-disable-next-line no-var
  var __hcriBleManagerSingleton: BleManager | undefined;
}

function getSharedBleManager(): BleManager {
  if (!global.__hcriBleManagerSingleton) {
    global.__hcriBleManagerSingleton = new BleManager();
  }
  return global.__hcriBleManagerSingleton;
}

/** True if the advertised name matches any known meter model prefix (see protocol.ts's METER_NAME_PREFIXES for why this is a list, not one hardcoded string). */
function matchesKnownMeter(name: string | null | undefined): boolean {
  if (!name) return false;
  return METER_NAME_PREFIXES.some((prefix) => name.startsWith(prefix));
}

/** Space-separated hex, e.g. "8c 05 a0 0f 00 00 01" -- for wire-level traffic logging only, doesn't affect any parsing/control-flow decision. */
function toHex(bytes: number[] | Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join(' ');
}

/**
 * Declaring BLUETOOTH_SCAN/BLUETOOTH_CONNECT in AndroidManifest.xml only
 * lets the app ask for these -- Android 12+ (API 31+) treats them as
 * dangerous runtime permissions that must also be requested at runtime, or
 * every BLE call fails with "device is not authorized to use BluetoothLE"
 * regardless of what's in the manifest. Older Android versions (< 12) use
 * ACCESS_FINE_LOCATION as the gate for BLE scanning instead, so request that
 * as a fallback.
 */
async function requestBlePermissions(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;

  if (Platform.Version >= 31) {
    const granted = await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
    ]);
    return (
      granted[PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN] === PermissionsAndroid.RESULTS.GRANTED &&
      granted[PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT] === PermissionsAndroid.RESULTS.GRANTED
    );
  }

  const granted = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
  );
  return granted === PermissionsAndroid.RESULTS.GRANTED;
}

export type LogFn = (msg: string) => void;

/** A single reassembled notification, already stripped of the 4-byte echo+length header when it's a length-prefixed (8C 13) response. Short replies (8C 03 / 8C 05 / 8C 00) are passed through whole, unstripped -- there's no header to strip. */
export interface MeterMessage {
  /** The first byte after 0x8C -- i.e. which command this is a reply to. */
  subCommand: number;
  /** Raw bytes of this message body (header-stripped for 8C 13 replies). */
  body: Uint8Array;
}

export class MeterConnection {
  private manager: BleManager;
  private device: Device | null = null;
  private characteristic: Characteristic | null = null;
  private notifySubscription: Subscription | null = null;
  private siblingCandidates: Characteristic[] = [];
  private siblingSubscriptions: Subscription[] = [];
  private log: LogFn;
  private onDisconnectedCallback: () => void;
  private disconnectSubscription: Subscription | null = null;

  // Reassembly state for the length-prefixed 8C 13 response.
  private collecting = false;
  private declaredBodyLength = 0;
  private buffer: number[] = [];

  private messageListeners: ((msg: MeterMessage) => void)[] = [];

  /**
   * Once found (via discovery, or once you've hardcoded the real values in
   * protocol.ts), these hold the UUIDs actually in use for this session.
   * Exposed so the app can display "found service UUID: ..." during the
   * one-time discovery step.
   */
  public serviceUuid: string = METER_SERVICE_UUID_PLACEHOLDER;
  public characteristicUuid: string = METER_CHARACTERISTIC_UUID_PLACEHOLDER;

  constructor(log: LogFn = () => {}, onDisconnected: () => void = () => {}) {
    // See the big comment above getSharedBleManager() for why this is a
    // shared singleton now, not `new BleManager()` -- creating a fresh
    // native client here every time was the actual reason a reload while
    // connected required a power cycle, not something resetStaleConnection()
    // could ever have fixed by itself.
    this.manager = getSharedBleManager();
    this.log = log;
    this.onDisconnectedCallback = onDisconnected;
  }

  /** Registers a listener for every reassembled message. Returns an unsubscribe function -- call it once you're done (e.g. after a single measurement resolves) so listeners don't pile up across repeated measurements. */
  onMessage(listener: (msg: MeterMessage) => void): () => void {
    this.messageListeners.push(listener);
    return () => {
      this.messageListeners = this.messageListeners.filter((l) => l !== listener);
    };
  }

  /** Scans for a device whose name matches any known meter model prefix and connects to it. Resolves with the connected Device. */
  async scanAndConnect(timeoutMs = 15000): Promise<Device> {
    const authorized = await requestBlePermissions();
    if (!authorized) {
      throw new Error(
        'Bluetooth permission was denied. Enable "Nearby devices" (and Location, on older Android) for this app in Settings.'
      );
    }

    this.log(`Scanning for known meter models (${METER_NAME_PREFIXES.join(', ')})...`);

    const found = await new Promise<Device>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.manager.stopDeviceScan();
        reject(new Error('Scan timed out -- meter not found'));
      }, timeoutMs);

      this.manager.startDeviceScan(null, { allowDuplicates: false }, (error, device) => {
        if (error) {
          clearTimeout(timeout);
          this.manager.stopDeviceScan();
          reject(error);
          return;
        }
        if (matchesKnownMeter(device?.name)) {
          clearTimeout(timeout);
          this.manager.stopDeviceScan();
          this.log(`Found ${device!.name} (${device!.id})`);
          resolve(device!);
        }
      });
    });

    this.log('Connecting...');
    const device = await found.connect();
    return this.finishConnecting(device);
  }

  /**
   * Connects directly to a device you already have the ID for -- e.g. one
   * picked from the "Scan for Nearby Meters" list -- skipping the
   * scan-and-match-by-name step entirely. Useful when you already know
   * which device you want (and lets you connect to a meter whose name
   * doesn't happen to match METER_NAME_PREFIXES, too).
   */
  async connectToDevice(deviceId: string): Promise<Device> {
    const authorized = await requestBlePermissions();
    if (!authorized) {
      throw new Error(
        'Bluetooth permission was denied. Enable "Nearby devices" (and Location, on older Android) for this app in Settings.'
      );
    }

    // A scan may still be running (e.g. the "Scan for Nearby Meters" list
    // is open) -- stop it before connecting, since some Android BLE stacks
    // get flaky about connecting while a scan is still active.
    this.manager.stopDeviceScan();

    this.log(`Connecting to ${deviceId}...`);
    const device = await this.manager.connectToDevice(deviceId);
    return this.finishConnecting(device);
  }

  /** Shared post-connect setup: service/characteristic discovery, MTU request, subscribing, and wiring the disconnect listener. Used by both scanAndConnect and connectToDevice. */
  private async finishConnecting(found: Device): Promise<Device> {
    this.log('Discovering services...');
    let connected = await found.discoverAllServicesAndCharacteristics();

    // Android's default MTU (23 bytes) causes excessive fragmentation --
    // request a larger one to match what the vendor app uses. Harmless
    // no-op on iOS, which negotiates MTU automatically.
    try {
      connected = await connected.requestMTU(247);
    } catch (e) {
      this.log(`requestMTU failed (continuing anyway): ${e}`);
    }

    this.device = connected;
    // Fire-and-forget: persisted so a FUTURE MeterConnection instance (e.g.
    // after an app/JS reload) can find and clear this exact connection via
    // resetStaleConnection() below, even though it has no memory of this
    // one ever having existed. Not fatal if it fails (Keychain unavailable,
    // etc.) -- it only degrades resetStaleConnection() back to a no-op.
    saveLastDeviceId(connected.id).catch((e) => this.log(`Failed to persist last device id: ${e}`));
    await this.discoverAndPickCharacteristic(connected);
    // Same reasoning as saveLastDeviceId above, but for the SERVICE (rather
    // than one specific device) -- see resetStaleConnection() below for why
    // this is what lets it clear ANY currently-connected meter-like device
    // on next launch, not just this exact one.
    saveLastServiceUuid(this.serviceUuid).catch((e) => this.log(`Failed to persist last service uuid: ${e}`));
    await this.subscribe();

    // Notice when the meter actually drops the link (powered off, walked
    // out of range, etc.) so the app can reflect that instead of showing
    // "Connected" forever after the fact. Replaces any listener from a
    // previous connection attempt on this same MeterConnection instance.
    this.disconnectSubscription?.remove();
    this.disconnectSubscription = connected.onDisconnected((error) => {
      this.log(`Meter disconnected${error ? `: ${error.message}` : ''}`);
      this.device = null;
      this.characteristic = null;
      this.notifySubscription = null;
      this.siblingSubscriptions.forEach((s) => s.remove());
      this.siblingSubscriptions = [];
      this.onDisconnectedCallback();
    });

    return connected;
  }

  /**
   * One-time discovery/logging step. Logs every service + characteristic
   * UUID the device exposes, along with its properties (write/notify/etc),
   * then picks the one that looks like the data channel: writable AND
   * notifying. This is how you find the real UUIDs to hardcode in
   * protocol.ts -- read the logs after your first successful connection.
   *
   * If METER_SERVICE_UUID_PLACEHOLDER / METER_CHARACTERISTIC_UUID_PLACEHOLDER
   * have already been replaced with real values in protocol.ts, this still
   * runs (cheap) but prefers the hardcoded UUID if it's actually present,
   * falling back to auto-detection only if it isn't found -- e.g. if a
   * firmware update ever changes it.
   */
  private async discoverAndPickCharacteristic(device: Device): Promise<void> {
    const services = await device.services();
    let candidate: Characteristic | null = null;
    let hardcodedMatch: Characteristic | null = null;
    // Every OTHER write+notify characteristic found alongside the chosen
    // one -- see the comment in subscribe() below for why these get
    // monitored too (purely for diagnostic logging, not fed into
    // handleNotification/the reassembly state machine at all).
    this.siblingCandidates = [];

    for (const service of services) {
      const chars = await service.characteristics();
      for (const c of chars) {
        const props = [
          c.isWritableWithResponse || c.isWritableWithoutResponse ? 'write' : null,
          c.isNotifiable ? 'notify' : null,
          c.isReadable ? 'read' : null,
        ]
          .filter(Boolean)
          .join('+');
        this.log(`  service ${service.uuid} / char ${c.uuid} [${props}]`);

        if (
          service.uuid.toLowerCase() === this.serviceUuid.toLowerCase() &&
          c.uuid.toLowerCase() === this.characteristicUuid.toLowerCase()
        ) {
          hardcodedMatch = c;
        }

        const writable = c.isWritableWithResponse || c.isWritableWithoutResponse;
        if (writable && c.isNotifiable) {
          if (!candidate) {
            candidate = c;
          } else {
            this.siblingCandidates.push(c);
          }
        }
      }
    }

    const chosen = hardcodedMatch ?? candidate;
    if (!chosen) {
      throw new Error(
        'Could not find a write+notify characteristic on this device. Check the logged service/characteristic list above.'
      );
    }
    if (!hardcodedMatch) {
      this.log(
        `NOTE: hardcoded UUID not found on this device -- auto-detected ${chosen.serviceUUID} / ${chosen.uuid} instead. ` +
          `If this is expected (first run, or a different firmware), copy these into protocol.ts.`
      );
    }
    // hardcodedMatch, if set, was never added to siblingCandidates in the
    // loop above (it's found by UUID match, not by the candidate-picking
    // logic) -- nothing to do there, but worth noting `candidate` itself
    // could end up equal to `chosen` (the common case) or be a genuinely
    // different characteristic than hardcodedMatch; either way it was
    // already excluded from siblingCandidates by the `if (!candidate)`
    // check, so siblingCandidates never double-lists whatever `chosen`
    // ends up being.
    this.siblingCandidates = this.siblingCandidates.filter(
      (c) => c.uuid.toLowerCase() !== chosen.uuid.toLowerCase()
    );

    this.characteristic = chosen;
    this.serviceUuid = chosen.serviceUUID;
    this.characteristicUuid = chosen.uuid;
  }

  private async subscribe(): Promise<void> {
    if (!this.device || !this.characteristic) throw new Error('Not connected');

    this.notifySubscription = this.characteristic.monitor((error, char) => {
      if (error) {
        this.log(`Notification error: ${error.message}`);
        return;
      }
      if (!char?.value) return;
      const bytes = Buffer.from(char.value, 'base64');
      const arr = new Uint8Array(bytes);
      // Pure traffic logging -- every raw notification, exactly as it
      // arrived off the radio, before handleNotification below does
      // anything with it (reassembly, or deciding it's a short reply).
      // Deliberately just a log() call: it reads arr but doesn't touch any
      // state this class or takeMeasurement.ts's completion-detection
      // logic uses, so there's nothing here that can change behavior --
      // only what shows up in the Logs tab. This is the one thing the
      // higher-level "Confirmed test end" / "Integration time stable"
      // logs can never show: whether the meter is replying AT ALL, and
      // with what actual bytes, independent of whatever this app's own
      // parsing thinks those bytes mean.
      this.log(`<- notify [${this.characteristicUuid.slice(4, 8)}] (${arr.length}B): ${toHex(arr)}`);
      this.handleNotification(arr);
    });

    // Diagnostic only: this device advertised MORE than one write+notify
    // characteristic under the same service (e.g. ffe1/ffe2/ffe3 all at
    // once) -- everything above only ever writes to and listens on
    // whichever ONE got picked as `this.characteristic`. If this firmware
    // actually splits traffic across those siblings (state/config replies
    // on a different one than spectrum data, say), a reply this app is
    // waiting for could be arriving the whole time on a characteristic
    // nothing is listening to. Subscribing here too -- logging only,
    // never calling handleNotification -- is a safe way to find out: it
    // can only ever ADD log lines, never change what the real data path
    // does with anything.
    this.siblingSubscriptions.forEach((s) => s.remove());
    this.siblingSubscriptions = this.siblingCandidates.map((c) =>
      c.monitor((error, char) => {
        if (error) return; // expected/noisy on some stacks for an unused characteristic -- not worth logging
        if (!char?.value) return;
        const bytes = Buffer.from(char.value, 'base64');
        const arr = new Uint8Array(bytes);
        this.log(`<- notify [${c.uuid.slice(4, 8)}] (SIBLING, not used by app) (${arr.length}B): ${toHex(arr)}`);
      })
    );
  }

  /**
   * Reassembles fragmented notifications. Short replies (8C 03, 8C 05, 8C 00)
   * arrive whole in a single notification -- no framing. The 8C 13 result
   * response is length-prefixed (4-byte header: echo of 8C 13 + big-endian
   * uint16 body length) and fragments across many notifications; buffer
   * until the declared length is reached, then strip the header and emit
   * the body.
   */
  private handleNotification(chunk: Uint8Array): void {
    if (!this.collecting) {
      // Is this the start of a new 8C 13 (length-prefixed) response?
      if (chunk.length >= 4 && chunk[0] === 0x8c && chunk[1] === 0x13) {
        this.declaredBodyLength = (chunk[2] << 8) | chunk[3];
        this.buffer = Array.from(chunk);
        this.collecting = true;
        this.maybeEmitCollected();
        return;
      }

      // Otherwise it's a short, unframed reply -- emit immediately.
      if (chunk.length >= 2 && chunk[0] === 0x8c) {
        this.messageListeners.forEach((l) => l({ subCommand: chunk[1], body: chunk }));
      }
      return;
    }

    // Mid-reassembly: append and check.
    this.buffer.push(...Array.from(chunk));
    this.maybeEmitCollected();
  }

  private maybeEmitCollected(): void {
    const totalExpected = RESULT_HEADER_LENGTH + this.declaredBodyLength;
    if (this.buffer.length < totalExpected) return;

    const full = Uint8Array.from(this.buffer.slice(0, totalExpected));
    const body = full.slice(RESULT_HEADER_LENGTH); // strip the 4-byte echo+length header
    this.messageListeners.forEach((l) => l({ subCommand: full[1], body }));

    this.collecting = false;
    this.buffer = [];
    this.declaredBodyLength = 0;
  }

  /** Resets reassembly state. Call this at the start of every measurement, defensively -- a stray in-flight response from previous churn should never bleed into the next measurement's parsing. */
  resetReassemblyState(): void {
    this.collecting = false;
    this.buffer = [];
    this.declaredBodyLength = 0;
  }

  async sendCommand(bytes: number[]): Promise<void> {
    if (!this.characteristic) throw new Error('Not connected');
    const base64 = Buffer.from(bytes).toString('base64');
    // Same reasoning as the notify-side log in subscribe() above: pure
    // logging, no effect on control flow. Pairing "-> write" with "<-
    // notify" in the Logs tab makes it possible to see, command by
    // command, exactly which writes get an answer and which don't --
    // e.g. if 8C 0E 01 (start test) never gets so much as one notify back
    // at all, that's a very different problem (and points somewhere very
    // different) than getting 8C 05 replies that just never stabilize.
    this.log(`-> write (${bytes.length}B): ${toHex(bytes)}`);
    await this.characteristic.writeWithoutResponse(base64);
  }

  isConnected(): boolean {
    return this.device !== null && this.characteristic !== null;
  }

  /** The connected device's advertised name (e.g. "HPCS-310-0326030"), or null if not connected. Used to pick the right field-offset map for parseResult, since different models lay their result body out differently. */
  getDeviceName(): string | null {
    return this.device?.name ?? null;
  }

  /** The connected device's BLE identifier, or null if not connected. Used by takeMeasurement()'s reconnect-per-reading experiment to reconnect to the SAME physical meter via connectToDevice() rather than re-running the name-prefix scan. */
  getDeviceId(): string | null {
    return this.device?.id ?? null;
  }

  /**
   * Scans for ANY nearby BLE device, not just ones matching a known meter
   * prefix -- useful as a diagnostic: confirms whether the meter is
   * actually advertising at all, and shows its real advertised name/RSSI
   * even if it doesn't match METER_NAME_PREFIXES (e.g. a brand new model
   * you haven't added yet). Deliberately reuses this.manager rather than
   * creating a new BleManager, for the same reason scanAndConnect does --
   * multiple live BleManager instances is what caused reconnects to
   * silently stop working until an app restart.
   *
   * Calls onDevice once per advertisement seen (a device may fire
   * repeatedly as its RSSI updates). Returns a stop function; scanning
   * also auto-stops after timeoutMs if you don't call it first.
   */
  scanForAllDevices(onDevice: (device: Device) => void, timeoutMs = 15000): () => void {
    this.manager.startDeviceScan(null, { allowDuplicates: false }, (error, device) => {
      if (error) {
        this.log(`Scan error: ${error.message}`);
        return;
      }
      if (device) onDevice(device);
    });

    const timeout = setTimeout(() => this.manager.stopDeviceScan(), timeoutMs);
    return () => {
      clearTimeout(timeout);
      this.manager.stopDeviceScan();
    };
  }

  /**
   * Clears out BLE connections to meter-like devices left over from a
   * PREVIOUS JS/native session -- e.g. after Metro pushes new code and the
   * app reloads (or a fresh build is installed) while a meter was still
   * connected. On a reload, this class's constructor runs again and creates
   * a brand new native BleManager -- but the OLD one (and any still-open
   * GATT link(s) it held) is simply abandoned: the reload tears down the
   * whole JS context without ever calling disconnect()/destroy() on it. A
   * meter left connected like that thinks it's still talking to a central
   * that's no longer actually there, and (confirmed in testing) won't
   * accept a fresh connection from a new BleManager until it's
   * power-cycled.
   *
   * Two passes, broadest first:
   *
   * 1. manager.connectedDevices([serviceUuid]) -- asks the OS for EVERY
   *    device it currently considers connected under the meter's BLE
   *    service (persisted via saveLastServiceUuid at connect time; every
   *    known Hopoocolor model shares the same service/characteristic, see
   *    protocol.ts). This is what catches "similar devices" in general --
   *    a different meter than the specific one you happened to connect to
   *    last, or one whose device ID never made it into storage -- not just
   *    the one exact device saveLastDeviceId happened to remember.
   *    Filtered through matchesKnownMeter() as a defensive double-check on
   *    name, in case that service UUID ever turns out to be a generic one
   *    shared with something else entirely.
   * 2. manager.cancelDeviceConnection(lastId) on the specific last-connected
   *    device ID -- a narrower fallback for when no service UUID has been
   *    learned/persisted yet at all (e.g. the very first run after this
   *    fix ships, before any successful connect has happened even once).
   *
   * Both ultimately rely on cancelConnection()/cancelDeviceConnection(),
   * which tell the native BLE stack (Android BluetoothGatt / iOS
   * CoreBluetooth) to drop a GATT connection regardless of which
   * BleManager instance originally opened it -- so this can clean up
   * connections this object never itself established. Safe to call even
   * when there's nothing stale to clean up; failures here are the
   * expected, harmless common case and are swallowed rather than surfaced
   * as real errors. Call this BEFORE scanAndConnect()/connectToDevice(),
   * not after.
   */
  async resetStaleConnection(): Promise<void> {
    const serviceUuid = await loadLastServiceUuid().catch(() => null);
    if (serviceUuid) {
      try {
        const alreadyConnected = await this.manager.connectedDevices([serviceUuid]);
        const meterLike = alreadyConnected.filter((d) => matchesKnownMeter(d.name));
        if (meterLike.length > 0) {
          this.log(
            `Found ${meterLike.length} meter-like device(s) still connected from a previous session -- clearing: ${meterLike
              .map((d) => `${d.name} (${d.id})`)
              .join(', ')}`
          );
          await Promise.all(
            meterLike.map((d) => d.cancelConnection().catch((e: any) => this.log(`Failed to clear ${d.id}: ${e.message}`)))
          );
        }
      } catch (e: any) {
        this.log(`connectedDevices lookup failed (continuing anyway): ${e.message}`);
      }
    }

    // Narrower fallback: the exact last-connected device ID, for when no
    // service UUID has been learned yet, or the pass above missed it for
    // some other reason. Cheap and harmless to also run unconditionally.
    const lastId = await loadLastDeviceId().catch(() => null);
    if (!lastId) return;
    try {
      await this.manager.cancelDeviceConnection(lastId);
      this.log(`Cleared stale connection to ${lastId}.`);
    } catch (e: any) {
      // Expected in the common case (nothing was actually stale) -- not
      // worth alarming about, just noting it for anyone reading the Logs
      // tab while troubleshooting this specific issue.
      this.log(`(nothing to clear for ${lastId}, or already clear: ${e.message})`);
    }
  }

  async disconnect(): Promise<void> {
    this.notifySubscription?.remove();
    this.notifySubscription = null;
    this.siblingSubscriptions.forEach((s) => s.remove());
    this.siblingSubscriptions = [];
    if (this.device) {
      await this.device.cancelConnection().catch(() => {});
    }
    this.device = null;
    this.characteristic = null;
  }

  /**
   * Deliberately does NOT call this.manager.destroy() any more. this.manager
   * is now the one shared, app-lifetime BleManager (see
   * getSharedBleManager()) -- destroying it here would tear down the single
   * native client every OTHER MeterConnection instance (including ones
   * created after a future reload) also depends on, for the entire rest of
   * the app's process lifetime, not just this instance's own connection.
   * Kept as a no-op rather than removed outright since it's still part of
   * this class's public shape; disconnect() is the right call for "I'm done
   * with this specific connection," which is what every real caller
   * actually wants.
   */
  destroy(): void {
    this.log('destroy() called -- no-op: the underlying BleManager is a shared singleton now, use disconnect() instead.');
  }
}
