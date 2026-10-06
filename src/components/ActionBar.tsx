// src/components/ActionBar.tsx
//
// The Home tab's pinned action bar, docked just above the app's bottom
// navigation so the main actions are always under the thumb. One big
// round button sits in the centre (Connect when disconnected, a play
// button for Take Reading when connected) with a caption underneath; the
// secondary actions (Disconnect, Test reading, Upload, Copy link) are
// quiet icon + label buttons on either side.

import React from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useTheme } from '../contexts/ThemeContext';
import { hapticTap } from '../utils/haptics';
import type { Status } from '../screens/tabs/MainTab';

type IconName = 'play' | 'bluetooth' | 'upload' | 'power' | 'copy' | 'check' | 'activity';

const ICON_PATHS: Record<Exclude<IconName, 'play'>, string> = {
  bluetooth: 'M6.5 6.5l11 11L12 23V1l5.5 5.5-11 11',
  upload: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12',
  power: 'M18.36 6.64a9 9 0 1 1-12.73 0M12 2v10',
  copy: 'M9 9h11v11H9zM5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1',
  check: 'M20 6L9 17l-5-5',
  activity: 'M22 12h-4l-3 9L9 3l-3 9H2',
};

function Icon({ name, size, color }: { name: IconName; size: number; color: string }) {
  if (name === 'play') {
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24">
        <Path
          fill={color}
          d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"
        />
      </Svg>
    );
  }
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d={ICON_PATHS[name]} />
    </Svg>
  );
}

interface Props {
  status: Status;
  hasReading: boolean;
  isSample: boolean;
  connect: () => void;
  measure: () => void;
  disconnect: () => void;
  onShowTestReading: () => void;
  loadingTestReading: boolean;
  onUpload: () => void;
  uploading: boolean;
  uploadSucceeded: boolean;
  canCopyLink: boolean;
  copyingLink: boolean;
  onCopyLink: () => void;
  /** Long-press Connect: clear a stale BLE connection and retry. */
  onResetConnection: () => void;
}

export default function ActionBar(p: Props) {
  const { colors } = useTheme();
  const styles = StyleSheet.create({
    wrap: { paddingHorizontal: 12, paddingTop: 4, paddingBottom: 6 },
    bar: { flexDirection: 'row', alignItems: 'center' },
    slot: { flex: 1, marginBottom: 16 },
    slotLeft: { alignItems: 'flex-start' },
    slotRight: { alignItems: 'flex-end' },
    center: { alignItems: 'center', width: 150 },
    ring: {
      width: 72,
      height: 72,
      borderRadius: 36,
      borderWidth: 3,
      borderColor: colors.accent,
      backgroundColor: colors.card,
      padding: 4,
      elevation: 4,
      shadowColor: '#000',
      shadowOpacity: 0.2,
      shadowRadius: 6,
      shadowOffset: { width: 0, height: 2 },
    },
    inner: { flex: 1, borderRadius: 32, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
    caption: { marginTop: 4, color: colors.accent, fontSize: 11.5, fontWeight: '700', textAlign: 'center', alignSelf: 'stretch' },
    side: { minWidth: 64, paddingVertical: 4, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center' },
    sideLabel: { color: colors.muted, fontSize: 11, marginTop: 3, fontWeight: '600' },
    sideLabelAccent: { color: colors.accent },
    disabled: { opacity: 0.45 },
  });

  const { status } = p;
  const busyLabel = status === 'connecting' ? 'Connecting…' : status === 'measuring' ? 'Measuring…' : null;
  const uploadDisabled = p.uploading || !p.hasReading || p.isSample;
  const connected = status === 'connected' || status === 'uploading';

  const SideButton = ({
    icon,
    label,
    onPress,
    disabled,
    accent,
    busy,
  }: {
    icon: IconName;
    label: string;
    onPress?: () => void;
    disabled?: boolean;
    accent?: boolean;
    busy?: boolean;
  }) => (
    <TouchableOpacity
      style={[styles.side, disabled && styles.disabled]}
      onPress={onPress && (() => { hapticTap(); onPress(); })}
      disabled={disabled || !onPress}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {busy ? (
        <ActivityIndicator size="small" color={accent ? colors.accent : colors.muted} />
      ) : (
        <Icon name={icon} size={22} color={accent ? colors.accent : colors.muted} />
      )}
      <Text style={[styles.sideLabel, accent && styles.sideLabelAccent]} numberOfLines={1}>{label}</Text>
    </TouchableOpacity>
  );

  // The big round centre button: icon, or a spinner while busy.
  const mainButton = (icon: IconName, caption: string, onPress?: () => void, onLongPress?: () => void) => (
    <View style={styles.center}>
      <TouchableOpacity
        style={[styles.ring, !onPress && styles.disabled]}
        onPress={onPress && (() => { hapticTap(); onPress(); })}
        onLongPress={onLongPress && (() => { hapticTap(); onLongPress(); })}
        disabled={!onPress}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel={caption}
      >
        <View style={[styles.inner, icon === 'play' && { paddingLeft: 3 }]}>
          {busyLabel ? <ActivityIndicator color="#fff" /> : <Icon name={icon} size={icon === 'play' ? 30 : 28} color="#fff" />}
        </View>
      </TouchableOpacity>
      <Text style={styles.caption} numberOfLines={1} adjustsFontSizeToFit>{caption}</Text>
    </View>
  );

  return (
    <View style={styles.wrap}>
      <View style={styles.bar}>
        <View style={[styles.slot, styles.slotLeft]}>
          {connected && <SideButton icon="power" label="Disconnect" onPress={p.disconnect} />}
          {status === 'disconnected' && (
            <SideButton
              icon="activity"
              label={p.loadingTestReading ? 'Loading…' : 'Test reading'}
              onPress={p.onShowTestReading}
              disabled={p.loadingTestReading}
            />
          )}
        </View>

        {status === 'disconnected' && mainButton('bluetooth', 'Connect to Meter', p.connect, p.onResetConnection)}
        {busyLabel && mainButton(status === 'connecting' ? 'bluetooth' : 'play', busyLabel)}
        {connected && mainButton('play', 'Take reading', p.measure)}

        <View style={[styles.slot, styles.slotRight]}>
          {connected && !p.isSample && !p.uploadSucceeded && (
            <SideButton
              icon="upload"
              label="Upload"
              onPress={p.onUpload}
              disabled={uploadDisabled}
              busy={status === 'uploading'}
            />
          )}
          {p.uploadSucceeded && p.canCopyLink && (
            <SideButton icon="copy" label="Copy link" onPress={p.onCopyLink} disabled={p.copyingLink} accent busy={p.copyingLink} />
          )}
          {p.uploadSucceeded && !p.canCopyLink && <SideButton icon="check" label="Uploaded" accent />}
        </View>
      </View>
    </View>
  );
}
