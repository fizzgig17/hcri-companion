// src/layout.ts
//
// The app is designed for a phone-width column. Three layout modes, chosen from the window size:
//
//   compact    phones (and phones in landscape): the whole app is one column at most MAX_CONTENT_WIDTH wide,
//              centered, as it has always been.
//   dashboard  wide, landscape tablets (iPad, Android tablets, an unfolded foldable held sideways): every graph
//              on one page, with History as a column on the right.
//              Also nearly square windows (an unfolded foldable): there the right column switches between History
//              and Data, and the graphs swipe if the left pane is narrow (see isSquareWindow, MIN_GRID_WIDTH).
//   stacked    tall tablets and unfolded foldables in portrait: the same graphs, with History below them.
//
// The rule is on the window, not the device, so split-screen, Stage Manager windows and foldable postures all
// pick the right mode as the window changes size.
//
// Anything that sizes itself from the window width must use useContentWidth() rather than
// useWindowDimensions().width: it returns the width of the column the component actually lives in (the phone
// column, or the pane a wide layout put it in).

import { createContext, useContext } from 'react';
import { Platform, useWindowDimensions } from 'react-native';

export const MAX_CONTENT_WIDTH = 480;
/** Settings, About and other single-column screens are capped at this width on wide windows. */
export const WIDE_SINGLE_COLUMN_WIDTH = 720;

export type LayoutMode = 'compact' | 'stacked' | 'dashboard';

/**
 * Nearly square windows (an unfolded foldable): charts on the left, History/Data switchable on the right.
 * On Android the range is wider (about 3:4 to 4:3) so the less square unfolded foldables (a Galaxy Z Fold8 is 4:3)
 * get this same layout in both orientations instead of the phone column (held wide) or the cramped stacked page
 * (held tall). iPads have the same 4:3 shape but keep their own stacked/dashboard modes, so the wider range is Android only.
 */
export function isSquareWindow(width: number, height: number, android: boolean = Platform.OS === 'android'): boolean {
  const r = width / Math.max(1, height);
  const lo = android ? 0.7 : 0.83;
  const hi = android ? 1.45 : 1.2;
  return width >= 600 && height >= 560 && r >= lo && r <= hi;
}

/** Width of the right-hand column in a square window: a third of the window, but wide enough to read History. */
export function sideColumnWidth(width: number): number {
  return Math.round(Math.min(420, Math.max(300, width * 0.34)));
}

/** The graphs are drawn all at once (big chart plus the rest) only when the pane they live in is at least this wide; narrower panes swipe through them. */
export const MIN_GRID_WIDTH = 560;

export function layoutModeFor(width: number, height: number): LayoutMode {
  // Orientation decides between the two wide modes: a 12.9"/13" iPad held upright is 1024-1032 wide, which
  // is past the dashboard width, but it is a portrait window and wants History below, not beside.
  if (width >= 960 && height >= 560 && width > height) return 'dashboard';
  if (isSquareWindow(width, height)) return 'dashboard';
  if (width >= 640 && height >= 760) return 'stacked';
  return 'compact';
}

export function useLayoutMode(): LayoutMode {
  const { width, height } = useWindowDimensions();
  return layoutModeFor(width, height);
}

/** Set by a wide layout around a pane, so charts inside it size to the pane rather than the window. */
export const ContentWidthContext = createContext<number | null>(null);

export function useContentWidth(): number {
  const { width } = useWindowDimensions();
  const fromPane = useContext(ContentWidthContext);
  return fromPane ?? Math.min(width, MAX_CONTENT_WIDTH);
}
