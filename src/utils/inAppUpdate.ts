// src/utils/inAppUpdate.ts
//
// Thin wrapper over the native InAppUpdate module (see InAppUpdateModule.kt),
// which asks Google Play whether a newer version exists and can run Play's FLEXIBLE in-app update: the person confirms
// once in Play's small dialog, the update downloads in the background while the app keeps running, and "Restart" installs
// it. If Play will not do an in-app update, openPlayStore (below) is the fallback. Only meaningful on Android installs
// that came from Google Play (including closed testing).

import { DeviceEventEmitter, Linking, NativeModules, Platform } from 'react-native';

export interface UpdateInfo {
  available: boolean;
  /** Play's versionCode for the newer build (0 if none). */
  versionCode: number;
  /** Play's raw answer: 0 unknown, 1 not available, 2 available, 3 update in progress. */
  availability: number;
  /** versionCode of the installed app, as the OS reports it. */
  installedVersionCode: number;
  /** Play's install status: 11 = downloaded and waiting for a restart, 2 = downloading. */
  installStatus?: number;
}

/** Progress of an in-app update download (Play's InstallStatus numbers: 2 downloading, 11 downloaded, 4 installed, 5 failed, 6 canceled). */
export interface UpdateProgress {
  status: number;
  bytesDownloaded: number;
  totalBytes: number;
}

const native: {
  checkForUpdate: () => Promise<UpdateInfo>;
  startUpdate: () => Promise<'accepted' | 'declined'>;
  completeUpdate: () => Promise<boolean>;
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

/** Starts Play's flexible update (Play shows its own confirmation). Resolves 'accepted' or 'declined'; rejects when Play will not do it. */
export async function startInAppUpdate(): Promise<'accepted' | 'declined'> {
  if (!native) throw new Error('In-app updates are only available on Android.');
  return native.startUpdate();
}

/** Installs the downloaded update and restarts the app. */
export async function completeInAppUpdate(): Promise<void> {
  if (!native) return;
  await native.completeUpdate();
}

export function onUpdateProgress(cb: (p: UpdateProgress) => void): () => void {
  if (!native) return () => {};
  const sub = DeviceEventEmitter.addListener('InAppUpdateState', cb);
  return () => sub.remove();
}
