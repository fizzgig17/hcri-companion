// src/utils/navBar.ts
//
// Android only: what the bottom system navigation bar does while the app is open (see NavBarModule.kt).
//  - 'auto'   (default): hidden for the full screen height; an edge swipe shows it briefly.
//  - 'docked': always visible, and the app's screen ends above it.
// Only matters with the classic 3-button bar -- the thin gesture pill is never hidden.

import { NativeModules, Platform } from 'react-native';

export type NavBarMode = 'auto' | 'docked';

const native: { getMode(): Promise<string>; setMode(mode: string): Promise<void> } | undefined =
  Platform.OS === 'android' ? NativeModules.NavBar : undefined;

/** True on an Android build that has the native module (older builds don't, and the setting is hidden). */
export const navBarSupported = !!native;

export async function loadNavBarMode(): Promise<NavBarMode> {
  if (!native) return 'auto';
  try {
    return (await native.getMode()) === 'docked' ? 'docked' : 'auto';
  } catch {
    return 'auto';
  }
}

export async function saveNavBarMode(mode: NavBarMode): Promise<void> {
  if (!native) return;
  await native.setMode(mode);
}
