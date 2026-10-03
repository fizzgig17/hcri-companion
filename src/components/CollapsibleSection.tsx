// src/components/CollapsibleSection.tsx
//
// A reusable expand/collapse card, used for both the spectrum readings list
// and the debug log -- anything long and secondary that shouldn't be shown
// by default, but should be one tap away.

import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTheme } from '../contexts/ThemeContext';

interface Props {
  title: string;
  /** Optional count shown next to the title, e.g. "(451)". */
  count?: number;
  defaultExpanded?: boolean;
  children: React.ReactNode;
}

export default function CollapsibleSection({ title, count, defaultExpanded = false, children }: Props) {
  const { colors } = useTheme();
  const [expanded, setExpanded] = useState(defaultExpanded);

  const styles = StyleSheet.create({
    card: {
      backgroundColor: colors.card,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      marginTop: 12,
      overflow: 'hidden',
    },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: 12,
      paddingHorizontal: 14,
    },
    title: { color: colors.text, fontSize: 14, fontWeight: '600' },
    count: { color: colors.muted, fontWeight: '400' },
    chevron: { color: colors.muted, fontSize: 14 },
    body: {
      paddingHorizontal: 14,
      paddingBottom: 12,
      borderTopWidth: 1,
      borderTopColor: colors.cardBorder,
    },
  });

  return (
    <View style={styles.card}>
      <TouchableOpacity style={styles.header} onPress={() => setExpanded((e) => !e)} activeOpacity={0.7}>
        <Text style={styles.title}>
          {title}
          {count !== undefined ? <Text style={styles.count}> ({count})</Text> : null}
        </Text>
        <Text style={styles.chevron}>{expanded ? '▾' : '▸'}</Text>
      </TouchableOpacity>
      {expanded && <View style={styles.body}>{children}</View>}
    </View>
  );
}
