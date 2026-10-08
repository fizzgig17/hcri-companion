// src/components/ActionBar.tsx
//
// The Home tab's pinned action bar, docked just above the app's bottom
// navigation so the main actions are always under the thumb. One big
// round button sits in the centre (Connect when disconnected, a play
// button for Take Reading when connected) with a caption underneath; the
// secondary actions (Disconnect, Test reading, Upload, Copy link) are
// quiet icon + label buttons on either side.

import React, { useRef } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useTheme } from '../contexts/ThemeContext';
import { hapticTap } from '../utils/haptics';
import type { Status } from '../screens/tabs/MainTab';

type IconName = 'play' | 'stop' | 'bluetooth' | 'upload' | 'power' | 'copy' | 'check' | 'activity' | 'live' | 'flicker' | 'save';

const ICON_PATHS: Record<Exclude<IconName, 'play' | 'stop'>, string> = {
  live: 'M21 12a9 9 0 0 0-15.5-6.2M3 12a9 9 0 0 0 15.5 6.2M21 4v5h-5M3 20v-5h5',
  flicker: 'M13 2L3 14h9l-1 8 10-12h-9l1-8z',
  save: 'M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2zM17 21v-8H7v8M7 3v5h8',
  bluetooth: 'M6.5 6.5l11 11L12 23V1l5.5 5.5-11 11',
  upload: 'M16 16l-4-4-4 4M12 12v9M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3',
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
  if (name === 'stop') {
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24">
        <Path fill={color} d="M7 5h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z" />
      </Svg>
    );
  }
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d={ICON_PATHS[name]} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
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
  /** Live (continuous spectrum) and Flicker: each button only shows when the connected meter supports it. */
  liveSupported: boolean;
  flickerSupported: boolean;
  /** Which long-running mode is active right now (the other button is disabled while one runs). */
  activeMode: 'idle' | 'live' | 'flicker';
  onToggleLive: () => void;
  onToggleFlicker: () => void;
  /** A Live reading was stopped and hasn't been saved yet -- shows the Save button. */
  canSaveLive: boolean;
  savingLive: boolean;
  onSaveLive: () => void;
}

export default function ActionBar(p: Props) {
  const { colors } = useTheme();
  const styles = StyleSheet.create({
    wrap: { paddingHorizontal: 6, paddingTop: 2, paddingBottom: 2 },
    bar: { flexDirection: 'row', alignItems: 'center' },
    slot: { flex: 1, marginBottom: 14 },
    slotLeft: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-evenly' },
    slotRight: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-evenly' },
    center: { alignItems: 'center', width: 112 },
    ring: {
      width: 58,
      height: 58,
      borderRadius: 29,
      borderWidth: 1.5,
      // Softer, see-through ring and fill: the accent at partial opacity instead of solid.
      borderColor: colors.accent + '88',
      backgroundColor: 'transparent',
      padding: 4,
    },
    inner: { flex: 1, borderRadius: 25, backgroundColor: colors.accent + 'D9', alignItems: 'center', justifyContent: 'center' },
    caption: { marginTop: 2, color: colors.accent, fontSize: 11.5, fontWeight: '700', textAlign: 'center', alignSelf: 'stretch' },
    side: { minWidth: 0, flexShrink: 1, paddingVertical: 4, paddingHorizontal: 3, alignItems: 'center', justifyContent: 'center' },
    sideLabel: { color: colors.muted, fontSize: 10.5, marginTop: 3, fontWeight: '600' },
    sideLabelAccent: { color: colors.accent },
    disabled: { opacity: 0.45 },
  });

  const { status } = p;
  const busyLabel = status === 'connecting' ? 'Connecting…' : status === 'measuring' ? 'Measuring…' : null;
  const uploadDisabled = p.uploading || !p.hasReading || p.isSample;
  const connected = status === 'connected' || status === 'uploading';
  const idle = p.activeMode === 'idle';

  const renderSide = ({
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
      <Text style={[styles.sideLabel, accent && styles.sideLabelAccent]} numberOfLines={1} adjustsFontSizeToFit>{label}</Text>
    </TouchableOpacity>
  );  // SideButton must keep one identity across renders. When it was a fresh component each render, every
  // parent re-render (a Live update every ~150ms) remounted the buttons and swallowed taps mid-press.
  const renderSideRef = useRef(renderSide);
  renderSideRef.current = renderSide;
  const SideButton = useRef((props: Parameters<typeof renderSide>[0]) => renderSideRef.current(props)).current;


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
          {busyLabel ? <ActivityIndicator color="#fff" /> : <Icon name={icon} size={icon === 'play' ? 26 : 24} color="#fff" />}
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
          {connected && idle && p.canSaveLive && (
            <SideButton icon="save" label="Save" onPress={p.onSaveLive} disabled={p.savingLive} busy={p.savingLive} accent />
          )}
          {connected && idle && !p.canSaveLive && !p.isSample && !p.uploadSucceeded && (
            <SideButton
              icon="upload"
              label="Upload reading"
              onPress={p.onUpload}
              disabled={uploadDisabled}
              busy={status === 'uploading'}
            />
          )}
          {idle && !p.canSaveLive && p.uploadSucceeded && p.canCopyLink && (
            <SideButton icon="copy" label="Copy link" onPress={p.onCopyLink} disabled={p.copyingLink} accent busy={p.copyingLink} />
          )}
          {idle && !p.canSaveLive && p.uploadSucceeded && !p.canCopyLink && <SideButton icon="check" label="Uploaded" accent />}
        </View>

        {status === 'disconnected' && mainButton('bluetooth', 'Connect to Meter', p.connect, p.onResetConnection)}
        {busyLabel && mainButton(status === 'connecting' ? 'bluetooth' : 'play', busyLabel)}
        {connected && mainButton('play', 'Take reading', idle ? p.measure : undefined)}

        <View style={[styles.slot, styles.slotRight]}>
          {connected && p.liveSupported && (
            <SideButton
              icon={p.activeMode === 'live' ? 'stop' : 'live'}
              label={p.activeMode === 'live' ? 'Stop' : 'Live'}
              onPress={p.onToggleLive}
              disabled={p.activeMode === 'flicker' || status === 'uploading'}
              accent={p.activeMode === 'live'}
            />
          )}
          {connected && p.flickerSupported && (
            <SideButton
              icon="flicker"
              label="Flicker"
              onPress={p.onToggleFlicker}
              accent={p.activeMode === 'flicker'}
            />
          )}
        </View>
      </View>
    </View>
  );
}
