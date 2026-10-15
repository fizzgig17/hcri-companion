// src/screens/PhotoScreen.tsx
//
// "See it on a photo" (iPad): the reading's own per-hue shifts (TM-30 Rcs,hj / Rhs,hj) applied to a photo, with a
// draggable divider between the reference colours and how this light renders them. It is hcri.io's photo tool
// (src/photo/photoScript.ts) running in a WebView, fed by the same TM-30 calculation the report uses, so the
// result matches the website. Photos are processed on the device and never uploaded.
// Opened with navigation.navigate('Photo', { input }).

import React, { useMemo, useRef } from 'react';
import { View, Text, StyleSheet, Platform, Alert, NativeModules } from 'react-native';
import RNFS from 'react-native-fs';
import { launchImageLibrary } from 'react-native-image-picker';
import { WebView } from 'react-native-webview';
import { useTheme } from '../contexts/ThemeContext';
import { useLog } from '../contexts/LogContext';
import type { Tm30Input } from '../utils/tm30Report';
import { buildPhotoHtml } from '../photo/photoHtml';

// Android: the web view's own file chooser only offers Camera and Files (no Gallery / Google Photos), so the page's
// "load your own photo" button is routed to the native photo picker instead, and the chosen photo is handed back to the
// page as if it had been picked in its <input type="file">.
const ANDROID_PICK_HOOK = `(function(){
  var orig = HTMLInputElement.prototype.click;
  HTMLInputElement.prototype.click = function(){
    if (this.type === 'file' && window.ReactNativeWebView) { window.__hcriFileInput = this; window.ReactNativeWebView.postMessage('pickPhoto'); return; }
    return orig.apply(this, arguments);
  };
})(); true;`;

// Swipe right anywhere on the page EXCEPT the photo itself (its canvases and the divider live in a box that holds a
// <canvas>) posts 'swipeBack', so the TM-30 screen can go back to the report. Touches on the photo are left alone so
// the divider still drags.
const SWIPE_BACK_HOOK = `(function(){
  if (window.__hcriSwipe) return; window.__hcriSwipe = true;
  var sx = 0, sy = 0, ok = false;
  function onPhoto(el){
    for (var n = el; n && n !== document.body; n = n.parentElement) {
      if (n.tagName === 'CANVAS') return true;
      for (var i = 0; i < n.children.length; i++) if (n.children[i].tagName === 'CANVAS') return true;
    }
    return false;
  }
  window.addEventListener('touchstart', function(e){
    if (e.touches.length !== 1) { ok = false; return; }
    ok = !onPhoto(e.target); sx = e.touches[0].clientX; sy = e.touches[0].clientY;
  }, { passive: true });
  window.addEventListener('touchend', function(e){
    if (!ok || !e.changedTouches.length) return; ok = false;
    var dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
    if (dx > 70 && Math.abs(dy) < dx * 0.6 && window.ReactNativeWebView) window.ReactNativeWebView.postMessage('swipeBack');
  }, { passive: true });
})(); true;`;

function deliverPhotoJs(base64: string, mime: string, name: string): string {
  return `(function(){
    try {
      var b = atob(${JSON.stringify(base64)}), n = b.length, u = new Uint8Array(n);
      for (var i = 0; i < n; i++) u[i] = b.charCodeAt(i);
      var f = new File([u], ${JSON.stringify(name)}, { type: ${JSON.stringify(mime)} });
      var dt = new DataTransfer(); dt.items.add(f);
      var inp = window.__hcriFileInput; if (!inp) return;
      inp.files = dt.files;
      inp.dispatchEvent(new Event('change', { bubbles: true }));
    } catch (e) {}
  })(); true;`;
}

export default function PhotoScreen({ route, onSwipeBack }: any) {
  const { colors } = useTheme();
  const input: Tm30Input = route.params.input;
  const webRef = useRef<any>(null);
  const { appendLog } = useLog();
  const pickPhoto = async () => {
    appendLog('Photo: opening the photo picker');
    try {
      // Preferred: the system "choose an app" list (Gallery, Google Photos, Files). Falls back to the system photo picker.
      const g = NativeModules.GalleryPicker;
      if (g?.pick) {
        try {
          const r = await g.pick();
          if (!r) { appendLog('Photo: picker closed without a choice'); return; }
          appendLog(`Photo: loaded ${Math.round(r.base64.length / 1024)} KB from the chooser, handing it to the page`);
          webRef.current?.injectJavaScript(deliverPhotoJs(r.base64, r.type, r.name));
          return;
        } catch (e: any) {
          appendLog(`Photo: chooser failed (${e?.message ?? e}), using the photo picker`);
        }
      }
      const res = await launchImageLibrary({ mediaType: 'photo', selectionLimit: 1, includeBase64: true, maxWidth: 1600, maxHeight: 1600, quality: 0.8 });
      if (res.didCancel) { appendLog('Photo: picker closed without a choice'); return; }
      if (res.errorCode) {
        appendLog(`Photo: picker error ${res.errorCode}: ${res.errorMessage ?? ''}`);
        Alert.alert('Could not open your photos', res.errorMessage || String(res.errorCode));
        return;
      }
      const a = res.assets?.[0];
      let b64 = a?.base64;
      if (!b64 && a?.uri) b64 = await RNFS.readFile(a.uri.replace(/^file:\/\//, ''), 'base64');
      if (!a || !b64) {
        appendLog('Photo: the picker returned no image data');
        Alert.alert('Could not load that photo', 'The photo picker did not return an image.');
        return;
      }
      appendLog(`Photo: loaded ${a.type ?? 'image'} ${Math.round(b64.length / 1024)} KB, handing it to the page`);
      webRef.current?.injectJavaScript(deliverPhotoJs(b64, a.type || 'image/jpeg', a.fileName || 'photo.jpg'));
    } catch (e: any) {
      appendLog(`Photo: picking failed: ${e?.message ?? e}`);
      Alert.alert('Could not load that photo', String(e?.message ?? e));
    }
  };
  const built = useMemo(() => {
    try {
      return { html: buildPhotoHtml(input, { bg: colors.background, text: colors.text, dim: colors.muted, border: colors.cardBorder, accent: colors.accent }), error: null as string | null };
    } catch (e: any) {
      return { html: '', error: e?.message ?? 'Could not build the page.' };
    }
  }, [input, colors]);

  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    web: { flex: 1, backgroundColor: colors.background },
    err: { color: colors.text, padding: 20, fontSize: 14 },
  });

  return (
      <View style={styles.container}>
        {built.error ? (
          <Text style={styles.err}>{built.error}</Text>
        ) : (
          <WebView
            ref={webRef}
            style={styles.web}
            originWhitelist={['*']}
            source={{ html: built.html }}
            overScrollMode="never"
            allowFileAccess
            injectedJavaScriptBeforeContentLoaded={Platform.OS === 'android' ? ANDROID_PICK_HOOK : undefined}
            // Only when shown inside the TM-30 screen (which passes onSwipeBack).
            injectedJavaScript={onSwipeBack ? SWIPE_BACK_HOOK : undefined}
            onMessage={(e: any) => {
              const msg = e.nativeEvent.data;
              if (Platform.OS === 'android' && msg === 'pickPhoto') pickPhoto();
              else if (msg === 'swipeBack') onSwipeBack?.();
            }}
          />
        )}
      </View>
  );
}
