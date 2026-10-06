// src/components/ActionBar.tsx
//
// The Home tab's pinned action bar: Connect / Take Reading / Upload etc.
// live here, docked just above the app's bottom navigation, so the main
// actions are always under the thumb and never scroll away with the
// chart. HomeScreen renders it as a sibling of the ScrollView (Main tab
// only). Take Reading keeps the standard accent green.

import React from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { useTheme } from '../contexts/ThemeContext';
import type { Status } from '../screens/tabs/MainTab';

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
}

export default function ActionBar(p: Props) {
  const { colors } = useTheme();
  const styles = StyleSheet.create({
    bar: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 12,
      paddingVertical: 8,
      backgroundColor: colors.card,
      borderTopWidth: 1,
      borderTopColor: colors.cardBorder,
    },
    main: { flex: 1, borderRadius: 10, paddingVertical: 13, alignItems: 'center', justifyContent: 'center' },
    mainAccent: { backgroundColor: colors.accent },
    mainMuted: { backgroundColor: colors.background, borderWidth: 1, borderColor: colors.cardBorder },
    mainText: { color: colors.text, fontSize: 15, fontWeight: '700' },
    side: {
      marginLeft: 8,
      paddingVertical: 13,
      paddingHorizontal: 14,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      backgroundColor: colors.background,
      alignItems: 'center',
      justifyContent: 'center',
    },
    sideText: { color: colors.text, fontSize: 14, fontWeight: '600' },
    plug: { alignItems: 'center', justifyContent: 'center', marginRight: 10, minWidth: 52 },
    plugIcon: { fontSize: 20 },
    plugLabel: { color: colors.muted, fontSize: 9.5, marginTop: 1 },
    pill: {
      flexDirection: 'row',
      alignItems: 'center',
      marginLeft: 8,
      paddingVertical: 10,
      paddingHorizontal: 12,
      borderRadius: 18,
      borderWidth: 1.5,
      borderColor: colors.accent,
    },
    pillText: { color: colors.accent, fontSize: 13, fontWeight: '700' },
    disabled: { opacity: 0.5 },
  });

  const { status } = p;
  const busyLabel = status === 'connecting' ? 'Connecting…' : status === 'measuring' ? 'Measuring…' : null;
  const uploadDisabled = p.uploading || !p.hasReading || p.isSample;

  return (
    <View style={styles.bar}>
      {status === 'connected' && (
        <TouchableOpacity
          style={styles.plug}
          onPress={p.disconnect}
          accessibilityRole="button"
          accessibilityLabel="Disconnect meter"
        >
          <Text style={styles.plugIcon}>🔌</Text>
          <Text style={styles.plugLabel}>Disconnect</Text>
        </TouchableOpacity>
      )}

      {status === 'disconnected' && (
        <>
          <TouchableOpacity style={[styles.main, styles.mainAccent]} onPress={p.connect} activeOpacity={0.8}>
            <Text style={styles.mainText}>Connect to Meter</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.side, p.loadingTestReading && styles.disabled]}
            onPress={p.onShowTestReading}
            disabled={p.loadingTestReading}
            activeOpacity={0.8}
          >
            <Text style={styles.sideText}>{p.loadingTestReading ? 'Loading…' : 'Test reading'}</Text>
          </TouchableOpacity>
        </>
      )}

      {busyLabel && (
        <View style={[styles.main, styles.mainAccent, styles.disabled]}>
          <Text style={styles.mainText}>{busyLabel}</Text>
        </View>
      )}

      {status === 'connected' && (
        <TouchableOpacity style={[styles.main, styles.mainAccent]} onPress={p.measure} activeOpacity={0.8}>
          <Text style={styles.mainText}>Take Reading</Text>
        </TouchableOpacity>
      )}

      {(status === 'connected' || status === 'uploading') && !p.isSample && (
        <>
          {status === 'uploading' && (
            <View style={[styles.main, styles.mainMuted]}>
              <ActivityIndicator size="small" color={colors.muted} />
            </View>
          )}
          <TouchableOpacity
            style={[styles.side, uploadDisabled && styles.disabled]}
            onPress={p.onUpload}
            disabled={uploadDisabled}
            activeOpacity={0.8}
          >
            <Text style={styles.sideText}>Upload</Text>
          </TouchableOpacity>
        </>
      )}

      {p.uploadSucceeded && p.canCopyLink && (
        <TouchableOpacity style={styles.pill} onPress={p.onCopyLink} disabled={p.copyingLink}>
          {p.copyingLink ? (
            <ActivityIndicator size="small" color={colors.accent} />
          ) : (
            <Text style={styles.pillText}>🔗 Copy</Text>
          )}
        </TouchableOpacity>
      )}
      {p.uploadSucceeded && !p.canCopyLink && (
        <View style={styles.pill}>
          <Text style={styles.pillText}>✓ Uploaded</Text>
        </View>
      )}
    </View>
  );
}
