// src/components/HintPressable.tsx
//
// A TouchableOpacity that shows a small floating label when it is long-pressed, for icon-only buttons.
// A normal tap still runs onPress. The label appears above the icon (below it when the icon is near the top of
// the screen), stays clear of the screen edges, and goes away after a moment or on any tap.
// With no onPress it works as a plain label holder (battery, badges).

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TouchableOpacity, TouchableOpacityProps, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../contexts/ThemeContext';
import { hapticTap } from '../utils/haptics';

interface Props extends TouchableOpacityProps {
  /** The label shown on long press. */
  hint: string;
}

const SHOW_MS = 2200;
const TIP_W = 260;   // widest the label may be
const TIP_H = 34;

export default function HintPressable({ hint, onLongPress, children, ...rest }: Props) {
  const { colors } = useTheme();
  const { width: winW } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const ref = useRef<React.ElementRef<typeof TouchableOpacity>>(null);
  const [box, setBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hide = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setBox(null);
  }, []);
  useEffect(() => hide, [hide]);

  const show = useCallback((e: any) => {
    onLongPress?.(e);
    ref.current?.measureInWindow((x, y, w, h) => {
      hapticTap();
      setBox({ x, y, w, h });
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(hide, SHOW_MS);
    });
  }, [onLongPress, hide]);

  const cx = box ? Math.min(Math.max(box.x + box.w / 2, TIP_W / 2 + 8), winW - TIP_W / 2 - 8) : 0;
  const above = box ? box.y > insets.top + TIP_H + 16 : true;
  const top = box ? (above ? box.y - TIP_H - 6 : box.y + box.h + 6) : 0;

  return (
    <>
      <TouchableOpacity ref={ref} delayLongPress={350} {...rest} onLongPress={show}>
        {children}
      </TouchableOpacity>
      {box && (
        <Modal transparent visible animationType="fade" statusBarTranslucent onRequestClose={hide}>
          <Pressable style={StyleSheet.absoluteFill} onPress={hide}>
            <View pointerEvents="none" style={[styles.slot, { left: cx - TIP_W / 2, top }]}>
              <View style={[styles.tip, { backgroundColor: colors.text }]}>
                <Text style={[styles.tipText, { color: colors.background }]} numberOfLines={1}>{hint}</Text>
              </View>
            </View>
          </Pressable>
        </Modal>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  slot: { position: 'absolute', width: TIP_W, height: TIP_H, alignItems: 'center', justifyContent: 'center' },
  tip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8, maxWidth: TIP_W },
  tipText: { fontSize: 13, fontWeight: '600' },
});
