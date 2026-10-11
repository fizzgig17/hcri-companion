// src/screens/PhotoScreen.tsx
//
// "See it on a photo" (iPad): the reading's own per-hue shifts (TM-30 Rcs,hj / Rhs,hj) applied to a photo, with a
// draggable divider between the reference colours and how this light renders them. It is hcri.io's photo tool
// (src/photo/photoScript.ts) running in a WebView, fed by the same TM-30 calculation the report uses, so the
// result matches the website. Photos are processed on the device and never uploaded.
// Opened with navigation.navigate('Photo', { input }).

import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { WebView } from 'react-native-webview';
import OverlayPanel from '../components/OverlayPanel';
import { useTheme } from '../contexts/ThemeContext';
import type { Tm30Input } from '../utils/tm30Report';
import { buildPhotoHtml } from '../photo/photoHtml';

export default function PhotoScreen({ route, navigation }: any) {
  const { colors } = useTheme();
  const input: Tm30Input = route.params.input;
  const built = useMemo(() => {
    try {
      return { html: buildPhotoHtml(input, { bg: colors.background, text: colors.text, dim: colors.muted, border: colors.cardBorder, accent: colors.accent }), error: null as string | null };
    } catch (e: any) {
      return { html: '', error: e?.message ?? 'Could not build the page.' };
    }
  }, [input, colors]);

  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    web: { flex: 1, backgroundColor: colors.background },
    err: { color: colors.text, padding: 20, fontSize: 14 },
  });

  return (
    <OverlayPanel title="See it on a photo" closeHint="Close photo" onClose={() => navigation.goBack()} maxWidth={1180}>
      <View style={styles.container}>
        {built.error ? (
          <Text style={styles.err}>{built.error}</Text>
        ) : (
          <WebView style={styles.web} originWhitelist={['*']} source={{ html: built.html }} overScrollMode="never" allowFileAccess />
        )}
      </View>
    </OverlayPanel>
  );
}
