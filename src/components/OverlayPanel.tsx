// src/components/OverlayPanel.tsx
//
// A large centred panel over a dimmed backdrop, with a title and an X to close it. Tablet-only presentation for
// Settings and "See it on a photo" (App.tsx shows them as transparent modal screens), so opening them no longer
// swaps the whole page out from under the charts. Tapping the backdrop closes it too.

import React from 'react';
import { View, Text, Pressable, StyleSheet, useWindowDimensions } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../contexts/ThemeContext';
import HintPressable from './HintPressable';

interface Props {
  title: string;
  onClose: () => void;
  /** Long-press label for the X. */
  closeHint: string;
  maxWidth?: number;
  children: React.ReactNode;
}

export default function OverlayPanel({ title, onClose, closeHint, maxWidth = 1280, children }: Props) {
  const { colors } = useTheme();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const panelW = Math.min(width - 48, maxWidth);
  const panelH = Math.min(height - Math.max(insets.top, 24) - Math.max(insets.bottom, 24) - 24, 980);

  const styles = StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },
    panel: { width: panelW, height: panelH, backgroundColor: colors.background, borderRadius: 16, borderWidth: 1, borderColor: colors.cardBorder, overflow: 'hidden' },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.cardBorder, backgroundColor: colors.card },
    title: { color: colors.text, fontSize: 20, fontWeight: '700' },
    close: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: colors.cardBorder, alignItems: 'center', justifyContent: 'center' },
    body: { flex: 1 },
  });

  return (
    <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel={closeHint}>
      {/* The panel swallows taps so only the dimmed area around it closes the overlay. */}
      <Pressable style={styles.panel} onPress={() => {}}>
        <View style={styles.header}>
          <Text style={styles.title}>{title}</Text>
          <HintPressable hint={closeHint} onPress={onClose} style={styles.close} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} accessibilityLabel={closeHint} activeOpacity={0.7}>
            <Svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={colors.muted} strokeWidth={2.4} strokeLinecap="round">
              <Path d="M5 5l14 14M19 5L5 19" />
            </Svg>
          </HintPressable>
        </View>
        <View style={styles.body}>{children}</View>
      </Pressable>
    </Pressable>
  );
}
