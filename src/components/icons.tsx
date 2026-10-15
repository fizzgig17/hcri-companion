// src/components/icons.tsx
//
// The app's one icon set: thin line icons on a 24x24 grid, drawn with
// react-native-svg at stroke width 2 with round caps and joins. Every screen
// takes its icons from here, so the same action has the same picture
// everywhere and the line weight never drifts.
//
// Sizes, by role:
//   ICON_SIZE.primary 22 -- action bar and other main controls
//   ICON_SIZE.row     18 -- actions on a row or card (History, Data)
//   ICON_SIZE.pill    16 -- icons inside a pill or chip next to a label
//   ICON_SIZE.inline  14 -- icons sitting in a line of text
//
// CloseButton is the single X used to close a screen, window or card.

import React from 'react';
import { TouchableOpacity, StyleProp, ViewStyle } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useTheme } from '../contexts/ThemeContext';

export const ICON_SIZE = { primary: 22, row: 18, pill: 16, inline: 14 } as const;
export const ICON_STROKE = 2;

export const ICONS = {
  x: 'M18 6L6 18M6 6l12 12',
  check: 'M20 6L9 17l-5-5',
  chevronLeft: 'M15 18l-6-6 6-6',
  chevronRight: 'M9 18l6-6-6-6',
  chevronDown: 'M6 9l6 6 6-6',
  upload: 'M16 16l-4-4-4 4M12 12v9M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3',
  share: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12',
  download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
  trash: 'M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6',
  eye: 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  compare: 'M3 17l5-6 4 4 8-9',
  link: 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71',
  external: 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3',
  // The TM-30 report everywhere (Main's action bar, History, Share PDF).
  report: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h8',
  photo: 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM8.5 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM21 15l-5-5L5 21',
  bulb: 'M9 18h6M10 22h4M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 0 1 8.91 14',
  key: 'M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4',
  edit: 'M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z',
  swap: 'M17 1l4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 23l-4-4 4-4M21 13v2a4 4 0 0 1-4 4H3',
  bolt: 'M13 2L3 14h9l-1 8 10-12h-9l1-8z',
  toTop: 'M17 11l-5-5-5 5M12 6v12M5 3h14',
  toBottom: 'M7 13l5 5 5-5M12 18V6M5 21h14',
  // Six dots: the drag handle on reorderable lists.
  grip: 'M9 6h.01M9 12h.01M9 18h.01M15 6h.01M15 12h.01M15 18h.01',
  gear:
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z',
  stop: 'M6 6h12v12H6z',
  redo: 'M23 4v6h-6M20.49 15a9 9 0 1 1-2.12-9.36L23 10',
  help: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01',
  play: 'M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z',
  live: 'M21 12a9 9 0 0 0-15.5-6.2M3 12a9 9 0 0 0 15.5 6.2M21 4v5h-5M3 20v-5h5',
  save: 'M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2zM17 21v-8H7v8M7 3v5h8',
  bluetooth: 'M6.5 6.5l11 11L12 23V1l5.5 5.5-11 11',
  power: 'M18.36 6.64a9 9 0 1 1-12.73 0M12 2v10',
  copy: 'M9 9h11v11H9zM5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1',
  activity: 'M22 12h-4l-3 9L9 3l-3 9H2',
} as const;

export type IconName = keyof typeof ICONS;

// Icons drawn filled rather than as a line.
const FILLED: ReadonlySet<IconName> = new Set<IconName>(['play', 'stop']);

export function Icon({ name, color, size = ICON_SIZE.row, fill }: { name: IconName; color: string; size?: number; fill?: boolean }) {
  const filled = fill ?? FILLED.has(name);
  // The grip's dots are zero-length strokes, so they need a thicker pen to show.
  const stroke = name === 'grip' ? 3 : ICON_STROKE;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? color : 'none'} stroke={filled ? 'none' : color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round">
      <Path d={ICONS[name]} />
    </Svg>
  );
}

/** The one close button: a filled round button with an X. `small` (28) is for dismissing a card inside a page. */
export function CloseButton({ onPress, label = 'Close', small, style }: { onPress: () => void; label?: string; small?: boolean; style?: StyleProp<ViewStyle> }) {
  const { colors } = useTheme();
  const d = small ? 28 : 36;
  return (
    <TouchableOpacity
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      activeOpacity={0.7}
      style={[{ width: d, height: d, borderRadius: d / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }, style]}
    >
      <Icon name="x" color={colors.text} size={small ? 14 : 18} />
    </TouchableOpacity>
  );
}
