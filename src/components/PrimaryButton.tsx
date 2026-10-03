// src/components/PrimaryButton.tsx
//
// The main accent/muted action button used across every tab (Connect, Take
// Reading, Disconnect, Upload...). Pulled out on its own since more than
// one tab file needs it now that the screen is split into tabs.

import React from 'react';
import { TouchableOpacity, Text, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import { useTheme } from '../contexts/ThemeContext';

interface Props {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  variant?: 'accent' | 'muted' | 'danger';
  /** Extra/override styles -- e.g. to drop the default marginTop when this button sits inline next to other content instead of stacked full-width below it. */
  style?: StyleProp<ViewStyle>;
}

export default function PrimaryButton({ title, onPress, disabled, variant = 'accent', style }: Props) {
  const { colors } = useTheme();

  const styles = StyleSheet.create({
    button: {
      borderRadius: 10,
      paddingVertical: 14,
      paddingHorizontal: 20,
      alignItems: 'center',
      marginTop: 8,
    },
    buttonAccent: { backgroundColor: colors.accent },
    buttonMuted: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.cardBorder },
    // Outlined rather than solid-filled -- "Forget Credentials" is a
    // destructive but infrequent action, not something that should compete
    // visually with Save for attention every time this screen is opened.
    buttonDanger: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.danger },
    buttonDisabled: { opacity: 0.5 },
    buttonText: { color: colors.text, fontSize: 15, fontWeight: '600' },
    buttonTextDanger: { color: colors.danger },
  });

  return (
    <TouchableOpacity
      style={[
        styles.button,
        variant === 'muted' ? styles.buttonMuted : variant === 'danger' ? styles.buttonDanger : styles.buttonAccent,
        disabled && styles.buttonDisabled,
        style,
      ]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.8}
    >
      <Text style={[styles.buttonText, variant === 'danger' && styles.buttonTextDanger]}>{title}</Text>
    </TouchableOpacity>
  );
}
