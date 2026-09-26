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
  METER_NAME_PREFIX,
  METER_SERVICE_UUID_PLACEHOLDER,
  METER_CHARACTERISTIC_UUID_PLACEHOLDER,
  RESULT_HEADER_LENGTH,
} from './protocol';

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
  private log: LogFn;

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

  constructor(log: LogFn = () => {}) {
    this.manager = new BleManager();
    this.log = log;
  }

  /** Registers a listener for every reassembled message. Returns an unsubscribe function -- call it once you're done (e.g. after a single measurement resolves) so listeners don't pile up across repeated measurements. */
  onMessage(listener: (msg: MeterMessage) => void): () => void {
    this.messageListeners.push(listener);
    return () => {
      this.messageListeners = this.messageListeners.filter((l) => l !== listener);
    };
  }

  /** Scans for a device whose name starts with METER_NAME_PREFIX and connects to it. Resolves with the connected Device. */
  async scanAndConnect(timeoutMs = 15000): Promise<Device> {
    const authorized = await requestBlePermissions();
    if (!authorized) {
      throw new Error(
        'Bluetooth permission was denied. Enable "Nearby devices" (and Location, on older Android) for this app in Settings.'
      );
    }

    this.log(`Scanning for devices named "${METER_NAME_PREFIX}*"...`);

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
        if (device?.name?.startsWith(METER_NAME_PREFIX)) {
          clearTimeout(timeout);
          this.manager.stopDeviceScan();
          this.log(`Found ${device.name} (${device.id})`);
          resolve(device);
        }
      });
    });

    this.log('Connecting...');
    let connected = await found.connect();
    connected = await connected.discoverAllServicesAndCharacteristics();

    // Android's default MTU (23 bytes) causes excessive fragmentation --
    // request a larger one to match what the vendor app uses. Harmless
    // no-op on iOS, which negotiates MTU automatically.
    try {
      connected = await connected.requestMTU(247);
    } catch (e) {
      this.log(`requestMTU failed (continuing anyway): ${e}`);
    }

    this.device = connected;
    await this.discoverAndPickCharacteristic(connected);
    await this.subscribe();

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
        if (writable && c.isNotifiable && !candidate) {
          candidate = c;
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
      this.handleNotification(new Uint8Array(bytes));
    });
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
    await this.characteristic.writeWithoutResponse(base64);
  }

  isConnected(): boolean {
    return this.device !== null && this.characteristic !== null;
  }

  async disconnect(): Promise<void> {
    this.notifySubscription?.remove();
    this.notifySubscription = null;
    if (this.device) {
      await this.device.cancelConnection().catch(() => {});
    }
    this.device = null;
    this.characteristic = null;
  }

  destroy(): void {
    this.manager.destroy();
  }
}