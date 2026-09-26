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
