// src/components/UpdateBanner.tsx
//
// One banner, docked full-width just under the status bar and slightly
// see-through, shown only when the launch check (or the test button) found a
// newer version in Google Play. It slides down into place. "Update now" jumps
// to Settings > Update and starts the update; the x hides it until the next
// launch.

import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../contexts/ThemeContext';
import { useUpdate } from '../contexts/UpdateContext';
import { navigationRef } from '../navigationRef';

const SLIDE_FROM = -72;

export default function UpdateBanner() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { status, bannerEligible, bannerDismissed, dismissBanner } = useUpdate();
  const visible = status === 'available' && bannerEligible && !bannerDismissed;
  const slide = useRef(new Animated.Value(SLIDE_FROM)).current;

  useEffect(() => {
    if (visible) {
      slide.setValue(SLIDE_FROM);
      Animated.timing(slide, { toValue: 0, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    }
  }, [visible, slide]);

  if (!visible) return null;

  const styles = StyleSheet.create({
    wrap: {
      position: 'absolute',
      top: insets.top,
      left: 0,
      right: 0,
      zIndex: 50,
      elevation: 8,
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.accent + 'CC',
      borderBottomWidth: 1,
      borderBottomColor: 'rgba(255,255,255,0.35)',
      paddingVertical: 8,
      paddingLeft: 16,
      paddingRight: 6,
    },
    text: { flex: 1, color: '#fff', fontSize: 13, fontWeight: '700' },
    action: { backgroundColor: 'rgba(255,255,255,0.95)', borderRadius: 8, paddingVertical: 6, paddingHorizontal: 12, marginLeft: 8 },
    actionText: { color: '#1f7a59', fontSize: 13, fontWeight: '800' },
    close: { paddingHorizontal: 10, paddingVertical: 2 },
    closeText: { color: '#fff', fontSize: 20, fontWeight: '700' },
  });

  const updateNow = () => {
    if (navigationRef.isReady()) {
      navigationRef.navigate('Tabs', { screen: 'Settings', params: { autoUpdate: Date.now() } });
    }
  };

  return (
    <Animated.View style={[styles.wrap, { transform: [{ translateY: slide }] }]} accessibilityRole="alert">
      <Text style={styles.text}>A new version is available</Text>
      <TouchableOpacity style={styles.action} onPress={updateNow} accessibilityLabel="Update now">
        <Text style={styles.actionText}>Update now</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.close} onPress={dismissBanner} accessibilityLabel="Dismiss">
        <Text style={styles.closeText}>×</Text>
      </TouchableOpacity>
    </Animated.View>
  );
}
