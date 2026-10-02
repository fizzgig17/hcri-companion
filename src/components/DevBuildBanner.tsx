// src/components/DevBuildBanner.tsx
//
// Thin colored strip at the very top of the app, above the navigator (see
// App.tsx), so it's visible on every screen rather than just Home. Only
// renders anything for a non-production build -- IS_DEV_BUILD/HCRI_API_HOST
// come from hcri/buildTarget.ts, NOT apiConfig.ts directly (see that
// file's own comment for why: deploy-dev.yml/deploy-master.yml replace
// apiConfig.ts's entire contents, not just HCRI_API_BASE's value, so
// anything else exported from THAT file specifically never survives into
// the built APK -- this needs no setup/flag of its own and can't drift out
// of sync with which server a build actually uploads to).
//
// Exists so a dev-built APK (sideloaded for testing, sitting on a phone
// next to the real app) is never mistaken for production at a glance --
// e.g. right before taking/uploading a real-world reading.

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { IS_DEV_BUILD, HCRI_API_HOST } from '../hcri/buildTarget';

export default function DevBuildBanner() {
  if (!IS_DEV_BUILD) return null;

  return (
    // edges=['top'] only -- this sits above the navigator, which still
    // draws its own header/content below; we just need the status-bar
    // inset reserved so the banner text itself isn't drawn under the
    // clock/notch.
    <SafeAreaView edges={['top']} style={styles.safeArea}>
      <View style={styles.bar}>
        <Text style={styles.text} numberOfLines={1}>
          DEV BUILD — {HCRI_API_HOST}
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  // Background has to match the bar's own color, not the app's, or the
  // status-bar inset area above the bar renders as a mismatched stripe.
  safeArea: { backgroundColor: '#8a3b00' },
  bar: {
    backgroundColor: '#8a3b00', // distinct from theme.ts's warning/danger
    paddingVertical: 4,
    alignItems: 'center',
  },
  text: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
});
