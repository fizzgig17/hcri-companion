// src/screens/Tm30ReportScreen.tsx
//
// The in-app TM-30 report: a scrolling page built on the phone from the
// reading's own spectrum (tm30Report.ts), with Save image and Share PDF docked
// at the bottom. Works for any reading -- uploaded or not, online or off.
// Opened with navigation.navigate('Tm30Report', { input }).
//
// Two pages side by side: the report, and "See it on a photo" (PhotoScreen) to
// its right. Swipe left on the report, or tap Photo (top right), to get there;
// on the photo page swiping is off (the photo's divider is dragged sideways),
// so TM-30 (top left) brings you back. The X closes both, back to wherever the
// report was opened from (Home or History). On a tablet the window's own X
// closes it instead.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet, Alert, Platform, ScrollView, BackHandler, LayoutChangeEvent, NativeSyntheticEvent, NativeScrollEvent } from 'react-native';
import { WebView } from 'react-native-webview';
import { generatePDF } from 'react-native-html-to-pdf';
import RNShare from 'react-native-share';
import RNFS from 'react-native-fs';
import { Icon, ICON_SIZE, CloseButton } from '../components/icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../contexts/ThemeContext';
import { useLog } from '../contexts/LogContext';
import { buildTm30Html, buildTm30ImageHtml, buildTm30PdfHtml, TM30_PDF_PAGE, Tm30Input } from '../utils/tm30Report';
import { withBackgroundDisconnectSuppressed } from '../ble/backgroundDisconnectGuard';
import PhotoScreen from './PhotoScreen';
import ShareCardModal from '../components/ShareCardModal';
import { IS_DEV_BUILD } from '../hcri/buildTarget';


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
  const [cardOpen, setCardOpen] = useState(false);

  // Pager: 0 = report, 1 = photo. The photo page is only built the first time it's shown.
  const pagerRef = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const [pageW, setPageW] = useState(0);
  const [page, setPage] = useState(0);
  const [photoMounted, setPhotoMounted] = useState(false);
  const goToPage = useCallback((n: number) => {
    if (n === 1) setPhotoMounted(true);
    setPage(n);
    pagerRef.current?.scrollTo({ x: n * pageW, animated: true });
  }, [pageW]);
  const onPagerLayout = (e: LayoutChangeEvent) => {
    const w = Math.round(e.nativeEvent.layout.width);
    if (w && w !== pageW) {
      setPageW(w);
      // Keep the current page in view after a rotation / window resize.
      requestAnimationFrame(() => pagerRef.current?.scrollTo({ x: page * w, animated: false }));
    }
  };
  const onPagerScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (!pageW) return;
    const n = Math.round(e.nativeEvent.contentOffset.x / pageW) > 0 ? 1 : 0;
    if (n === 1) setPhotoMounted(true);
    setPage(n);
  };
  // Start building the photo page as soon as a swipe begins, so it's there when the swipe lands.
  const onPagerDragStart = () => setPhotoMounted(true);
  // Android back on the photo page returns to the report rather than closing everything.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (page === 1) { goToPage(0); return true; }
      return false;
    });
    return () => sub.remove();
  }, [page, goToPage]);
  const close = () => navigation?.goBack();

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
    bar: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.card,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.cardBorder,
      // A dev build's orange banner already sits over the status bar, so adding the inset again left a big gap.
      paddingTop: panel || IS_DEV_BUILD ? 6 : insets.top + 4,
      paddingBottom: 6,
      paddingHorizontal: 8,
    },
    barSide: { flex: 1, flexDirection: 'row', alignItems: 'center' },
    barTitle: { color: colors.text, fontSize: 16, fontWeight: '600', textAlign: 'center' },
    barBtn: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, paddingHorizontal: 8, borderRadius: 18 },
    barBtnText: { color: colors.accent, fontSize: 15, fontWeight: '600' },
    dots: { flexDirection: 'row', justifyContent: 'center', marginTop: 4 },
    dot: { width: 5, height: 5, borderRadius: 2.5, marginHorizontal: 3, backgroundColor: colors.mutedFaint },
    dotOn: { backgroundColor: colors.accent },
    web: { flex: 1, backgroundColor: '#ffffff' },
    err: { color: colors.text, padding: 20, fontSize: 14 },
    dock: {
      backgroundColor: colors.card,
      borderTopWidth: 1,
      borderTopColor: colors.cardBorder,
      paddingHorizontal: 16,
      paddingTop: 8,
      paddingBottom: panel ? 8 : Math.max(insets.bottom - 8, 8),
    },
    btn: { backgroundColor: colors.accent, borderRadius: 10, paddingVertical: 13, alignItems: 'center', flexDirection: 'row', justifyContent: 'center' },
    iconBtn: { flex: 1, flexDirection: 'row', paddingVertical: 8, alignItems: 'center', justifyContent: 'center', borderRadius: 18, borderWidth: 1, borderColor: colors.cardBorder, backgroundColor: colors.card },
    iconBtnText: { fontSize: 13, fontWeight: '600', marginLeft: 6 },
    btnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
    btnSecondary: { flex: 1, backgroundColor: 'transparent', borderWidth: 1.5, borderColor: colors.accent },
    btnTextSecondary: { color: colors.accent, fontSize: 15, fontWeight: '700' },
  });

  const closeButton = panel ? null : <CloseButton onPress={close} />;

  const reportPage = (
    <View style={{ flex: 1 }}>
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
      <ShareCardModal visible={cardOpen} input={input} onClose={() => setCardOpen(false)} />
      <View style={styles.dock}>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TouchableOpacity
            style={[styles.iconBtn, (!!imageHtml || !!built.error) && { opacity: 0.5 }]}
            onPress={startImage}
            disabled={!!imageHtml || !!built.error}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Save as image"
          >
            {imageHtml ? <ActivityIndicator size="small" color={colors.text} /> : <Icon name="download" color={colors.text} size={ICON_SIZE.pill} />}
            <Text style={[styles.iconBtnText, { color: colors.text }]} numberOfLines={1}>{imageHtml ? 'Making image…' : 'Save image'}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.iconBtn, !!built.error && { opacity: 0.5 }]}
            onPress={() => setCardOpen(true)}
            disabled={!!built.error}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Share card"
          >
            <Icon name="card" color={colors.text} size={ICON_SIZE.pill} />
            <Text style={[styles.iconBtnText, { color: colors.text }]} numberOfLines={1}>Card</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.iconBtn, { borderColor: colors.accent }, (sharing || !!built.error) && { opacity: 0.5 }]}
            onPress={sharePdf}
            disabled={sharing || !!built.error}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Share PDF"
          >
            {sharing ? <ActivityIndicator size="small" color={colors.accent} /> : <Icon name="report" color={colors.accent} size={ICON_SIZE.pill} />}
            <Text style={[styles.iconBtnText, { color: colors.accent }]} numberOfLines={1}>{sharing ? 'Creating PDF…' : 'Share PDF'}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      <View style={styles.bar}>
        <View style={styles.barSide}>
          {page === 0 ? closeButton : (
            <TouchableOpacity style={styles.barBtn} onPress={() => goToPage(0)} accessibilityRole="button" accessibilityLabel="Back to the TM-30 report" hitSlop={6}>
              <Icon name="chevronLeft" color={colors.accent} size={ICON_SIZE.row} />
              <Text style={styles.barBtnText}>TM-30</Text>
            </TouchableOpacity>
          )}
        </View>
        <View>
          <Text style={styles.barTitle} numberOfLines={1}>{page === 0 ? 'TM-30 report' : 'On a photo'}</Text>
          <View style={styles.dots}>
            <View style={[styles.dot, page === 0 && styles.dotOn]} />
            <View style={[styles.dot, page === 1 && styles.dotOn]} />
          </View>
        </View>
        <View style={[styles.barSide, { justifyContent: 'flex-end' }]}>
          {page === 1 ? closeButton : (
            <TouchableOpacity style={[styles.barBtn, !!built.error && { opacity: 0.5 }]} onPress={() => goToPage(1)} disabled={!!built.error} accessibilityRole="button" accessibilityLabel="See it on a photo" hitSlop={6}>
              <Icon name="photo" color={colors.accent} size={ICON_SIZE.pill} />
              <Text style={[styles.barBtnText, { marginLeft: 6 }]}>Photo</Text>
              <Icon name="chevronRight" color={colors.accent} size={ICON_SIZE.row} />
            </TouchableOpacity>
          )}
        </View>
      </View>
      <ScrollView
        ref={pagerRef}
        horizontal
        pagingEnabled
        // Swiping only goes report -> photo; on the photo page the divider needs sideways drags.
        scrollEnabled={page === 0 && !built.error}
        showsHorizontalScrollIndicator={false}
        bounces={false}
        overScrollMode="never"
        onLayout={onPagerLayout}
        onScrollBeginDrag={onPagerDragStart}
        onMomentumScrollEnd={onPagerScrollEnd}
        style={{ flex: 1 }}
      >
        <View style={{ width: pageW || '100%', flex: 1 }}>{reportPage}</View>
        <View style={{ width: pageW || '100%', flex: 1 }}>
          {photoMounted ? <PhotoScreen route={{ params: { input } }} onSwipeBack={() => goToPage(0)} /> : null}
        </View>
      </ScrollView>
    </View>
  );
}
