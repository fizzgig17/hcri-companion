// src/components/InfoButton.tsx
//
// A small round "?" that opens a short explanatory Alert (app-wide help
// next to the top tab bar), or -- when `label` is given -- a small text link
// that does the same ("What's this?" under the test-reading button).

import React from 'react';
import { TouchableOpacity, Text, Alert, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import { useTheme } from '../contexts/ThemeContext';
import HintPressable from './HintPressable';

interface Props {
  title: string;
  message: string;
  /** When set, renders a small centered text link with this text instead of the round "?". */
  label?: string;
  style?: StyleProp<ViewStyle>;
}

export default function InfoButton({ title, message, label, style }: Props) {
  const { colors } = useTheme();
  const styles = StyleSheet.create({
    button: {
      width: 32,
      height: 32,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      alignItems: 'center',
      justifyContent: 'center',
    },
    text: { color: colors.muted, fontSize: 15, fontWeight: '700' },
    link: { alignSelf: 'center', paddingVertical: 6 },
    linkText: { color: colors.muted, fontSize: 12, textDecorationLine: 'underline' },
  });
  if (label) {
    return (
      <TouchableOpacity
        onPress={() => Alert.alert(title, message)}
        style={[styles.link, style]}
        hitSlop={{ top: 6, bottom: 6, left: 12, right: 12 }}
        accessibilityLabel={title}
        activeOpacity={0.7}
      >
        <Text style={styles.linkText}>{label}</Text>
      </TouchableOpacity>
    );
  }
  return (
    <HintPressable
      hint="More info"
      onPress={() => Alert.alert(title, message)}
      style={[styles.button, style]}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      accessibilityLabel={title}
      activeOpacity={0.7}
    >
      <Text style={styles.text}>?</Text>
    </HintPressable>
  );
}
