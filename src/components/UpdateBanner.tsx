// src/components/UpdateBanner.tsx
//
// A floating grey capsule that slides down from the top and hovers just below the top edge
// (below the DEV BUILD strip, or the status bar on production builds), overlaying the app without
// moving it. Shown only when the launch check (or the test button) found a newer version in Google
// Play. "Update" opens the app's Play Store listing, where the update is installed; the x hides it
// until the next launch. Light grey on the dark theme, darker slate on the light theme; the Update
// pill is blue so it reads as the action.

import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Platform, Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import HintPressable from './HintPressable';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../contexts/ThemeContext';
import { useBannerVisible } from '../contexts/UpdateContext';
import { useUpdate } from '../contexts/UpdateContext';
import { IS_DEV_BUILD } from '../hcri/buildTarget';

const CAPSULE_H = 48;
const HOVER_GAP = 8; // space between the top (strip / status bar) and the hovering capsule
const BLUE_DARK_THEME = '#2a63d8';
const BLUE_LIGHT_THEME = '#3d7af0';

export default function UpdateBanner() {
  const { scheme } = useTheme();
  const insets = useSafeAreaInsets();
  const { dismissBanner, openStore } = useUpdate();
  const visible = useBannerVisible();
  const open = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(open, {
      toValue: visible ? 1 : 0,
      duration: 340,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [visible, open]);

  // Production builds have no dev strip above, so the capsule clears the status bar itself.
  const topPad = (IS_DEV_BUILD ? 0 : insets.top) + HOVER_GAP;
  const translateY = open.interpolate({ inputRange: [0, 1], outputRange: [-(CAPSULE_H + topPad + 20), 0] });

  const opacity = open.interpolate({ inputRange: [0, 0.25, 1], outputRange: [0, 1, 1] });
  const storeName = Platform.OS === 'ios' ? 'App Store' : 'Play Store';

  const light = scheme === 'light';
  const capsuleBg = light ? '#4b5160' : '#d6d6dc';
  const textColor = light ? '#ffffff' : '#1a1a1e';
  const xColor = light ? '#c3c8d2' : '#5d6068';
  const blue = light ? BLUE_LIGHT_THEME : BLUE_DARK_THEME;

  const styles = StyleSheet.create({
    // Overlays the app (never pushes it down): a zero-height slot in the flow, with the capsule hanging from it.
    slot: { height: 0, zIndex: 50, elevation: 50 },
    wrap: { position: 'absolute', top: 0, left: 0, right: 0, paddingTop: topPad, paddingHorizontal: 40 },
    capsule: {
      height: CAPSULE_H,
      borderRadius: CAPSULE_H / 2,
      backgroundColor: capsuleBg,
      flexDirection: 'row',
      alignItems: 'center',
      paddingLeft: 18,
      paddingRight: 6,
      ...Platform.select({
        ios: {
          shadowColor: light ? '#16223c' : '#000',
          shadowOpacity: light ? 0.28 : 0.55,
          shadowRadius: 14,
          shadowOffset: { width: 0, height: 8 },
        },
        default: { elevation: 10 },
      }),
    },
    text: { flex: 1, color: textColor, fontSize: 14, fontWeight: '700' },
    action: { backgroundColor: blue, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 16, minHeight: 36, justifyContent: 'center', marginLeft: 8 },
    actionText: { color: '#fff', fontSize: 14, fontWeight: '700' },
    close: { width: 32, height: 36, alignItems: 'center', justifyContent: 'center' },
    closeText: { color: xColor, fontSize: 24, fontWeight: '600', lineHeight: 26 },
  });

  return (
    <View style={styles.slot} pointerEvents="box-none">
      <Animated.View
        style={[styles.wrap, { transform: [{ translateY }], opacity }]}
        pointerEvents={visible ? 'box-none' : 'none'}
      >
        <View style={styles.capsule} accessibilityRole="alert">
          <Text style={styles.text} numberOfLines={1}>Update available</Text>
          <TouchableOpacity style={styles.action} onPress={openStore} accessibilityLabel={`Open ${storeName} to update`}>
            <Text style={styles.actionText}>Update</Text>
          </TouchableOpacity>
          <HintPressable hint="Dismiss" style={styles.close} onPress={dismissBanner} accessibilityLabel="Dismiss">
            <Text style={styles.closeText}>×</Text>
          </HintPressable>
        </View>
      </Animated.View>
    </View>
  );
}
