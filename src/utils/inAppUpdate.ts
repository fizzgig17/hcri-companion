// src/utils/inAppUpdate.ts
//
// Thin wrapper over the native InAppUpdate module (Google Play In-App
// Updates, see InAppUpdateModule.kt). Only meaningful on Android installs
// that came from Google Play (including closed testing).

import { NativeModules, Platform } from 'react-native';

export interface UpdateInfo {
  available: boolean;
  /** Play's versionCode for the newer build (0 if none). */
  versionCode: number;
  immediateAllowed: boolean;
}

const native: {
  checkForUpdate: () => Promise<UpdateInfo>;
  startImmediateUpdate: () => Promise<number>;
} | undefined = Platform.OS === 'android' ? NativeModules.InAppUpdate : undefined;

export const updatesSupported = !!native;

export async function checkForUpdate(): Promise<UpdateInfo> {
  if (!native) throw new Error('In-app updates are only available on Android.');
  return native.checkForUpdate();
}

/** Resolves with Play's result code (-1 = RESULT_OK; 0 = user cancelled). */
export async function startImmediateUpdate(): Promise<number> {
  if (!native) throw new Error('In-app updates are only available on Android.');
  return native.startImmediateUpdate();
}
