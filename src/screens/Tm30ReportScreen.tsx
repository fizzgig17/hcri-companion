// src/screens/Tm30ReportScreen.tsx
//
// The in-app TM-30 report: a scrolling page built on the phone from the
// reading's own spectrum (tm30Report.ts), with a "Share PDF" button docked at
// the bottom. Works for any reading -- uploaded or not, online or off.
// Opened with navigation.navigate('Tm30Report', { input }).

import React, { useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet, Alert } from 'react-native';
import { WebView } from 'react-native-webview';
import { generatePDF } from 'react-native-html-to-pdf';
import RNShare from 'react-native-share';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../contexts/ThemeContext';
import { useLog } from '../contexts/LogContext';
import { buildTm30Html, buildTm30PdfHtml, Tm30Input } from '../utils/tm30Report';
import { withBackgroundDisconnectSuppressed } from '../ble/backgroundDisconnectGuard';

export default function Tm30ReportScreen({ route }: any) {
  const { colors } = useTheme();
  const { appendLog } = useLog();
  const insets = useSafeAreaInsets();
  const input: Tm30Input = route.params.input;
  const [sharing, setSharing] = useState(false);
  const busy = useRef(false);

  const built = useMemo(() => {
    try {
      return { html: buildTm30Html(input), error: null as string | null };
    } catch (e: any) {
      return { html: '', error: e?.message ?? 'Could not build the report.' };
    }
  }, [input]);

  const sharePdf = async () => {
    if (busy.current || !built.html) return;
    busy.current = true;
    setSharing(true);
    try {
      const name = `TM-30_${(input.title || 'reading').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 60)}`;
      const pdf = await generatePDF({ html: buildTm30PdfHtml(input), fileName: name, width: 595, height: 842 });
      const path = pdf.filePath;
      if (!path) throw new Error('No PDF file was produced.');
      appendLog(`TM-30 PDF created: ${path} (${pdf.numberOfPages ?? '?'} page(s))`);
      await withBackgroundDisconnectSuppressed(async () => {
        await RNShare.open({ url: path.startsWith('file://') ? path : `file://${path}`, type: 'application/pdf', filename: `${name}.pdf` });
      });
    } catch (e: any) {
      // The share sheet being dismissed rejects with a message containing "User did not share".
      if (!String(e?.message ?? e).includes('did not share')) {
        appendLog(`TM-30 PDF failed: ${e?.message ?? e}`);
        Alert.alert('Could not create the PDF', String(e?.message ?? e));
      }
    } finally {
      busy.current = false;
      setSharing(false);
    }
  };

  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    web: { flex: 1, backgroundColor: '#ffffff' },
    err: { color: colors.text, padding: 20, fontSize: 14 },
    dock: {
      backgroundColor: colors.card,
      borderTopWidth: 1,
      borderTopColor: colors.cardBorder,
      paddingHorizontal: 16,
      paddingTop: 10,
      paddingBottom: Math.max(insets.bottom, 10) + 4,
    },
    btn: { backgroundColor: colors.accent, borderRadius: 10, paddingVertical: 13, alignItems: 'center', flexDirection: 'row', justifyContent: 'center' },
    btnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  });

  return (
    <View style={styles.container}>
      {built.error ? (
        <Text style={styles.err}>{built.error}</Text>
      ) : (
        <WebView
          style={styles.web}
          originWhitelist={['*']}
          source={{ html: built.html }}
          scalesPageToFit={false}
          setBuiltInZoomControls
          setDisplayZoomControls={false}
          overScrollMode="never"
        />
      )}
      <View style={styles.dock}>
        <TouchableOpacity style={[styles.btn, (sharing || !!built.error) && { opacity: 0.5 }]} onPress={sharePdf} disabled={sharing || !!built.error} accessibilityRole="button" accessibilityLabel="Share PDF">
          {sharing && <ActivityIndicator color="#fff" style={{ marginRight: 8 }} />}
          <Text style={styles.btnText}>{sharing ? 'Creating PDF…' : 'Share PDF'}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
