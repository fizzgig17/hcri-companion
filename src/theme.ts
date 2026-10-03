// src/theme.ts
//
// Shared color tokens for both the app's original dark UI and a light
// theme matching hCRI.io's own site (light gray-blue background, white
// cards, dark navy/near-black text, the same green accent) -- see
// contexts/ThemeContext.tsx for how a screen actually gets ONE of these at
// runtime (Light/Dark/System, picked in Settings). Kept as plain data so
// every screen draws from the same two palettes instead of hardcoding hex
// values scattered across files.
//
// Every key in darkColors must also exist in lightColors (and vice versa)
// -- ThemeColors is derived from darkColors specifically so TypeScript
// catches it if one palette ever drifts out of sync with the other.

export type ThemeMode = 'light' | 'dark' | 'system';

export const darkColors = {
  background: '#0d0d0f',
  card: '#18181b',
  cardBorder: '#2a2a2e',
  text: '#f2f2f2',
  muted: '#8b8b90',
  mutedFaint: '#5a5a5f',
  accent: '#2fa87a', // green -- connected / success / primary action
  accentPressed: '#26875f',
  warning: '#d9a441', // measuring / in-progress
  danger: '#d1554a', // errors / disconnect
  info: '#3d7fd9',
} as const;

// Matched against screenshots of hCRI.io's own report view: a light
// gray-blue page background, plain white cards/tiles, near-black body
// text, muted gray-blue labels ("CCT", "DUV", section headers), and the
// same blue/green hCRI.io already uses for CCT/Rf/Rg-style numbers --
// accent stays the identical green as the dark palette so "connected"/
// "success" reads the same color in either mode.
export const lightColors: Record<keyof typeof darkColors, string> = {
  background: '#eef1f6',
  card: '#ffffff',
  cardBorder: '#dde1e8',
  text: '#1a1a1e',
  muted: '#7b8794',
  mutedFaint: '#aab2bd',
  accent: '#2fa87a',
  accentPressed: '#1f7a56',
  warning: '#c8862b',
  danger: '#c1443a',
  info: '#2f6fd1',
};

// Widened to plain strings (not typeof darkColors's literal hex-string
// types) so both darkColors and lightColors satisfy it -- lightColors is
// already typed this way above, and keeping ThemeColors at the narrower
// literal type made the ternary in ThemeContext.tsx (mode === 'light' ?
// lightColors : darkColors) fail to type-check, since TS treats "the exact
// literal '#0d0d0f'" and "the exact literal '#eef1f6'" as different,
// mutually-incompatible types when a variable is sourced from the const
// `as const` object directly. `keyof typeof darkColors` still gives the
// same "every key must exist in both palettes" safety net the file-level
// comment describes.
export type ThemeColors = Record<keyof typeof darkColors, string>;

/** Built from whichever palette is actually active -- see ThemeContext's useTheme(). statusColors/statusLabels used to be static exports here, but status*COLORS* has to track the resolved theme (statusColors.disconnected needs to be THIS theme's mutedFaint, not always the dark one). statusLabels has no colors in it, so it stays a plain constant below. */
export function statusColorsFor(colors: ThemeColors): Record<string, string> {
  return {
    disconnected: colors.mutedFaint,
    connecting: colors.info,
    connected: colors.accent,
    measuring: colors.warning,
    uploading: colors.info,
  };
}

export const statusLabels: Record<string, string> = {
  disconnected: 'Not Connected',
  connecting: 'Connecting…',
  connected: 'Connected',
  measuring: 'Measuring…',
  uploading: 'Uploading…',
};
