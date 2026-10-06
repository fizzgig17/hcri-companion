// src/screens/tabs/AboutTab.tsx
//
// Lists exactly which meter models this app has real, verified support
// for (and what's different/notable about each one), plus which name
// pattern is used to detect each one. Pulls from supportedDevices.ts,
// which is the single place to update when a new model gets added --
// this tab just renders whatever's in there, so it never needs its own
// changes when the device list grows.
//
// Also the one place in the app that opens a plain mailto: link -- a
// "Send Feedback" button at the top, pre-addressed to fizzgig@hcri.io
// with a fixed subject line, so a report doesn't depend on the person
// remembering (or me re-stating) the address each time. Deliberately NOT
// routed through the debug log's own "Share Debug Log" share sheet (see
// shareLog.ts) -- that's for attaching a log to whatever the person
// already has open; this is a direct "start an email to the developer"
// action with no log attached, since most feedback isn't a bug report.
//
// Right below that is a plain link back to the companion page on hCRI.io's
// own site (www.hcri.io/companion) -- opened in whatever browser/app
// handles https: links on the device, same fallback-to-Alert pattern as
// the feedback mailto link above for the rare case nothing's registered
// to handle it.

import React from 'react';
import { View, Text, StyleSheet, Linking, Alert, TouchableOpacity } from 'react-native';
import { useTheme } from '../../contexts/ThemeContext';
import { SUPPORTED_DEVICES } from '../../ble/supportedDevices';
import PrimaryButton from '../../components/PrimaryButton';

const FEEDBACK_EMAIL = 'fizzgig@hcri.io';
const FEEDBACK_SUBJECT = 'hCRI Companion Feedback';
// encodeURIComponent, not a hand-rolled replace -- mailto's subject is a
// normal URL query-ish component, so spaces need to become %20 (or +,
// but %20 is the unambiguous one every mail client handles) the same way
// any other URL-embedded text would.
const FEEDBACK_MAILTO = `mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent(FEEDBACK_SUBJECT)}`;

// The companion page on hCRI.io's own site -- same domain every other
// link/brand reference in this app already uses (HCRI_BRAND_HOST,
// dev.hcri.io, the feedback address above), not a separate site.
const COMPANION_PAGE_URL = 'https://www.hcri.io/companion';

// Open-source details: the app is free software (GPL v3 or later), so the source,
// the license text and the third-party notices are one tap away from here.
const SOURCE_URL = 'https://github.com/fizzgig17/hcri-companion';
const LICENSE_URL = `${SOURCE_URL}/blob/master/LICENSE`;
const NOTICES_URL = `${SOURCE_URL}/blob/master/THIRD-PARTY-NOTICES.md`;

export default function AboutTab() {
  const { colors } = useTheme();

  const sendFeedback = () => {
    // Linking.openURL rejects (rather than silently no-opping) when
    // there's genuinely no app registered to handle mailto: at all --
    // rare, but possible on a stripped-down Android build/custom ROM
    // with no mail client installed. Falling back to telling the person
    // the address directly beats a silent failed tap with no feedback at
    // all (no pun intended).
    Linking.openURL(FEEDBACK_MAILTO).catch(() => {
      Alert.alert('Could not open an email app', `Email ${FEEDBACK_EMAIL} directly instead.`);
    });
  };

  const openCompanionPage = () => {
    Linking.openURL(COMPANION_PAGE_URL).catch(() => {
      Alert.alert('Could not open browser', `Visit ${COMPANION_PAGE_URL} directly instead.`);
    });
  };

  const openUrl = (url: string) => {
    Linking.openURL(url).catch(() => {
      Alert.alert('Could not open browser', `Visit ${url} directly instead.`);
    });
  };

  const styles = StyleSheet.create({
    openLink: { color: colors.info, fontSize: 13, fontWeight: '600', paddingVertical: 6 },
    feedbackButton: { marginBottom: 14 },
    companionLink: { alignItems: 'center', paddingVertical: 4, marginBottom: 14 },
    companionLinkText: { color: colors.info, fontSize: 13, fontWeight: '600' },
    card: {
      backgroundColor: colors.card,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      padding: 14,
      marginBottom: 12,
    },
    heading: { color: colors.text, fontSize: 15, fontWeight: '700', marginBottom: 4 },
    subheading: { color: colors.muted, fontSize: 12, lineHeight: 17 },

    headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    model: { color: colors.text, fontSize: 15, fontWeight: '700' },
    matchedBy: { color: colors.muted, fontSize: 11, fontFamily: 'monospace', marginTop: 3, marginBottom: 6 },
    verifiedDate: { color: colors.mutedFaint, fontSize: 11, marginBottom: 6 },
    note: { color: colors.muted, fontSize: 12, lineHeight: 17, marginTop: 2 },

    badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
    badgeVerified: { backgroundColor: 'rgba(47,168,122,0.18)' },
    badgeUnverified: { backgroundColor: 'rgba(209,85,74,0.18)' },
    badgeText: { fontSize: 10, fontWeight: '700', color: colors.text },
  });

  return (
    <View>
      <PrimaryButton title="Send Feedback" onPress={sendFeedback} variant="muted" style={styles.feedbackButton} />

      <TouchableOpacity onPress={openCompanionPage} style={styles.companionLink}>
        <Text style={styles.companionLinkText}>Visit the hCRI Companion page →</Text>
      </TouchableOpacity>

      <View style={styles.card}>
        <Text style={styles.heading}>Supported Meters</Text>
        <Text style={styles.subheading}>
          This app auto-detects which model you're connected to from its advertised Bluetooth name, and reads its
          data using that model's own field layout.
        </Text>
      </View>

      {SUPPORTED_DEVICES.map((d) => (
        <View key={d.model} style={styles.card}>
          <View style={styles.headerRow}>
            <Text style={styles.model}>{d.model}</Text>
            <View style={[styles.badge, d.verified ? styles.badgeVerified : styles.badgeUnverified]}>
              <Text style={styles.badgeText}>{d.verified ? 'Verified' : 'Unverified'}</Text>
            </View>
          </View>
          <Text style={styles.matchedBy}>{d.matchedBy}</Text>
          {d.verifiedDate && <Text style={styles.verifiedDate}>Verified against a real reading on {d.verifiedDate}</Text>}
          {d.notes.map((note, i) => (
            <Text key={i} style={styles.note}>
              •  {note}
            </Text>
          ))}
        </View>
      ))}

      <View style={styles.card}>
        <Text style={styles.heading}>Open source</Text>
        <Text style={styles.subheading}>
          © 2026 fizzgig. hCRI Companion is free software, licensed under the GNU General Public License v3 or later, with an additional permission for App Store distribution.
          It comes with no warranty.
        </Text>
        <TouchableOpacity onPress={() => openUrl(SOURCE_URL)}>
          <Text style={styles.openLink}>Source code →</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => openUrl(LICENSE_URL)}>
          <Text style={styles.openLink}>License (GPL v3) →</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => openUrl(NOTICES_URL)}>
          <Text style={styles.openLink}>Third-party licenses →</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
