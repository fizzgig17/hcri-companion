// src/layout.ts
//
// The app is designed for a phone-width column. On wider screens (tablets,
// unfolded foldables, phones in landscape) the whole app is centered in a
// column at most MAX_CONTENT_WIDTH wide (see App.tsx) instead of stretching,
// which squished the charts and pushed the action buttons out of place.
// Anything that sizes itself from the window width must use useContentWidth()
// rather than useWindowDimensions().width so it matches that column.

import { useWindowDimensions } from 'react-native';

export const MAX_CONTENT_WIDTH = 480;

export function useContentWidth(): number {
  const { width } = useWindowDimensions();
  return Math.min(width, MAX_CONTENT_WIDTH);
}
