// src/components/SplashTitle.tsx
//
// A brief in-app title screen shown over the app as it starts (Android's
// own system splash can only show the launcher icon, never text). The app
// keeps loading and auto-connecting underneath it; this just fades out
// after a moment. Rendered once per app launch.

import React, { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text } from 'react-native';
import { useTheme } from '../contexts/ThemeContext';

const HOLD_MS = 1100;
const FADE_MS = 350;

export default function SplashTitle() {
  const { colors } = useTheme();
  const opacity = useRef(new Animated.Value(1)).current;
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      Animated.timing(opacity, { toValue: 0, duration: FADE_MS, useNativeDriver: true }).start(() => setVisible(false));
    }, HOLD_MS);
    return () => clearTimeout(timer);
  }, [opacity]);

  if (!visible) return null;

  const styles = StyleSheet.create({
    overlay: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: colors.background,
      alignItems: 'center',
      justifyContent: 'center',
    },
    title: { color: colors.text, fontSize: 30, fontWeight: '700' },
    accent: { color: colors.accent },
    subtitle: { color: colors.muted, fontSize: 14, marginTop: 6 },
  });

  return (
    <Animated.View style={[styles.overlay, { opacity }]} pointerEvents="auto">
      <Text style={styles.title}>
        <Text style={styles.accent}>hCRI</Text> Companion
      </Text>
      <Text style={styles.subtitle}>Spectrometer readings for hCRI.io</Text>
    </Animated.View>
  );
}
