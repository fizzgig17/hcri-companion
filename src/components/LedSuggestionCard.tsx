// src/components/LedSuggestionCard.tsx
//
// "Looks like Nichia 519A · 4000 K" with Yes / Other / ✕. Rendered as a floating overlay by MainTab (it never
// resizes the chart or covers the action bar) and, in a flatter form, inline under a History row.

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import HintPressable from './HintPressable';
import { useTheme } from '../contexts/ThemeContext';
import { LedSuggestion } from '../hcri/ledApi';

export function ledText(s: { brand?: string; model?: string; cct?: string | null }): string {
  const name = [s.brand, s.model].filter(Boolean).join(' ');
  const k = s.cct ? `${s.cct.replace(/\s*k$/i, '')} K` : '';
  return [name, k].filter(Boolean).join(' · ');
}

interface Props {
  suggestion: LedSuggestion;
  onYes: () => void;
  onOther: () => void;
  /** Hides the card (MainTab). In History it marks the suggestion as not wanted. */
  onClose: () => void;
  floating?: boolean;
}

export default function LedSuggestionCard({ suggestion, onYes, onOther, onClose, floating }: Props) {
  const { colors } = useTheme();
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.card, borderColor: colors.cardBorder },
        floating && styles.floating,
      ]}
    >
      <View style={styles.top}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.muted, fontSize: 11 }}>{suggestion.source === 'cct' ? 'No LED match yet · the curve reads as' : suggestion.source === 'title' ? 'Title and curve suggest' : 'Looks like'}</Text>
          <Text style={{ color: colors.text, fontSize: 15, fontWeight: '600' }} numberOfLines={2}>{ledText(suggestion)}</Text>
        </View>
        <HintPressable hint="Dismiss suggestion" onPress={onClose} hitSlop={10} accessibilityLabel="Dismiss LED suggestion">
          <Text style={{ color: colors.muted, fontSize: 18 }}>✕</Text>
        </HintPressable>
      </View>
      <View style={styles.row}>
        <TouchableOpacity onPress={onYes} style={[styles.btn, { backgroundColor: colors.accent }]}>
          <Text style={styles.yes}>Yes, that’s it</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onOther} style={[styles.btn, { borderWidth: 1, borderColor: colors.cardBorder }]}>
          <Text style={{ color: colors.text, fontSize: 14 }}>Other…</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 12, padding: 10 },
  floating: { position: 'absolute', left: 6, right: 6, bottom: 6, shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 6 },
  top: { flexDirection: 'row', alignItems: 'flex-start' },
  row: { flexDirection: 'row', marginTop: 8 },
  btn: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8, marginRight: 8 },
  yes: { color: '#fff', fontSize: 14, fontWeight: '600' },
});
