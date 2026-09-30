// src/storage/secureStorage.ts
//
// Persists hCRI.io credentials (and last-used label/username) securely.
// This improves on the ESP32 firmware, which stored the token in plaintext
// in flash (Preferences/NVS) -- fine for a device only you hold, but worth
// doing properly here since a phone app is a better place to get this right.
//
// Uses react-native-keychain, which wraps Android Keystore / iOS Keychain.
// Install it: npm install react-native-keychain
//
// (If you'd rather not add another native dependency right now, this file
// is the only place that would need to change to swap in a plainer
// AsyncStorage-based implementation -- everything else in the app just
// calls these functions and doesn't know or care how storage works.)

import * as Keychain from 'react-native-keychain';

const HCRI_SERVICE = 'hcri.io';

export interface HcriCredentials {
  username: string;
  token: string;
}

export async function saveHcriCredentials(creds: HcriCredentials): Promise<void> {
  await Keychain.setGenericPassword(creds.username, creds.token, {
    service: HCRI_SERVICE,
  });
}

export async function loadHcriCredentials(): Promise<HcriCredentials | null> {
  const result = await Keychain.getGenericPassword({ service: HCRI_SERVICE });
  if (!result) return null;
  return { username: result.username, token: result.password };
}

export async function clearHcriCredentials(): Promise<void> {
  await Keychain.resetGenericPassword({ service: HCRI_SERVICE });
}

// ---------------------------------------------------------------------------
// Last-connected meter device ID. Not a secret -- reusing Keychain here
// purely because it's already a dependency and gives us simple, persistent
// key-value storage without adding a whole new package (e.g. AsyncStorage)
// just for one string. See MeterConnection.resetStaleConnection() for why
// this needs to survive an app/JS reload, not just live in memory.
// ---------------------------------------------------------------------------

const LAST_DEVICE_SERVICE = 'hcri.io.lastMeterDevice';

export async function saveLastDeviceId(deviceId: string): Promise<void> {
  // setGenericPassword requires a non-empty "username" -- the actual value
  // we care about is the "password" slot; the username here is just a fixed
  // placeholder, not meaningful data.
  await Keychain.setGenericPassword('lastMeterDevice', deviceId, {
    service: LAST_DEVICE_SERVICE,
  });
}

export async function loadLastDeviceId(): Promise<string | null> {
  const result = await Keychain.getGenericPassword({ service: LAST_DEVICE_SERVICE });
  if (!result) return null;
  return result.password;
}

export async function clearLastDeviceId(): Promise<void> {
  await Keychain.resetGenericPassword({ service: LAST_DEVICE_SERVICE });
}

// ---------------------------------------------------------------------------
// Last-known meter BLE service UUID. Paired with the device ID above, but
// serves a different purpose: react-native-ble-plx's manager.connectedDevices()
// can only look up devices the OS already has connected by SERVICE UUID (BLE
// platform APIs don't offer "list everything connected, regardless of
// service"), so this is what lets resetStaleConnection() find and clear ANY
// currently-connected meter-like device on next launch -- not just the one
// specific device ID that happened to get saved last -- since every known
// Hopoocolor model shares the same service/characteristic (see protocol.ts).
// ---------------------------------------------------------------------------

const LAST_SERVICE_UUID_SERVICE = 'hcri.io.lastMeterServiceUuid';

export async function saveLastServiceUuid(serviceUuid: string): Promise<void> {
  await Keychain.setGenericPassword('lastMeterServiceUuid', serviceUuid, {
    service: LAST_SERVICE_UUID_SERVICE,
  });
}

export async function loadLastServiceUuid(): Promise<string | null> {
  const result = await Keychain.getGenericPassword({ service: LAST_SERVICE_UUID_SERVICE });
  if (!result) return null;
  return result.password;
}
