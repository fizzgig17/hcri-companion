// src/layout.ts
//
// The app is designed for a phone-width column. Three layout modes, chosen from the window size:
//
//   compact    phones (and phones in landscape): the whole app is one column at most MAX_CONTENT_WIDTH wide,
//              centered, as it has always been.
//   dashboard  wide, landscape tablets (iPad, Android tablets, an unfolded foldable held sideways): every graph
//              on one page, with History as a column on the right.
//   stacked    tall tablets and unfolded foldables in portrait: the same graphs, with History below them.
//
// The rule is on the window, not the device, so split-screen, Stage Manager windows and foldable postures all
// pick the right mode as the window changes size.
//
// Anything that sizes itself from the window width must use useContentWidth() rather than
// useWindowDimensions().width: it returns the width of the column the component actually lives in (the phone
// column, or the pane a wide layout put it in).

import { createContext, useContext } from 'react';
import { useWindowDimensions } from 'react-native';

export const MAX_CONTENT_WIDTH = 480;
/** Settings, About and other single-column screens are capped at this width on wide windows. */
export const WIDE_SINGLE_COLUMN_WIDTH = 720;

export type LayoutMode = 'compact' | 'stacked' | 'dashboard';

export function layoutModeFor(width: number, height: number): LayoutMode {
  // Orientation decides between the two wide modes: a 12.9"/13" iPad held upright is 1024-1032 wide, which
  // is past the dashboard width, but it is a portrait window and wants History below, not beside.
  if (width >= 960 && height >= 560 && width > height) return 'dashboard';
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
