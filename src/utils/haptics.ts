// src/utils/haptics.ts
//
// Short vibration feedback for reading completion/failure -- lets you tell
// a measurement finished without having to be looking at the screen the
// whole time (useful mid-session, hands busy holding a light source up to
// the meter). Uses React Native's built-in Vibration API, not a separate
// haptics library -- Vibration.vibrate() is a plain buzz rather than the
// short, sharp "tap" feel of iOS's Taptic Engine or Android's
// HapticFeedbackConstants, but it needs zero extra native dependencies or
// linking, which matters more here than getting the exact feel of a "real"
// system haptic right.

import { Vibration, Platform } from 'react-native';

// Vibration.vibrate() throws (not a rejected promise -- a synchronous throw
// straight out of the native module) if the VIBRATE permission isn't
// declared in AndroidManifest.xml. That's a one-line manifest fix, but a
// missing permission is exactly the kind of thing that shouldn't be able to
// crash the whole app for something as minor as a buzz -- so every call
// here is wrapped and just silently no-ops if the native call fails for any
// reason, instead of taking down the screen.
// Two switches (Settings > Feedback), loaded once at app start and updated
// live by the Settings toggles. Both on by default.
let tapsEnabled = true;
let resultsEnabled = true;

export function setTapHapticsEnabled(enabled: boolean): void {
  tapsEnabled = enabled;
}

export function setResultHapticsEnabled(enabled: boolean): void {
  resultsEnabled = enabled;
}

function safeVibrate(pattern: number | number[]): void {
  try {
    Vibration.vibrate(pattern);
  } catch {
    // No permission, no vibrator hardware, emulator without one, etc. --
    // the reading itself already succeeded/failed independently of this,
    // so there's nothing else to do here.
  }
}

/** Short buzz for a successful reading or upload. */
export function hapticSuccess(): void {
  if (!resultsEnabled) return;
  safeVibrate(Platform.OS === 'android' ? 40 : 30);
}

/** Slightly longer double-buzz for a failed/timed-out reading -- deliberately distinct from the success buzz so the two are tellable apart without looking at the screen. */
export function hapticFailure(): void {
  if (!resultsEnabled) return;
  safeVibrate(Platform.OS === 'android' ? [0, 60, 80, 60] : [0, 40, 60, 40]);
}

/** Very short tick for the buttons whose effect isn't instantly visible (Connect/Take reading, Upload, Disconnect). */
export function hapticTap(): void {
  if (!tapsEnabled) return;
  safeVibrate(Platform.OS === 'android' ? 12 : 10);
}
