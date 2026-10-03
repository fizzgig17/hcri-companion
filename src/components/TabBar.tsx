// src/components/TabBar.tsx
//
// A simple segmented tab control -- the pill-shaped row of buttons at the
// top of Home (Main / Data / Logs).

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

// Equal-width columns rather than auto-sized/wrapping chips -- this used
// to hold five tabs of very different label lengths (History, About),
// which wrapped to two rows if squeezed into even columns and so got
// left-aligned auto-width chips instead. Now that History and About are
// their own bottom-nav tabs (see App.tsx) and this is permanently just
// three short, same-length labels (Main/Data/Logs), equal columns read as
// one deliberate row instead of a cluster of buttons with empty space
// trailing off to the right.
export default function TabBar<T extends string>({ tabs, active, onChange }: Props<T>) {
  const { colors } = useTheme();

  const styles = StyleSheet.create({
    container: {
      flexDirection: 'row',
      backgroundColor: colors.card,
      borderRadius: 14,
      padding: 3,
    },
    tab: {
      flex: 1,
      paddingVertical: 8,
      borderRadius: 11,
      alignItems: 'center',
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
