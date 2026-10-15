// src/components/AppSwitch.tsx
//
// React Native's <Switch> with the app's colours. On Android in light
// mode the default "off" track is a very pale grey and the thumb is
// near-white, so an un-toggled switch all but disappears against a white
// card. This gives the off state a clearly visible grey track (and a
// white thumb with Android's own shadow) in light mode. iOS keeps its
// native off look, which already has a visible outline, and dark mode is
// unchanged.

import React from 'react';
import { Platform, Switch, SwitchProps } from 'react-native';
import { useTheme } from '../contexts/ThemeContext';

const LIGHT_OFF_TRACK = '#a7afbb';
const LIGHT_OFF_THUMB = '#ffffff';

export default function AppSwitch(props: SwitchProps) {
  const { colors, scheme } = useTheme();
  const androidLight = Platform.OS === 'android' && scheme === 'light';
  return (
    <Switch
      trackColor={{ true: colors.accent, ...(androidLight ? { false: LIGHT_OFF_TRACK } : {}) }}
      {...(androidLight && !props.value ? { thumbColor: LIGHT_OFF_THUMB } : {})}
      {...props}
    />
  );
}
