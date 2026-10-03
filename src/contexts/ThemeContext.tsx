// src/contexts/ThemeContext.tsx
//
// Resolves the app's Light/Dark/System preference (see
// storage/preferences.ts's loadThemeModePreference/saveThemeModePreference)
// down to one actual color palette, and makes that available to every
// screen via useTheme(). 'system' tracks the phone's own light/dark
// setting live (react-native's own useColorScheme -- no extra dependency),
// so flipping the phone's appearance while the app is open updates it
// immediately, same as Light/Dark override after SettingsScreen's picker
// calls setMode().
//
// Every screen/component that currently does
//   import { colors } from '../theme'
// and builds its StyleSheet at module scope needs to switch to calling
// useTheme() inside the component body instead and building its styles
// from the result (see any converted screen for the pattern) -- colors can
// no longer be a plain static import now that it varies at runtime.

import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useColorScheme } from 'react-native';
import { darkColors, lightColors, statusColorsFor, ThemeColors, ThemeMode } from '../theme';
import { loadThemeModePreference, saveThemeModePreference } from '../storage/preferences';

interface ThemeContextValue {
  /** The person's own Light/Dark/System choice, as stored -- 'system' unless they've overridden it in Settings. */
  mode: ThemeMode;
  /** Persists the choice (AsyncStorage, see preferences.ts) and updates every screen immediately. */
  setMode: (mode: ThemeMode) => void;
  /** 'system' already resolved down to an actual light/dark, e.g. for anything that needs to know which one is active right now (StatusBar's barStyle, say) without caring whether that came from the phone or an explicit override. */
  scheme: 'light' | 'dark';
  colors: ThemeColors;
  statusColors: Record<string, string>;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // react-native's own Appearance API -- no new dependency. Can briefly be
  // null before the native side reports in; treated as dark (this app's
  // original, only look) rather than light in that gap, same fallback used
  // below for an unrecognized value.
  const systemScheme = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>('system');

  // Loaded once on mount -- see loadThemeModePreference's own comment on
  // why 'system' is the right default for a mount that hasn't resolved
  // yet (matches what a fresh install would fall back to anyway).
  useEffect(() => {
    loadThemeModePreference()
      .then(setModeState)
      .catch(() => {});
  }, []);

  const setMode = (next: ThemeMode) => {
    setModeState(next);
    saveThemeModePreference(next).catch(() => {});
  };

  const scheme: 'light' | 'dark' = mode === 'system' ? (systemScheme === 'light' ? 'light' : 'dark') : mode;
  const colors = scheme === 'light' ? lightColors : darkColors;

  const value = useMemo<ThemeContextValue>(
    () => ({ mode, setMode, scheme, colors, statusColors: statusColorsFor(colors) }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setMode is stable (closes over nothing that changes); colors is derived from scheme, already a dep.
    [mode, scheme, colors]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme() called outside <ThemeProvider> -- see App.tsx for where it should wrap the app.');
  }
  return ctx;
}
