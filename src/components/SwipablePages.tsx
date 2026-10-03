// src/components/SwipablePages.tsx
//
// A small horizontally-swipeable set of pages with a dot indicator --
// used to let Spectrum/Chrom live as sub-pages of one tab instead of two
// separate top-level tabs, so you can swipe between the SPD graph and the
// CIE chromaticity diagram the way the vendor app's own tab bar visually
// groups them (Spec./Chrom. sit right next to each other there too).
//
// Built on a plain ScrollView with pagingEnabled rather than pulling in
// react-native-pager-view -- this app already has enough native deps
// (ble-plx, svg) that each needed their own rebuild; a JS-only pager avoids
// adding one more for something this simple.
//
// Each page is measured individually (onLayout) and the scrolling area is
// sized to whichever page is currently active, not to the tallest of the
// three -- a horizontal ScrollView with no explicit height otherwise sizes
// itself to its tallest child, which left a dead gap of empty space under
// any shorter page (the Spectrum page, with its Raw Values section
// collapsed, was the shortest of the three) with whatever comes after this
// component (the Upload/Take Reading/Disconnect buttons on MainTab) pushed
// down to clear the TALLEST page instead of sitting right under whichever
// one is actually on screen.

import React, { useRef, useState } from 'react';
import {
  View,
  ScrollView,
  NativeSyntheticEvent,
  NativeScrollEvent,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
} from 'react-native';
import { useTheme } from '../contexts/ThemeContext';

export interface Page {
  key: string;
  label: string;
  content: React.ReactNode;
}

interface Props {
  pages: Page[];
}

export default function SwipablePages({ pages }: Props) {
  const { colors } = useTheme();
  // Same reasoning as SpectrumChart's own width state: gating page content
  // entirely behind `width > 0` meant the Spectrum tab's pages (including
  // its SpectrumChart) didn't even get constructed, let alone laid out,
  // until THIS onLayout fired too -- stacking a second native round-trip on
  // top of SpectrumChart's own and doubling the window for a delayed first
  // reading to show nothing. Seeding from the window's width means pages
  // mount immediately; onLayout still corrects it once it arrives.
  //
  // Seeded as window width minus 32, not the raw window width -- this
  // component is only ever used inside HomeScreen's/ReadingDetailScreen's
  // own scroll content, both of which reserve 16px of horizontal padding
  // on each side (see their `content` styles) before this ever mounts.
  // The raw window width overshoots by exactly that 32px, which used to be
  // visible as this (and every child chart below it) drawing noticeably
  // too wide for a frame or two and then snapping narrower the instant
  // onLayout corrects it -- worse than a plain guess-wrong-by-a-little,
  // and it repeated every time this remounts (e.g. swiping HomeScreen's
  // Main/Data/Logs tab away from and back to Main). Subtracting the one
  // horizontal chrome value that's constant across both screens this is
  // used from gets the very first paint within a pixel or two of the real
  // size instead, without giving up the no-blank-first-render guarantee
  // above.
  const [width, setWidth] = useState(() => Dimensions.get('window').width - 32);
  const [activeIndex, setActiveIndex] = useState(0);
  const scrollRef = useRef<ScrollView>(null);
  // One measured height per page, filled in as each page's onLayout fires
  // (all three mount at once, so in practice all three arrive almost
  // immediately). Undefined entries (nothing measured yet) just mean the
  // wrapper below falls back to auto-height until they do.
  const [pageHeights, setPageHeights] = useState<Record<string, number>>({});

  const onScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (!width) return;
    const index = Math.round(e.nativeEvent.contentOffset.x / width);
    setActiveIndex(Math.max(0, Math.min(pages.length - 1, index)));
  };

  const goTo = (index: number) => {
    scrollRef.current?.scrollTo({ x: index * width, animated: true });
    setActiveIndex(index);
  };

  const styles = StyleSheet.create({
    dotsRow: { flexDirection: 'row', justifyContent: 'center', marginTop: 8, marginBottom: 4 },
    dotTouchable: { padding: 4 },
    dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.cardBorder },
    dotActive: { backgroundColor: colors.accent, width: 16 },
  });

  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {width > 0 && (
        <>
          {/* Height comes from the active page's own measurement, not the
              ScrollView's natural (tallest-child) sizing -- see the
              file-level comment. Falls back to undefined (auto) for the
              very first render, before any page has reported a height
              yet, so there's no flash of a 0-height pager. */}
          <View style={{ height: pageHeights[pages[activeIndex]?.key] }}>
            <ScrollView
              ref={scrollRef}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              onMomentumScrollEnd={onScrollEnd}
            >
              {pages.map((p) => (
                <View
                  key={p.key}
                  style={{ width }}
                  onLayout={(e) => {
                    const h = e.nativeEvent.layout.height;
                    setPageHeights((prev) => (prev[p.key] === h ? prev : { ...prev, [p.key]: h }));
                  }}
                >
                  {p.content}
                </View>
              ))}
            </ScrollView>
          </View>

          {/* Dot indicator, doubling as tap-to-jump -- lets you tap over to
              Chrom without swiping too, same as tapping a page dot anywhere
              else in the app's UI conventions. */}
          <View style={styles.dotsRow}>
            {pages.map((p, i) => (
              <TouchableOpacity key={p.key} onPress={() => goTo(i)} hitSlop={8} style={styles.dotTouchable}>
                <View style={[styles.dot, i === activeIndex && styles.dotActive]} />
              </TouchableOpacity>
            ))}
          </View>
        </>
      )}
    </View>
  );
}
