// src/screens/Tm30ReportScreen.tsx
//
// The in-app TM-30 report: a scrolling page built on the phone from the
// reading's own spectrum (tm30Report.ts), with a "Share PDF" button docked at
// the bottom. Works for any reading -- uploaded or not, online or off.
// Opened with navigation.navigate('Tm30Report', { input }).

import React, { useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet, Alert, Platform } from 'react-native';
import { WebView } from 'react-native-webview';
import { generatePDF } from 'react-native-html-to-pdf';
import RNShare from 'react-native-share';
import RNFS from 'react-native-fs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../contexts/ThemeContext';
import { useLog } from '../contexts/LogContext';
import { buildTm30Html, buildTm30ImageHtml, buildTm30PdfHtml, TM30_PDF_PAGE, Tm30Input } from '../utils/tm30Report';
import { withBackgroundDisconnectSuppressed } from '../ble/backgroundDisconnectGuard';

export default function Tm30ReportScreen({ route, navigation, panel }: any) {
  const { colors } = useTheme();
  const { appendLog } = useLog();
  const insets = useSafeAreaInsets();
  const input: Tm30Input = route.params.input;
  const [sharing, setSharing] = useState(false);
  const busy = useRef(false);
  // "Save image": a hidden WebView draws the report to a canvas and hands back a PNG, which goes to the share sheet
  // (iOS: Save Image; Android: Photos / Files / any app).
  const [imageHtml, setImageHtml] = useState<string | null>(null);
  const imageBusy = useRef(false);

  const startImage = () => {
    if (imageBusy.current || busy.current) return;
    try {
      imageBusy.current = true;
      setImageHtml(buildTm30ImageHtml(input));
    } catch (e: any) {
      imageBusy.current = false;
      Alert.alert('Could not create the image', String(e?.message ?? e));
    }
  };

  const onImageMessage = async (data: string) => {
    setImageHtml(null);
    try {
      if (data.startsWith('err:')) throw new Error(data.slice(4));
      if (!data.startsWith('png:')) return;
      const name = `TM-30_${(input.title || 'reading').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 60)}.png`;
      const path = `${RNFS.CachesDirectoryPath}/${name}`;
      await RNFS.writeFile(path, data.slice(4), 'base64');
      appendLog(`TM-30 image created: ${path}`);
      await withBackgroundDisconnectSuppressed(async () => {
        await RNShare.open({ url: `file://${path}`, type: 'image/png', filename: name });
      });
    } catch (e: any) {
      if (String(e?.message ?? e).includes('did not share')) {
        appendLog('TM-30 image: share cancelled.');
      } else {
        appendLog(`TM-30 image failed: ${e?.message ?? e}`);
        Alert.alert('Could not create the image', String(e?.message ?? e));
      }
    } finally {
      imageBusy.current = false;
    }
  };

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
      const pdf = await generatePDF({ html: buildTm30PdfHtml(input, Platform.OS === 'ios'), fileName: name, width: TM30_PDF_PAGE.width, height: TM30_PDF_PAGE.height, ...(Platform.OS === 'ios' ? { padding: 0 } : {}) });
      const path = pdf.filePath;
      if (!path) throw new Error('No PDF file was produced.');
      appendLog(`TM-30 PDF created: ${path} (${pdf.numberOfPages ?? '?'} page(s))`);
      appendLog('TM-30 PDF: opening the share sheet…');
      await withBackgroundDisconnectSuppressed(async () => {
        await RNShare.open({ url: path.startsWith('file://') ? path : `file://${path}`, type: 'application/pdf', filename: `${name}.pdf` });
      });
      appendLog('TM-30 PDF: share sheet closed.');
    } catch (e: any) {
      // The share sheet being dismissed rejects with a message containing "User did not share".
      if (String(e?.message ?? e).includes('did not share')) {
        appendLog('TM-30 PDF: share cancelled.');
      } else {
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
      paddingBottom: panel ? 12 : Math.max(insets.bottom, 10) + 4,
    },
    btn: { backgroundColor: colors.accent, borderRadius: 10, paddingVertical: 13, alignItems: 'center', flexDirection: 'row', justifyContent: 'center' },
    btnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
    btnSecondary: { flex: 1, backgroundColor: 'transparent', borderWidth: 1.5, borderColor: colors.accent },
    btnTextSecondary: { color: colors.accent, fontSize: 15, fontWeight: '700' },
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
      {imageHtml && (
        <WebView
          style={{ position: 'absolute', width: 1, height: 1, opacity: 0 }}
          originWhitelist={['*']}
          source={{ html: imageHtml }}
          onMessage={(e) => onImageMessage(e.nativeEvent.data)}
          onError={() => onImageMessage('err:the image page failed to load')}
        />
      )}
      <View style={styles.dock}>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <TouchableOpacity
            style={[styles.btn, styles.btnSecondary, !!built.error && { opacity: 0.5 }]}
            onPress={() => navigation?.navigate('Photo', { input })}
            disabled={!!built.error}
            accessibilityRole="button"
            accessibilityLabel="See it on a photo"
          >
            <Text style={styles.btnTextSecondary}>See it on a photo</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.btn, styles.btnSecondary, (!!imageHtml || !!built.error) && { opacity: 0.5 }]}
            onPress={startImage}
            disabled={!!imageHtml || !!built.error}
            accessibilityRole="button"
            accessibilityLabel="Save as image"
          >
            {imageHtml && <ActivityIndicator color={colors.accent} style={{ marginRight: 8 }} />}
            <Text style={styles.btnTextSecondary}>{imageHtml ? 'Making image…' : 'Save image'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.btn, { flex: 1 }, (sharing || !!built.error) && { opacity: 0.5 }]} onPress={sharePdf} disabled={sharing || !!built.error} accessibilityRole="button" accessibilityLabel="Share PDF">
            {sharing && <ActivityIndicator color="#fff" style={{ marginRight: 8 }} />}
            <Text style={styles.btnText}>{sharing ? 'Creating PDF…' : 'Share PDF'}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}
