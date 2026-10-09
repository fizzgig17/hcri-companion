// src/utils/inAppUpdate.ts
//
// Thin wrapper over the native InAppUpdate module (see InAppUpdateModule.kt),
// which only ASKS Google Play whether a newer version exists. It never starts
// an in-app update: the app just sends the person to its Play Store listing
// (openPlayStore below). Only meaningful on Android installs that came from
// Google Play (including closed testing).

import { Linking, NativeModules, Platform } from 'react-native';

export interface UpdateInfo {
  available: boolean;
  /** Play's versionCode for the newer build (0 if none). */
  versionCode: number;
}

const native: {
  checkForUpdate: () => Promise<UpdateInfo>;
} | undefined = Platform.OS === 'android' ? NativeModules.InAppUpdate : undefined;

export const updatesSupported = !!native;

export async function checkForUpdate(): Promise<UpdateInfo> {
  if (!native) throw new Error('In-app updates are only available on Android.');
  return native.checkForUpdate();
}

/** Opens this app's listing in the Play Store app (falls back to the web page). */
export async function openPlayStore(): Promise<void> {
  try {
    await Linking.openURL('market://details?id=com.hcricompanion');
  } catch {
    await Linking.openURL('https://play.google.com/store/apps/details?id=com.hcricompanion').catch(() => {});
  }
}
