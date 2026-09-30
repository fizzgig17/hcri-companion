// src/utils/keepAwake.ts
//
// Keeps the screen from auto-locking while connected to the meter, IF the
// user has turned that on in Settings (see preferences.ts /
// SettingsScreen.tsx) -- off by default, since an always-on screen drains
// battery faster and not everyone wants that tradeoff for every session.
//
// Requires @sayem314/react-native-keep-awake -- screen-wake-lock isn't
// something React Native's core API exposes on its own (unlike Vibration,
// see haptics.ts), so this needs a small native module:
//   npm install @sayem314/react-native-keep-awake
// (React Native >= 0.60 autolinks it -- no manual native setup needed.)
//
// NOT the older `react-native-keep-awake` package -- its Android build
// script still calls the long-shut-down jcenter() repository, which fails
// outright on any modern Gradle/AGP toolchain ("Could not find method
// jcenter()"). This package is an actively maintained drop-in replacement
// with the same idea, no jcenter dependency, and named-export functions
// instead of a default-export object with .activate()/.deactivate().

import { activateKeepAwake, deactivateKeepAwake } from '@sayem314/react-native-keep-awake';

export function enableKeepAwake(): void {
  activateKeepAwake();
}

export function disableKeepAwake(): void {
  deactivateKeepAwake();
}
