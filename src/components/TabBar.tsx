// src/components/TabBar.tsx
//
// A simple segmented tab control -- the pill-shaped row of buttons at the
// top of the screen (Main / Spectrum / Data / Logs), similar to the
// Spec./Data/Chrom./About selector in the vendor app.

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTheme } from '../contexts/ThemeContext';

interface Tab<T extends string> {
  key: T;
  label: string;
}

interface Props<T extends string> {
  tabs: Tab<T>[];
  active: T;
  onChange: (key: T) => void;
}

// A wrapping row of auto-sized chips, rather than either fixed equal-width
// columns (which squeezed "Spectrum" onto two lines once there were 6 tabs)
// or a horizontally-scrolling row (which hid Logs -- and whichever tab is
// added next -- off the right edge, needing a swipe to reach). Wrapping
// keeps every tab a single tap away with nothing to scroll, at the cost of
// the bar taking two rows once things don't fit on one -- a fine trade,
// and one that keeps working the same way as more tabs get added later.
export default function TabBar<T extends string>({ tabs, active, onChange }: Props<T>) {
  const { colors } = useTheme();

  const styles = StyleSheet.create({
    container: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      backgroundColor: colors.card,
      borderRadius: 16,
      padding: 4,
      marginBottom: 16,
    },
    tab: {
      paddingVertical: 8,
      paddingHorizontal: 14,
      borderRadius: 14,
      alignItems: 'center',
      margin: 2,
    },
    tabActive: {
      backgroundColor: colors.accent,
    },
    tabText: {
      color: colors.muted,
      fontSize: 13,
      fontWeight: '600',
    },
    tabTextActive: {
      color: colors.text,
    },
  });

  return (
    <View style={styles.container}>
      {tabs.map((t) => {
        const isActive = t.key === active;
        return (
          <TouchableOpacity
            key={t.key}
            style={[styles.tab, isActive && styles.tabActive]}
            onPress={() => onChange(t.key)}
            activeOpacity={0.7}
          >
            <Text style={[styles.tabText, isActive && styles.tabTextActive]} numberOfLines={1}>
              {t.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}
