// src/components/RuntimeChart.tsx
//
// Output-over-time chart for a TKLamp run, live or saved. The vertical scale is fixed: it starts at 0 and only ever grows
// (to a round number above the highest reading so far), so a light that is slowly dimming looks like it is slowly dimming
// and swiping back never changes it. The horizontal scale is `windowS` seconds across the screen; the chart is wider than
// the screen once the run is longer, and you swipe sideways to look back. `windowS` 0 fits the whole run on screen.
// Time labels run along the bottom (m:ss, or h:mm once past an hour). While `follow` is on, it sticks to the newest data
// until you swipe away; "Latest" jumps back.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, type LayoutChangeEvent } from 'react-native';
import Svg, { Polyline, Line, Text as SvgText } from 'react-native-svg';
import { useTheme } from '../contexts/ThemeContext';

export interface RuntimePoint {
  t: number;   // seconds from the start of the run
  lm: number;
}

const AXIS_W = 40;     // fixed y-axis column
const LABEL_H = 18;    // x-axis labels
const MAX_CONTENT_W = 6000;   // a very wide drawing can fail on some phones, so long runs are squeezed instead
const MAX_DRAWN = 1500;

export function niceCeil(v: number): number {
  if (!(v > 0)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / p;
  const n = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return n * p;
}

export function fmtClock(s: number): string {
  const t = Math.max(0, Math.round(s));
  if (t >= 3600) return `${Math.floor(t / 3600)}:${String(Math.floor((t % 3600) / 60)).padStart(2, '0')}h`;
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

const TICKS = [5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200];

interface Props {
  points: RuntimePoint[];
  /** Seconds visible across the screen; 0 = fit the whole run. */
  windowS: number;
  /** Stick to the newest data (live view). */
  follow?: boolean;
  height?: number;
}

export default function RuntimeChart({ points, windowS, follow = false, height = 170 }: Props) {
  const { colors } = useTheme();
  const [boxW, setBoxW] = useState(0);
  const scroller = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const pinned = useRef(true);
  const [atEnd, setAtEnd] = useState(true);

  const total = points.length ? points[points.length - 1].t : 0;
  const viewW = Math.max(0, boxW - AXIS_W);
  const plotH = height - LABEL_H;

  const g = useMemo(() => {
    if (viewW <= 0) return null;
    let pxPerS = windowS > 0 ? viewW / windowS : total > 0 ? (viewW - 8) / total : 1;
    let contentW = Math.max(viewW, total * pxPerS + 8);
    if (contentW > MAX_CONTENT_W) {
      contentW = MAX_CONTENT_W;
      pxPerS = (MAX_CONTENT_W - 8) / Math.max(1, total);
    }
    const yMax = niceCeil(points.reduce((m, p) => (p.lm > m ? p.lm : m), 0) * 1.05);
    const step = Math.max(1, Math.ceil(points.length / MAX_DRAWN));
    const X = (t: number) => t * pxPerS + 4;
    const Y = (v: number) => plotH - 4 - (v / yMax) * (plotH - 10);
    const pts: string[] = [];
    for (let i = 0; i < points.length; i += step) pts.push(`${X(points[i].t).toFixed(1)},${Y(points[i].lm).toFixed(1)}`);
    if (points.length && (points.length - 1) % step !== 0) pts.push(`${X(points[points.length - 1].t).toFixed(1)},${Y(points[points.length - 1].lm).toFixed(1)}`);
    const tick = TICKS.find((k) => k * pxPerS >= 56) ?? TICKS[TICKS.length - 1];
    const ticks: number[] = [];
    for (let t = 0; t <= total + tick; t += tick) ticks.push(t);
    return { pxPerS, contentW, yMax, X, Y, line: pts.join(' '), ticks };
  }, [points, viewW, windowS, total, plotH]);

  // Follow the newest data until the user swipes away.
  useEffect(() => {
    if (follow && pinned.current && g) scroller.current?.scrollToEnd({ animated: false });
  }, [follow, g?.contentW, points.length]);   // eslint-disable-line react-hooks/exhaustive-deps

  const styles = StyleSheet.create({
    wrap: { flexDirection: 'row', width: '100%' },
    axis: { width: AXIS_W, height },
    latest: { position: 'absolute', right: 6, top: 4, backgroundColor: colors.accent, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
    latestText: { color: '#fff', fontSize: 11, fontWeight: '600' },
  });

  const onLayout = (e: LayoutChangeEvent) => setBoxW(e.nativeEvent.layout.width);

  return (
    <View onLayout={onLayout} style={styles.wrap}>
      {g && (
        <>
          <Svg width={AXIS_W} height={height} style={styles.axis}>
            {[0, 0.5, 1].map((f) => (
              <SvgText key={f} x={AXIS_W - 4} y={g.Y(g.yMax * f) + 4} fontSize={10} fill={colors.muted} textAnchor="end">{Math.round(g.yMax * f)}</SvgText>
            ))}
            <SvgText x={AXIS_W - 4} y={height - 4} fontSize={9} fill={colors.muted} textAnchor="end">lm</SvgText>
          </Svg>
          <View style={{ width: viewW }}>
            <ScrollView
              ref={scroller}
              horizontal
              showsHorizontalScrollIndicator={false}
              scrollEnabled={g.contentW > viewW + 1}
              onScrollBeginDrag={() => { pinned.current = false; }}
              onScroll={(e) => {
                const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
                const end = contentOffset.x + layoutMeasurement.width >= contentSize.width - 12;
                if (end !== atEnd) setAtEnd(end);
                if (end) pinned.current = true;
              }}
              scrollEventThrottle={100}
            >
              <Svg width={g.contentW} height={height}>
                {[0, 0.5, 1].map((f) => (
                  <Line key={f} x1={0} x2={g.contentW} y1={g.Y(g.yMax * f)} y2={g.Y(g.yMax * f)} stroke={colors.cardBorder} strokeWidth={1} />
                ))}
                {g.ticks.map((t) => (
                  <React.Fragment key={t}>
                    <Line x1={g.X(t)} x2={g.X(t)} y1={plotH - 4} y2={plotH + 1} stroke={colors.muted} strokeWidth={1} />
                    <SvgText x={g.X(t)} y={height - 4} fontSize={10} fill={colors.muted} textAnchor={t === 0 ? 'start' : 'middle'}>{fmtClock(t)}</SvgText>
                  </React.Fragment>
                ))}
                {g.line.length > 0 && <Polyline points={g.line} fill="none" stroke={colors.accent} strokeWidth={2} />}
              </Svg>
            </ScrollView>
            {follow && !atEnd && (
              <TouchableOpacity style={styles.latest} onPress={() => { pinned.current = true; scroller.current?.scrollToEnd({ animated: true }); }} accessibilityRole="button" accessibilityLabel="Jump to the latest reading">
                <Text style={styles.latestText}>Latest ▶</Text>
              </TouchableOpacity>
            )}
          </View>
        </>
      )}
    </View>
  );
}
