// src/components/OverlayPanel.tsx
//
// A large centred panel over a dimmed backdrop, with a title and an X to close it. Tablet-only presentation for
// Settings, "See it on a photo", the TM-30 report, a saved reading and Compare (App.tsx shows them as transparent
// modal screens), so opening them doesn't swap the whole page out from under the charts. Tapping the dimmed area
// around the panel closes it too.
//
// In dark mode the panel (and everything drawn inside it) uses slightly lighter greys than the page behind, so it
// stands out from the dimmed background; light mode already has the contrast.

import React, { useMemo } from 'react';
import { View, Text, Pressable, StyleSheet, useWindowDimensions } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ThemeContext, ThemeContextValue, useTheme } from '../contexts/ThemeContext';
import { ContentWidthContext } from '../layout';
import HintPressable from './HintPressable';

interface Props {
  title: string;
  onClose: () => void;
  /** Long-press label for the X. */
  closeHint: string;
  maxWidth?: number;
  children: React.ReactNode;
}

const PANEL_DARK = { background: '#27272c', card: '#303037', cardBorder: '#4a4a52' };

export default function OverlayPanel({ title, onClose, closeHint, maxWidth = 1280, children }: Props) {
  const theme = useTheme();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const panelW = Math.min(width - 48, maxWidth);
  const panelH = Math.min(height - Math.max(insets.top, 24) - Math.max(insets.bottom, 24) - 24, 980);

  // Descendants read their colours from the theme, so hand them the lighter palette in dark mode.
  const panelTheme: ThemeContextValue = useMemo(
    () => (theme.scheme === 'dark' ? { ...theme, colors: { ...theme.colors, ...PANEL_DARK } } : theme),
    [theme],
  );
  const colors = panelTheme.colors;

  const styles = StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },
    panel: { width: panelW, height: panelH, backgroundColor: colors.background, borderRadius: 16, borderWidth: 1, borderColor: colors.cardBorder, overflow: 'hidden' },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.cardBorder, backgroundColor: colors.card },
    title: { color: colors.text, fontSize: 20, fontWeight: '700', flexShrink: 1, marginRight: 12 },
    close: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: colors.cardBorder, alignItems: 'center', justifyContent: 'center' },
    body: { flex: 1 },
  });

  return (
    <ThemeContext.Provider value={panelTheme}>
      <View style={styles.backdrop}>
        {/* The dimmed area is its own tap target underneath the panel. The panel is a plain View (not a Pressable)
            so that scrolling inside it is never competing with a parent touch handler. */}
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel={closeHint} />
        <View style={styles.panel}>
          <View style={styles.header}>
            <Text style={styles.title} numberOfLines={1}>{title}</Text>
            <HintPressable hint={closeHint} onPress={onClose} style={styles.close} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} accessibilityLabel={closeHint} activeOpacity={0.7}>
              <Svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={colors.muted} strokeWidth={2.4} strokeLinecap="round">
                <Path d="M5 5l14 14M19 5L5 19" />
              </Svg>
            </HintPressable>
          </View>
          <ContentWidthContext.Provider value={panelW}>
            <View style={styles.body}>{children}</View>
          </ContentWidthContext.Provider>
        </View>
      </View>
    </ThemeContext.Provider>
  );
}
