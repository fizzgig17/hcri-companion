// src/components/UpdateBanner.tsx
//
// One banner, docked right under the DEV BUILD strip (or the status bar on
// production builds), overlaying the app without moving it. Shown only when the launch check (or the test button) found a newer version
// in Google Play; it slides open. "Open Play Store" opens the app's Play Store
// listing, where the update is installed; the x hides it until the next launch.

import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import HintPressable from './HintPressable';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../contexts/ThemeContext';
import { useBannerVisible } from '../contexts/UpdateContext';
import { useUpdate } from '../contexts/UpdateContext';
import { IS_DEV_BUILD } from '../hcri/buildTarget';

const BAR_H = 60;
// Blue, so it never blends into the green accent (active tab, buttons) or the brown dev strip above it.
const BANNER_BLUE = '#1d5fd1';

export default function UpdateBanner() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { dismissBanner, openStore } = useUpdate();
  const visible = useBannerVisible();
  const open = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(open, {
      toValue: visible ? 1 : 0,
      duration: 260,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [visible, open]);

  // Production builds have no dev strip above, so the banner clears the status bar itself.
  const topPad = IS_DEV_BUILD ? 0 : insets.top;
  const translateY = open.interpolate({ inputRange: [0, 1], outputRange: [-(BAR_H + topPad), 0] });

  const styles = StyleSheet.create({
    // Overlays the app (never pushes it down): a zero-height slot in the flow, with the bar hanging
    // from it. Solid color, no shadow/elevation, so nothing shows through.
    slot: { height: 0, zIndex: 50 },
    clip: { position: 'absolute', top: 0, left: 0, right: 0, backgroundColor: BANNER_BLUE, borderBottomWidth: 1, borderBottomColor: 'rgba(0,0,0,0.25)' },
    bar: { height: BAR_H, flexDirection: 'row', alignItems: 'center', paddingLeft: 16, paddingRight: 8 },
    text: { flex: 1, color: '#fff', fontSize: 16, fontWeight: '700' },
    action: { backgroundColor: '#fff', borderRadius: 10, paddingVertical: 10, paddingHorizontal: 16, marginLeft: 8 },
    actionText: { color: BANNER_BLUE, fontSize: 15, fontWeight: '800' },
    close: { paddingHorizontal: 12, paddingVertical: 6 },
    closeText: { color: '#fff', fontSize: 26, fontWeight: '600', lineHeight: 28 },
  });

  return (
    <View style={styles.slot} pointerEvents="box-none">
    <Animated.View style={[styles.clip, { transform: [{ translateY }], opacity: visible ? 1 : 0 }]} pointerEvents={visible ? 'auto' : 'none'}>
      <View style={{ paddingTop: topPad }}>
        <View style={styles.bar} accessibilityRole="alert">
          <Text style={styles.text} numberOfLines={1}>A new version is available</Text>
          <TouchableOpacity style={styles.action} onPress={openStore} accessibilityLabel="Open Play Store to update">
            <Text style={styles.actionText}>Open Play Store</Text>
          </TouchableOpacity>
          <HintPressable hint="Dismiss" style={styles.close} onPress={dismissBanner} accessibilityLabel="Dismiss">
            <Text style={styles.closeText}>×</Text>
          </HintPressable>
        </View>
      </View>
    </Animated.View>
    </View>
  );
}
