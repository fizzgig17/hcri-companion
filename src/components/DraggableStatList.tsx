// src/components/DraggableStatList.tsx
//
// The reorderable, checkbox-toggleable list of measurements in Settings
// ("which measurements show on the Main tab, and in what order"). Press
// and hold a row's drag handle (⠿), then drag it up or down to reorder;
// tap the checkbox to show/hide it. Built on core React Native's
// PanResponder + Animated rather than a drag/gesture library -- this app
// has no react-native-gesture-handler or react-native-reanimated
// dependency anywhere else, and this is the only screen that would need
// one, so a self-contained implementation avoids adding (and linking,
// and configuring a Babel plugin for) a new native dependency for one
// list.
//
// Implementation note: rows are fixed-height and absolutely positioned
// (top = index * ROW_HEIGHT, animated), rather than driving a real
// FlatList's own items -- with at most ~25 rows (see statMetrics.ts) this
// is simpler and more reliable than measuring real on-screen layouts, and
// sidesteps needing a virtualized list to support reordering at all.

import React, { useEffect, useMemo, useRef } from 'react';
import { View, Text, TouchableOpacity, PanResponder, PanResponderInstance, Animated, StyleSheet } from 'react-native';
import { useTheme } from '../contexts/ThemeContext';

const ROW_HEIGHT = 50;

export interface DraggableStatListProps {
  /** All metric ids, in current display order (includes hidden ones). */
  order: string[];
  /** Which ids from `order` are shown on the Main tab. */
  enabled: Set<string>;
  /** Display label for a given id (see statMetrics.ts's STAT_METRIC_BY_ID). */
  labelFor: (id: string) => string;
  /** Called once a drag ends, with the fully updated order (not on every intermediate frame while dragging). */
  onReorder: (newOrder: string[]) => void;
  /** Called when a row's checkbox is tapped. */
  onToggle: (id: string) => void;
  /** True while a row is held for dragging. The parent should lock its own scrolling then (iOS scrolls the page under the finger otherwise). */
  onDragActiveChange?: (active: boolean) => void;
}

export default function DraggableStatList({ order, enabled, labelFor, onReorder, onToggle, onDragActiveChange }: DraggableStatListProps) {
  const { colors } = useTheme();
  // One Animated.Value per id, each tracking that row's current `top`
  // (index * ROW_HEIGHT), created once per id and reused across
  // reorders/re-renders -- a fresh Animated.Value every render would
  // fight with whatever drag is already in progress.
  const topsRef = useRef<Map<string, Animated.Value>>(new Map());
  // The order list exactly as the in-progress drag gesture is updating
  // it -- kept in a ref (not state) so the PanResponder's move handler,
  // which fires many times a second, never waits on a re-render to see
  // the latest array. `order` (the prop) only changes once, at the end
  // of a drag (via onReorder), so this ref is what's "ahead" of it while
  // a finger is actually moving.
  const liveOrderRef = useRef<string[]>(order);
  const draggingIdRef = useRef<string | null>(null);
  // Where the dragged row's top was when the finger went down. The gesture's dy is measured from
  // that moment, so the row's position must be grantTop + dy -- NOT recomputed from its current
  // index, which changes mid-drag as rows swap (that double-counted the movement and made the row
  // jump ahead of the finger).
  const grantTopRef = useRef(0);

  // Pick up a reordered/changed `order` prop from the parent (e.g. once
  // loadStatDisplayPrefs() resolves on mount) -- but never while a drag
  // is actually in flight, which would yank a row out from under a
  // finger mid-gesture.
  if (draggingIdRef.current === null) {
    liveOrderRef.current = order;
  }

  for (const id of order) {
    if (!topsRef.current.has(id)) {
      topsRef.current.set(id, new Animated.Value(order.indexOf(id) * ROW_HEIGHT));
    }
  }

  // When the parent changes `order` while nothing is being dragged (Reset to Default, or the saved
  // order loading in), move every row to its new slot -- the Animated.Values above are created
  // once per id, so without this the rows stayed where they were and Reset looked like it did nothing.
  const orderKey = order.join('|');
  useEffect(() => {
    if (draggingIdRef.current !== null) return;
    order.forEach((id, index) => {
      const top = topsRef.current.get(id);
      if (top) Animated.timing(top, { toValue: index * ROW_HEIGHT, duration: 150, useNativeDriver: false }).start();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderKey]);

  function animateToLivePositions(exceptId: string | null) {
    liveOrderRef.current.forEach((id, index) => {
      if (id === exceptId) return; // that row's position is driven directly by the gesture, not animated
      const top = topsRef.current.get(id);
      if (!top) return;
      Animated.timing(top, { toValue: index * ROW_HEIGHT, duration: 150, useNativeDriver: false }).start();
    });
  }

  function finishDrag(id: string) {
    const finalIndex = liveOrderRef.current.indexOf(id);
    const top = topsRef.current.get(id);
    if (top) {
      Animated.timing(top, { toValue: finalIndex * ROW_HEIGHT, duration: 150, useNativeDriver: false }).start();
    }
    draggingIdRef.current = null;
    onDragActiveChange?.(false);
    onReorder(liveOrderRef.current.slice());
  }

  function makePanResponder(id: string): PanResponderInstance {
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      // Once a row is grabbed, keep the gesture: otherwise the Settings ScrollView takes it over
      // mid-drag and the drag ends early.
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        onDragActiveChange?.(true);
        draggingIdRef.current = id;
        grantTopRef.current = liveOrderRef.current.indexOf(id) * ROW_HEIGHT;
      },
      onPanResponderMove: (_evt, gesture) => {
        const startIndex = liveOrderRef.current.indexOf(id);
        const top = topsRef.current.get(id);
        if (!top || startIndex === -1) return;
        const rawTop = Math.max(0, Math.min((liveOrderRef.current.length - 1) * ROW_HEIGHT, grantTopRef.current + gesture.dy));
        top.setValue(rawTop);

        const hoverIndex = Math.max(0, Math.min(liveOrderRef.current.length - 1, Math.round(rawTop / ROW_HEIGHT)));
        if (hoverIndex !== startIndex) {
          const next = liveOrderRef.current.slice();
          next.splice(startIndex, 1);
          next.splice(hoverIndex, 0, id);
          liveOrderRef.current = next;
          animateToLivePositions(id);
        }
      },
      onPanResponderRelease: () => finishDrag(id),
      // The gesture was interrupted (e.g. an OS-level interruption) rather
      // than released normally -- still commit wherever it had gotten to,
      // rather than leaving the row visually stranded mid-drag.
      onPanResponderTerminate: () => finishDrag(id),
    });
  }

  // One PanResponder per id. Recreated only when the set/order of ids
  // actually changes (not on every re-render), so dragging one row never
  // drops another row's in-flight responder.
  const panResponders = useMemo(() => {
    const map = new Map<string, PanResponderInstance>();
    for (const id of order) map.set(id, makePanResponder(id));
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order.join('|')]);

  const styles = StyleSheet.create({
    row: {
      position: 'absolute',
      left: 0,
      right: 0,
      height: ROW_HEIGHT,
      flexDirection: 'row',
      alignItems: 'center',
      borderBottomWidth: 1,
      borderBottomColor: colors.cardBorder,
      backgroundColor: colors.card,
    },
    handle: { width: 40, alignItems: 'center', justifyContent: 'center', height: '100%' },
    handleGlyph: { color: colors.muted, fontSize: 20 },
    checkbox: {
      width: 22,
      height: 22,
      borderRadius: 5,
      borderWidth: 1.5,
      borderColor: colors.mutedFaint,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 12,
    },
    checkboxChecked: { backgroundColor: colors.accent, borderColor: colors.accent },
    checkmark: { color: '#fff', fontSize: 13, fontWeight: '700' },
    rowLabel: { color: colors.text, fontSize: 15, fontWeight: '500' },
    rowLabelDisabled: { color: colors.muted },
  });

  return (
    <View style={{ height: order.length * ROW_HEIGHT }}>
      {order.map((id) => {
        const top = topsRef.current.get(id);
        const pan = panResponders.get(id);
        if (!top || !pan) return null;
        const isEnabled = enabled.has(id);
        return (
          <Animated.View key={id} style={[styles.row, { top }]}>
            <View {...pan.panHandlers} style={styles.handle} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Text style={styles.handleGlyph}>⠿</Text>
            </View>
            <TouchableOpacity
              style={[styles.checkbox, isEnabled && styles.checkboxChecked]}
              onPress={() => onToggle(id)}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              {isEnabled && <Text style={styles.checkmark}>✓</Text>}
            </TouchableOpacity>
            <Text style={[styles.rowLabel, !isEnabled && styles.rowLabelDisabled]}>{labelFor(id)}</Text>
          </Animated.View>
        );
      })}
    </View>
  );
}
