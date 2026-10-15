// src/components/ActionBar.tsx
//
// The Home tab's pinned action bar, docked just above the app's bottom
// navigation so the main actions are always under the thumb. One big
// round button sits in the centre (Connect when disconnected, a play
// button for Take Reading when connected) with a caption underneath; the
// secondary actions (Disconnect, Test reading, Upload, Copy link) are
// quiet icon + label buttons on either side.

import { ICONS, ICON_SIZE } from './icons';
import React, { useRef } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useTheme } from '../contexts/ThemeContext';
import { hapticTap } from '../utils/haptics';
import type { Status } from '../screens/tabs/MainTab';

type IconName = 'play' | 'stop' | 'bluetooth' | 'upload' | 'power' | 'copy' | 'check' | 'activity' | 'live' | 'flicker' | 'save' | 'report' | 'photo';

// Paths come from the shared icon set (components/icons.tsx).
const ICON_PATHS: Record<Exclude<IconName, 'play' | 'stop'>, string> = {
  live: ICONS.live,
  flicker: ICONS.bolt,
  report: ICONS.report,
  photo: ICONS.photo,
  save: ICONS.save,
  bluetooth: ICONS.bluetooth,
  upload: ICONS.upload,
  power: ICONS.power,
  copy: ICONS.copy,
  check: ICONS.check,
  activity: ICONS.activity,
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
  onCancelConnect?: () => void;
  measure: () => void;
  /** ColorMunki behind the bridge: replaces the centre button's caption/colour/enabled state, and a note shows above the bar. */
  mainOverride?: { caption: string; tint?: string; disabled?: boolean };
  meterNote?: string;
  /** Caption while busy, when it is not a reading ("Calibrating…"). */
  busyCaption?: string;
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
  /** A test reading whose report has flicker: the Flicker button shows (view only) even with no meter connected. */
  sampleHasFlicker?: boolean;
  /** Which long-running mode is active right now (the other button is disabled while one runs). */
  activeMode: 'idle' | 'live' | 'flicker';
  onToggleLive: () => void;
  onToggleFlicker: () => void;
  /** A Live reading was stopped and hasn't been saved yet -- shows the Save button. */
  canSaveLive: boolean;
  savingLive: boolean;
  onSaveLive: () => void;
  /** Opens the in-app TM-30 report for the current reading. */
  onShowTm30: () => void;
  /** iPad only: opens "See it on a photo" for the current reading. Omit to hide the button. */
  onShowPhoto?: () => void;
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
    note: { color: colors.muted, fontSize: 12.5, fontWeight: '600', textAlign: 'center', paddingHorizontal: 10, marginTop: 2, marginBottom: 6 },
  });

  const { status } = p;
  const busyLabel = status === 'connecting' ? 'Connecting…' : status === 'measuring' ? (p.busyCaption ?? 'Measuring…') : null;
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
        <Icon name={icon} size={ICON_SIZE.primary} color={accent ? colors.accent : colors.muted} />
      )}
      <Text style={[styles.sideLabel, accent && styles.sideLabelAccent]} numberOfLines={1} adjustsFontSizeToFit>{label}</Text>
    </TouchableOpacity>
  );  // SideButton must keep one identity across renders. When it was a fresh component each render, every
  // parent re-render (a Live update every ~150ms) remounted the buttons and swallowed taps mid-press.
  const renderSideRef = useRef(renderSide);
  renderSideRef.current = renderSide;
  const SideButton = useRef((props: Parameters<typeof renderSide>[0]) => renderSideRef.current(props)).current;


  // The big round centre button: icon, or a spinner while busy.
  const mainButton = (icon: IconName, caption: string, onPress?: () => void, onLongPress?: () => void, tint?: string) => (
    <View style={styles.center}>
      <TouchableOpacity
        style={[styles.ring, tint && { borderColor: tint + '88' }, !onPress && styles.disabled]}
        onPress={onPress && (() => { hapticTap(); onPress(); })}
        onLongPress={onLongPress && (() => { hapticTap(); onLongPress(); })}
        disabled={!onPress}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel={caption}
      >
        <View style={[styles.inner, tint && { backgroundColor: tint + 'D9' }, icon === 'play' && { paddingLeft: 3 }]}>
          {busyLabel ? <ActivityIndicator color="#fff" /> : <Icon name={icon} size={icon === 'play' ? 26 : 24} color="#fff" />}
        </View>
      </TouchableOpacity>
      <Text style={[styles.caption, tint && { color: tint }]} numberOfLines={1} adjustsFontSizeToFit>{caption}</Text>
    </View>
  );

  return (
    <View style={styles.wrap}>
      {connected && p.meterNote ? <Text style={styles.note}>{p.meterNote}</Text> : null}
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
        {busyLabel && (status === 'connecting'
          ? mainButton('bluetooth', 'Tap to cancel', p.onCancelConnect)
          : mainButton('play', busyLabel))}
        {connected && (p.mainOverride
          ? mainButton('play', p.mainOverride.caption, p.mainOverride.disabled || !idle ? undefined : p.measure, undefined, p.mainOverride.tint)
          : mainButton('play', 'Take reading', idle ? p.measure : undefined))}

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
          {((connected && p.flickerSupported) || (p.isSample && p.sampleHasFlicker)) && (
            <SideButton
              icon="flicker"
              label="Flicker"
              onPress={p.onToggleFlicker}
              accent={p.activeMode === 'flicker'}
            />
          )}
          {idle && p.hasReading && !p.canSaveLive && <SideButton icon="report" label="TM-30" onPress={p.onShowTm30} />}
          {idle && p.hasReading && !p.canSaveLive && p.onShowPhoto && <SideButton icon="photo" label="Photo" onPress={p.onShowPhoto} />}
        </View>
      </View>
    </View>
  );
}
