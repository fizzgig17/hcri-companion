// src/components/ShareCardModal.tsx
//
// "Share card": a PNG summary of the reading (like the card on hCRI.io) with Save image and Copy image. A hidden
// WebView draws the card (utils/shareCard.ts) and hands back the PNG; it's shown here at full width so what you see is
// exactly what gets saved or copied.

import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Image, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../contexts/ThemeContext';
import { useLog } from '../contexts/LogContext';
import { APP_VERSION } from '../buildInfo';
import { buildShareCardHtml, buildShareCardModel, pngAspect, shareCardFileName, SHARE_CARD_W } from '../utils/shareCard';
import { copyCardImage, saveCardImage } from '../utils/imageClipboard';
import { withBackgroundDisconnectSuppressed } from '../ble/backgroundDisconnectGuard';
import type { Tm30Input } from '../utils/tm30Report';

export default function ShareCardModal({ visible, input, onClose }: { visible: boolean; input: Tm30Input; onClose: () => void }) {
  const { colors, scheme } = useTheme();
  const { appendLog } = useLog();
  const insets = useSafeAreaInsets();
  const [png, setPng] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const built = useMemo(() => {
    if (!visible) return null;
    try {
      const model = buildShareCardModel(input, { dark: scheme === 'dark', accent: colors.accent, text: colors.text, dim: colors.muted }, APP_VERSION);
      return { html: buildShareCardHtml(model), error: null as string | null };
    } catch (e: any) {
      return { html: '', error: String(e?.message ?? e) };
    }
  }, [visible, input, scheme, colors.accent, colors.text, colors.muted]);

  useEffect(() => {
    if (!visible) { setPng(null); setError(null); setNote(null); setBusy(false); }
  }, [visible]);

  const name = shareCardFileName(input.title);
  const fail = built?.error ?? error;

  const onMessage = (data: string) => {
    if (data.startsWith('png:')) setPng(data.slice(4));
    else if (data.startsWith('err:')) setError(data.slice(4));
  };

  const save = async () => {
    if (!png || busy) return;
    setBusy(true);
    setNote(null);
    try {
      const out: { result: Awaited<ReturnType<typeof saveCardImage>> } = { result: 'cancelled' };
      await withBackgroundDisconnectSuppressed(async () => { out.result = await saveCardImage(png, name); });
      if (out.result === 'saved') setNote('Saved to Pictures › hCRI');
      appendLog(`Share card: ${out.result} (${name})`);
    } catch (e: any) {
      appendLog(`Share card save failed: ${e?.message ?? e}`);
      Alert.alert('Could not save the image', String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!png || busy) return;
    setBusy(true);
    setNote(null);
    try {
      await copyCardImage(png, name);
      setNote('Image copied to the clipboard');
      appendLog(`Share card: copied (${name})`);
    } catch (e: any) {
      appendLog(`Share card copy failed: ${e?.message ?? e}`);
      Alert.alert('Could not copy the image', String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  const styles = StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.background, paddingTop: insets.top + 8, paddingBottom: insets.bottom + 8 },
    bar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingBottom: 8, gap: 8 },
    title: { flex: 1, color: colors.text, fontSize: 16, fontWeight: '700' },
    btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderRadius: 18, borderWidth: 1, borderColor: colors.accent, paddingVertical: 9, paddingHorizontal: 14 },
    btnText: { color: colors.accent, fontSize: 13, fontWeight: '700' },
    body: { padding: 12, alignItems: 'center' },
    note: { color: colors.muted, fontSize: 12, textAlign: 'center', paddingVertical: 6, minHeight: 28 },
    dock: { flexDirection: 'row', gap: 8, paddingHorizontal: 12 },
  });

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.root}>
        <View style={styles.bar}>
          <Text style={styles.title}>Share card</Text>
          <TouchableOpacity style={[styles.btn, { borderColor: colors.cardBorder }]} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close">
            <Text style={[styles.btnText, { color: colors.text }]}>Close</Text>
          </TouchableOpacity>
        </View>
        <ScrollView contentContainerStyle={styles.body}>
          {fail ? (
            <Text style={{ color: colors.text }}>Could not make the card: {fail}</Text>
          ) : png ? (
            <Image
              source={{ uri: `data:image/png;base64,${png}` }}
              style={{ width: '100%', maxWidth: SHARE_CARD_W * 1.4, aspectRatio: pngAspect(png) ?? 540 / 944 }}
              resizeMode="contain"
              accessibilityLabel="Share card preview"
            />
          ) : (
            <ActivityIndicator style={{ marginTop: 40 }} color={colors.accent} />
          )}
        </ScrollView>
        <Text style={styles.note}>{note ?? ''}</Text>
        <View style={styles.dock}>
          <TouchableOpacity style={[styles.btn, { flex: 1 }, (!png || busy) && { opacity: 0.5 }]} onPress={save} disabled={!png || busy} accessibilityRole="button" accessibilityLabel="Save image">
            <Text style={styles.btnText}>Save image</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.btn, { flex: 1 }, (!png || busy) && { opacity: 0.5 }]} onPress={copy} disabled={!png || busy} accessibilityRole="button" accessibilityLabel="Copy image">
            <Text style={styles.btnText}>Copy image</Text>
          </TouchableOpacity>
        </View>
        {visible && built && !built.error && !png && !error && (
          <WebView
            style={{ position: 'absolute', width: 1, height: 1, opacity: 0 }}
            originWhitelist={['*']}
            source={{ html: built.html }}
            onMessage={(e) => onMessage(e.nativeEvent.data)}
            onError={() => setError('the card page failed to load')}
          />
        )}
      </View>
    </Modal>
  );
}
