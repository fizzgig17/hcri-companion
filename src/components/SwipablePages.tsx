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
import { colors } from '../theme';

export interface Page {
  key: string;
  label: string;
  content: React.ReactNode;
}

interface Props {
  pages: Page[];
}

export default function SwipablePages({ pages }: Props) {
  // Same reasoning as SpectrumChart's own width state: gating page content
  // entirely behind `width > 0` meant the Spectrum tab's pages (including
  // its SpectrumChart) didn't even get constructed, let alone laid out,
  // until THIS onLayout fired too -- stacking a second native round-trip on
  // top of SpectrumChart's own and doubling the window for a delayed first
  // reading to show nothing. Seeding from the window's width means pages
  // mount immediately; onLayout still corrects it once it arrives.
  const [width, setWidth] = useState(() => Dimensions.get('window').width);
  const [activeIndex, setActiveIndex] = useState(0);
  const scrollRef = useRef<ScrollView>(null);

  const onScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (!width) return;
    const index = Math.round(e.nativeEvent.contentOffset.x / width);
    setActiveIndex(Math.max(0, Math.min(pages.length - 1, index)));
  };

  const goTo = (index: number) => {
    scrollRef.current?.scrollTo({ x: index * width, animated: true });
    setActiveIndex(index);
  };

  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {width > 0 && (
        <>
          <ScrollView
            ref={scrollRef}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={onScrollEnd}
          >
            {pages.map((p) => (
              <View key={p.key} style={{ width }}>
                {p.content}
              </View>
            ))}
          </ScrollView>

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

const styles = StyleSheet.create({
  dotsRow: { flexDirection: 'row', justifyContent: 'center', marginTop: 8, marginBottom: 4 },
  dotTouchable: { padding: 4 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.cardBorder },
  dotActive: { backgroundColor: colors.accent, width: 16 },
});
