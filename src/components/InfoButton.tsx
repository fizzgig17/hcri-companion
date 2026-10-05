// src/components/InfoButton.tsx
//
// A small round "i" that opens a short explanatory Alert. Used for the
// app-wide help next to the top tab bar and for the test-reading button.

import React from 'react';
import { TouchableOpacity, Text, Alert, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import { useTheme } from '../contexts/ThemeContext';

interface Props {
  title: string;
  message: string;
  style?: StyleProp<ViewStyle>;
}

export default function InfoButton({ title, message, style }: Props) {
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
    text: { color: colors.muted, fontSize: 15, fontWeight: '700', fontStyle: 'italic' },
  });
  return (
    <TouchableOpacity
      onPress={() => Alert.alert(title, message)}
      style={[styles.button, style]}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      accessibilityLabel={title}
      activeOpacity={0.7}
    >
      <Text style={styles.text}>i</Text>
    </TouchableOpacity>
  );
}
