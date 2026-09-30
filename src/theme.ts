// src/theme.ts
//
// Shared color tokens for a consistent dark UI across screens. Kept as
// plain data so both HomeScreen and SettingsScreen (and anything added
// later) draw from the same palette instead of hardcoding hex values
// scattered across files.

export const colors = {
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

export const statusColors: Record<string, string> = {
  disconnected: colors.mutedFaint,
  connecting: colors.info,
  connected: colors.accent,
  measuring: colors.warning,
  uploading: colors.info,
};

export const statusLabels: Record<string, string> = {
  disconnected: 'Not Connected',
  connecting: 'Connecting…',
  connected: 'Connected',
  measuring: 'Measuring…',
  uploading: 'Uploading…',
};