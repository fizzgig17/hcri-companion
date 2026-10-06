// src/components/VersionStamp.tsx
//
// "hCRI Companion v1.x · Built <date>" line, shown at the top of both the
// Settings and About tabs so it's in the same place on each. Values come
// from buildInfo.ts (updated with every version bump).

import React from 'react';
import { Text, StyleSheet } from 'react-native';
import { useTheme } from '../contexts/ThemeContext';
import { APP_VERSION, BUILD_DATE } from '../buildInfo';

export default function VersionStamp() {
  const { colors } = useTheme();
  const builtOn = new Date(`${BUILD_DATE}T00:00:00`).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
  const styles = StyleSheet.create({
    text: { color: colors.mutedFaint, fontSize: 11, textAlign: 'center', marginBottom: 18 },
  });
  return (
    <Text style={styles.text}>
      hCRI Companion v{APP_VERSION} · Built {builtOn}
    </Text>
  );
}
