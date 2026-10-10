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

import InfoButton from './InfoButton';
import HintPressable from './HintPressable';
import { PagerLockContext } from './PagerLock';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  ScrollView,
  NativeSyntheticEvent,
  NativeScrollEvent,
  StyleSheet,
} from 'react-native';

import { useTheme } from '../contexts/ThemeContext';
import { useContentWidth } from '../layout';

// Horizontal chrome this component sits inside on BOTH screens that use
// it (HomeScreen's and ReadingDetailScreen's own scroll content -- see
// their `content` styles): 16px of padding on each side. This is only
// the SCREEN's own chrome, though -- it's the default for
// `horizontalChrome` below, not a hardcoded truth. MainTab additionally
// wraps SpectrumTab (and so this component) in its own `resultCard`
// padding, which used to NOT be accounted for here at all: this
// component would force every page to the screen-only width (32px
// narrower than the window), 28px too WIDE for the real space left
// inside resultCard's own padding, pushing every chart's right edge
// (sometimes both edges) past the card's visible border -- the "box
// around the chart is too big for the viewport" / "missing left or
// right lines" report. See SpectrumTab.tsx's `extraHorizontalChrome`
// prop for where that real figure now comes from.
const SCREEN_HORIZONTAL_PADDING = 32;

export interface Page {
  key: string;
  label: string;
  content: React.ReactNode;
  /** Optional "What's this?" help for this page, shown at the bottom-left under the card. */
  info?: { title: string; message: string };
}

interface Props {
  pages: Page[];
  /** Total horizontal chrome (both sides combined) already reserved by whatever wraps this component, beyond... well, instead of the default screen-only padding. Pass this whenever a host screen adds its own card/padding around SpectrumTab, so pages come out the real width rather than an estimate that's too wide. */
  horizontalChrome?: number;
  /** Force the pager's height (Main tab fits the screen); otherwise it follows the active page. */
  fixedHeight?: number;
  /** Fill whatever room the parent gives (parent must be bounded): pages take exactly the visible height, so nothing can be clipped. Overrides fixedHeight. */
  fill?: boolean;
  /** Changing this value sends the pager back to its first page (e.g. a new reading arrived). */
  resetKey?: unknown;
  /** Jump to the page with this key whenever `n` changes (e.g. start of a Flicker run). */
  goTo?: { key: string; n: number };
}

// Dots row footprint in fill mode (26 tall + 8 above + 4 below, same as the flow layout).
const DOTS_H = 38;

export default function SwipablePages({ pages, horizontalChrome = SCREEN_HORIZONTAL_PADDING, fixedHeight, fill, resetKey, goTo: goToTarget }: Props) {
  const { colors } = useTheme();
  // Confirmed 2026-10-03: measuring this via onLayout at all -- even
  // seeded with a close estimate that onLayout then "corrects" -- means
  // there are always two renders: one at the estimate, one at whatever
  // onLayout reports, and any difference between them is a visible
  // shift. But this component is only ever used inside HomeScreen's and
  // ReadingDetailScreen's own scroll content, and both reserve exactly
  // the same 16px-each-side horizontal padding (see their `content`
  // styles) before this ever mounts -- so the real width isn't something
  // that needs measuring at all, it's a known function of the window
  // width. useWindowDimensions gives that directly (and keeps it correct
  // across rotation/resize), so there's only ever one value, computed up
  // front -- nothing to snap to on a later layout pass.
  const windowWidth = useContentWidth();
  const width = windowWidth - horizontalChrome;
  const [activeIndex, setActiveIndex] = useState(0);
  // fill mode: fixedHeight is the TOTAL height available (pages + dots row), all laid out with explicit numbers.
  const clipH = fill ? Math.max(0, Math.floor((fixedHeight ?? 0) - DOTS_H)) : 0;
  const pageH = fill ? clipH : fixedHeight;
  const [scrollLocked, setScrollLocked] = useState(false);
  const scrollRef = useRef<React.ComponentRef<typeof ScrollView>>(null);
  // Note: no system-gesture exclusion zones here. They used to reserve the pager's left/right
  // edges for chart paging, which swallowed the Android Back swipe whenever it began over a chart.
  // Back to the first page whenever resetKey changes (not on first mount).
  const firstKey = useRef(true);
  const resetJustRan = useRef(false);
  useEffect(() => {
    if (firstKey.current) {
      firstKey.current = false;
      return;
    }
    resetJustRan.current = true;
    setActiveIndex(0);
    (scrollRef.current as any)?.scrollTo({ x: 0, animated: false });
  }, [resetKey]);
  // Pages can come and go (Flicker only exists while a capable meter is connected): never point past the end.
  useEffect(() => {
    // A reset in this same commit (e.g. Live starting while on the Flicker page, which also removes that page) already
    // sent us to the first page; the stale activeIndex here must not clamp us to the last one instead.
    if (resetJustRan.current) {
      resetJustRan.current = false;
      return;
    }
    if (pages.length > 0 && activeIndex > pages.length - 1) {
      setActiveIndex(pages.length - 1);
      (scrollRef.current as any)?.scrollTo({ x: (pages.length - 1) * width, animated: false });
    }
  }, [pages.length, activeIndex, width]);
  // Jump only when `n` actually changes after it was first seen (the Flicker page appearing on connect
  // must not count as a request to go there).
  const lastGoN = useRef<number | undefined>(goToTarget?.n);
  useEffect(() => {
    if (!goToTarget) return;
    if (lastGoN.current === undefined) {
      lastGoN.current = goToTarget.n;
      return;
    }
    if (goToTarget.n === lastGoN.current) return;
    lastGoN.current = goToTarget.n;
    const i = pages.findIndex((p) => p.key === goToTarget.key);
    if (i >= 0) {
      setActiveIndex(i);
      (scrollRef.current as any)?.scrollTo({ x: i * width, animated: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goToTarget?.n]);
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
    dotsRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: 8, marginBottom: 4, height: 26 },
    infoLeft: { position: 'absolute', left: 4, top: 0, bottom: 0, justifyContent: 'center' },
    dotTouchable: { padding: 4 },
    dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.cardBorder },
    dotActive: { backgroundColor: colors.accent, width: 16 },
  });

  return (
    <PagerLockContext.Provider value={setScrollLocked}>
    <View style={fill ? { height: fixedHeight } : undefined}>
      {width > 0 && (
        <>
          {/* Height comes from the active page's own measurement, not the
              ScrollView's natural (tallest-child) sizing -- see the
              file-level comment. Falls back to undefined (auto) for the
              very first render, before any page has reported a height
              yet, so there's no flash of a 0-height pager. */}
          <View
            style={fill ? { height: clipH, overflow: 'hidden' } : { height: fixedHeight ?? pageHeights[pages[activeIndex]?.key], overflow: 'hidden' }}
          >
            <ScrollView
              ref={scrollRef}
              horizontal
              pagingEnabled
              decelerationRate="fast"
              nestedScrollEnabled
              // Same reason as HistoryScreen's ScrollView: the default
              // ("never") eats the first tap while the keyboard is up, which
              // broke Save/Cancel in popups opened from a page (the rename
              // popup needed two taps).
              keyboardShouldPersistTaps="handled"
              scrollEnabled={!scrollLocked}
              overScrollMode="never"
              bounces={false}
              showsHorizontalScrollIndicator={false}
              onMomentumScrollEnd={onScrollEnd}
              contentOffset={{ x: activeIndex * width, y: 0 }}
              onContentSizeChange={() => scrollRef.current?.scrollTo({ x: activeIndex * width, animated: false })}
            >
              {(fill && clipH <= 0 ? [] : pages).map((p) => (
                <View
                  key={p.key}
                  style={{ width, height: pageH }}
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
          <View style={[styles.dotsRow, fill && { position: 'absolute', left: 0, right: 0, top: clipH, marginTop: 0, marginBottom: 0, height: DOTS_H }]}>
            {pages[activeIndex]?.info && (
              <View style={styles.infoLeft}>
                <InfoButton
                  title={pages[activeIndex].info!.title}
                  message={pages[activeIndex].info!.message}
                  style={{ width: 24, height: 24, borderRadius: 12 }}
                />
              </View>
            )}
            {pages.map((p, i) => (
              <HintPressable key={p.key} hint={p.label} onPress={() => goTo(i)} hitSlop={8} style={styles.dotTouchable} accessibilityLabel={p.label}>
                <View style={[styles.dot, i === activeIndex && styles.dotActive]} />
              </HintPressable>
            ))}
          </View>
        </>
      )}
    </View>
    </PagerLockContext.Provider>
  );
}
