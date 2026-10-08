// src/components/FlickerChart.tsx
//
// The Flicker page. Two views: the waveform (default) and an IEEE-1789-style
// risk chart. Header controls: pause/play (freeze the display while the meter keeps
// running; amber play icon while frozen), zoom/pan, share, settings gear. A small
// counter shows how many refreshes and how long the current run has gone. Waveform scale matches the stock app: samples are
// divided by the largest sample, the vertical axis runs from (min/max * 0.8)
// to 1.2. The horizontal axis is real time when the meter's sample rate is
// known and agrees with the measured cycle time, otherwise sample numbers.
// Always drawn on white in the stock line colour #204687.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, Share, Alert, StyleSheet, Modal, TextInput, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import Svg, { Line, Polyline, Polygon, Circle, Path, Text as SvgText } from 'react-native-svg';
import { flickerRisk, type FlickerReading } from '../ble/liveSessions';
import { FLICKER_RATE_LABELS, FLICKER_GEAR_LABELS } from '../ble/protocol';
import FlickerSettingsModal, { type FlickerSettingsApi } from './FlickerSettingsModal';

export interface FlickerHistoryPoint {
  f: number;
  p: number;
}

/** Standalone flicker upload to hCRI.io. `send` returns an error message, or null on success. */
export interface FlickerUploadApi {
  defaultTitle: () => Promise<string>;
  send: (reading: FlickerReading, title: string, notes: string) => Promise<string | null>;
}

// Remembered between uploads (until the app closes).
let lastTitle = '';
let lastNotes = '';

interface Props {
  upload?: FlickerUploadApi;
  /** Start a new run, or stop the current one. Absent when the panel only shows a saved reading. */
  onToggle?: () => void;
  /** The reading on screen was captured with a spectrum reading (it goes up/out with that reading). */
  fromReading?: boolean;
  reading: FlickerReading | null;
  running: boolean;
  history: FlickerHistoryPoint[];
  settings?: FlickerSettingsApi;
  width: number;
  height: number;
}

const LINE = '#204687';
const HEAD_H = 26;
const STATS_H = 30;
const ACT_H = 36;
const RISK_H = 20;

const HOLD_COLOR = '#c47f00';

// Header icons (24x24 grid, stroke style like the rest of the app's icons).
const ICON_SHARE = 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12';
const ICON_GEAR =
  'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z';
const ICON_UPLOAD = 'M16 16l-4-4-4 4M12 12v9M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3';
const ICON_HELP = 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01';
const ICON_PAUSE = 'M7 5h3.5v14H7zM13.5 5H17v14h-3.5z';
const ICON_PLAY = 'M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z';

function HeaderIcon({ d, color, fill, size = 15 }: { d: string; color: string; fill?: boolean; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={fill ? color : 'none'} stroke={fill ? 'none' : color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d={d} />
    </Svg>
  );
}

function fmtElapsed(ms: number): string {
  const t = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

const RISK_TEXT = { none: 'No Risk', low: 'Low Risk', high: 'High Risk' } as const;
const RISK_COLOR = { none: '#2e8b4f', low: '#c47f00', high: '#cc2828' } as const;
const RISK_TINT = { none: 'rgba(46,139,79,0.16)', low: 'rgba(196,127,0,0.18)', high: 'rgba(204,40,40,0.16)' } as const;

/** Dominant period of the waveform in samples (smallest lag with near-best autocorrelation), or null if it's flat. */
function detectPeriod(norm: number[]): number | null {
  const n = norm.length;
  const mean = norm.reduce((a, b) => a + b, 0) / n;
  const x = norm.map((v) => v - mean);
  const var0 = x.reduce((a, b) => a + b * b, 0);
  if (var0 < 1e-6) return null;
  const maxLag = Math.floor(n / 2);
  const ac: number[] = [];
  for (let lag = 0; lag <= maxLag; lag++) {
    let sum = 0;
    for (let i = 0; i + lag < n; i++) sum += x[i] * x[i + lag];
    ac.push(sum / var0);
  }
  let best = 0;
  for (let lag = 3; lag <= maxLag; lag++) if (ac[lag] > best) best = ac[lag];
  if (best < 0.3) return null;
  for (let lag = 3; lag <= maxLag; lag++) {
    if (ac[lag] >= best * 0.92 && ac[lag] >= ac[lag - 1] && ac[lag] >= (ac[lag + 1] ?? -1)) return lag;
  }
  return null;
}

function fmtMs(ms: number): string {
  if (ms >= 1000) return `${+(ms / 1000).toFixed(ms >= 10000 ? 0 : 1)} s`;
  return `${+ms.toFixed(ms >= 100 ? 0 : ms >= 10 ? 1 : 2)} ms`;
}

// IEEE 1789-style bands (the same ones the risk tip uses): [freq, percent] polylines, stepped at 8 and 90 Hz.
const HIGH_LINE: [number, number][] = [[1, 0.2], [8, 0.2], [90, 2.25], [90, 7.2], [2000, 160]];
const LOW_LINE: [number, number][] = [[1, 0.1], [8, 0.1], [8, 0.08], [90, 0.9], [90, 3], [2000, 66.6]];

export default function FlickerChart({ reading, running, history, settings, upload, onToggle, fromReading, width, height }: Props) {
  const [snap, setSnap] = useState<FlickerReading | null>(null);
  const [showUpload, setShowUpload] = useState(false);
  const [upTitle, setUpTitle] = useState('');
  const [upNotes, setUpNotes] = useState('');
  const [upBusy, setUpBusy] = useState(false);
  const [upMsg, setUpMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [view, setView] = useState<'wave' | 'risk'>('wave');
  const [zoom, setZoom] = useState(1);
  const [start, setStart] = useState(0);

  const shown = reading;

  // Run counter: refreshes received and time since this run started (resets each time Flicker is started).
  const [refreshes, setRefreshes] = useState(0);
  const [runMs, setRunMs] = useState(0);
  const runStart = useRef(0);
  useEffect(() => {
    if (!running) return;
    // A fresh run starts un-zoomed.
    setZoom(1);
    setStart(0);
    runStart.current = Date.now();
    setRefreshes(0);
    setRunMs(0);
    const t = setInterval(() => setRunMs(Date.now() - runStart.current), 1000);
    return () => clearInterval(t);
  }, [running]);
  useEffect(() => {
    if (running && reading) setRefreshes((c) => c + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reading]);

  const styles = StyleSheet.create({
    head: { flexDirection: 'row', alignItems: 'center', height: HEAD_H },
    seg: { flexDirection: 'row', borderWidth: 1, borderColor: '#C5C9D3', borderRadius: 6, overflow: 'hidden' },
    segBtn: { paddingHorizontal: 8, paddingVertical: 3 },
    segOn: { backgroundColor: LINE },
    segTxt: { fontSize: 11, fontWeight: '700', color: LINE },
    segTxtOn: { color: '#fff' },
    spacer: { flex: 1 },
    pill: { marginLeft: 5, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6, borderWidth: 1, borderColor: '#C5C9D3' },
    pillOn: { backgroundColor: LINE, borderColor: LINE },
    pillTxt: { fontSize: 11, fontWeight: '700', color: LINE },
    pillTxtOn: { color: '#fff' },
    iconPill: { marginLeft: 5, width: 30, height: 22, borderRadius: 6, borderWidth: 1, borderColor: '#C5C9D3', alignItems: 'center', justifyContent: 'center' },
    holdOn: { backgroundColor: HOLD_COLOR, borderColor: HOLD_COLOR },
    counter: { position: 'absolute', left: 2, fontSize: 11, fontWeight: '600' },
    settingTag: { position: 'absolute', right: 2, fontSize: 11, fontWeight: '600', color: '#666' },
    statsRow: { flexDirection: 'row', height: STATS_H },
    stat: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    statVal: { color: '#111', fontSize: 12.5, fontWeight: '700' },
    statLabel: { color: '#666', fontSize: 9, marginTop: 0 },
    actRow: { height: ACT_H, flexDirection: 'row', borderTopWidth: 1, borderTopColor: '#e3e5ea' },
    actBtn: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    actTxt: { fontSize: 10, fontWeight: '600', marginTop: 0 },
    riskRow: { height: RISK_H, flexDirection: 'row', justifyContent: 'center', alignItems: 'center' },
    badge: { paddingHorizontal: 10, paddingVertical: 2, borderRadius: 10 },
    badgeTxt: { fontSize: 11.5, fontWeight: '700' },
    hint: { color: '#666', fontSize: 12.5, textAlign: 'center' },
    startPill: { flexDirection: 'row', alignItems: 'center', marginTop: 14, backgroundColor: LINE, borderRadius: 18, paddingHorizontal: 18, paddingVertical: 8 },
    startPillTxt: { color: '#fff', fontSize: 13, fontWeight: '700', marginLeft: 6 },
  });

  const wf = shown?.waveform;
  const analysis = useMemo(() => {
    if (!wf || !wf.length) return null;
    const n = wf.length;
    const max = Math.max(...wf);
    const min = Math.min(...wf);
    const norm = wf.map((v) => (v === 0 || max === 0 ? 0 : v / max));
    const period = detectPeriod(norm);
    let first = 0;
    if (period) {
      let bestV = -1;
      for (let i = 0; i < Math.min(period, n); i++) if (norm[i] > bestV) { bestV = norm[i]; first = i; }
    }
    // Duty cycle estimate: share of samples above the waveform's midpoint (the meter's own duty figure only
    // arrives with regular spectrum readings, see the notes in the app).
    const mid = (max + min) / 2;
    const duty = max === min ? 100 : (wf.filter((v) => v > mid).length / n) * 100;
    return { n, max, min, norm, period, first, duty };
  }, [wf]);

  const showHelp = () =>
    Alert.alert(
      'Flicker readings',
      'Live flicker: tap Start to measure continuously. The chart updates about every second. Pause stops the run and keeps the last reading on screen, which you can then Share or Upload to hCRI.io.\n\n' +
        'Flicker with a reading: turn on "Capture flicker with each reading" in Settings and one flicker snapshot is taken right after each spectrum reading. It is saved with that reading and goes up to hCRI.io with it, so Share and Upload are not shown for it.\n\n' +
        'The gear sets the meter’s flicker range and sample rate.'
    );
  const headRight = (
    <>
      <TouchableOpacity style={styles.iconPill} onPress={showHelp} accessibilityLabel="About flicker readings" hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}>
        <HeaderIcon d={ICON_HELP} color={LINE} size={16} />
      </TouchableOpacity>
      {settings && (
        <TouchableOpacity style={styles.iconPill} onPress={() => setShowSettings(true)} accessibilityLabel="Flicker settings" hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}>
          <HeaderIcon d={ICON_GEAR} color={LINE} size={16} />
        </TouchableOpacity>
      )}
    </>
  );
  const canRun = !!onToggle && !fromReading; // a flicker captured with a reading is read-only: no Start/Pause
  const startBtn = (
    <TouchableOpacity style={styles.actBtn} onPress={onToggle} accessibilityLabel={running ? 'Pause flicker' : 'Start flicker'}>
      <HeaderIcon d={running ? ICON_PAUSE : ICON_PLAY} color={LINE} fill size={20} />
      <Text style={[styles.actTxt, { color: LINE }]} allowFontScaling={false}>{running ? 'Pause' : 'Start'}</Text>
    </TouchableOpacity>
  );

  if (!shown || !analysis) {
    return (
      <View style={{ height }}>
        <View style={[styles.head, { justifyContent: 'flex-end' }]}>{headRight}</View>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 }}>
          <Text style={styles.hint}>
            {running ? 'Waiting for the meter…' : canRun ? 'Tap Start to measure this light’s flicker.' : 'No flicker reading.'}
          </Text>
          {canRun && (
            <TouchableOpacity style={[styles.startPill]} onPress={onToggle} accessibilityLabel={running ? 'Pause flicker' : 'Start flicker'}>
              <HeaderIcon d={running ? ICON_PAUSE : ICON_PLAY} color="#fff" fill size={16} />
              <Text style={styles.startPillTxt} allowFontScaling={false}>{running ? 'Pause' : 'Start'}</Text>
            </TouchableOpacity>
          )}
        </View>
        {settings && <FlickerSettingsModal visible={showSettings} onClose={() => setShowSettings(false)} api={settings} />}
      </View>
    );
  }

  const { n, max, min, norm, period, first, duty } = analysis;
  // The meter's sample rate and range for this run, e.g. "20 kHz · x10".
  const settingTxt = [
    shown.sampleIdx !== undefined ? FLICKER_RATE_LABELS[shown.sampleIdx] : null,
    shown.gear !== undefined ? FLICKER_GEAR_LABELS[shown.gear] : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const fmt = (v: number) => (Number.isFinite(v) ? v : 0);
  const risk = flickerRisk(shown.frequencyHz, shown.percentFlicker);

  // Time axis only if the meter's span is known AND agrees with what was measured (cycles per capture).
  let msPerSample: number | null = null;
  if (shown.spanMs && period && shown.cycleMs > 0) {
    const cyclesOnChart = n / period;
    const expected = shown.spanMs / shown.cycleMs;
    const ratio = cyclesOnChart / expected;
    if (ratio > 0.6 && ratio < 1.6) msPerSample = shown.spanMs / n;
  }

  const win = Math.max(20, Math.floor(n / zoom));
  const s0 = Math.min(Math.max(0, start), n - win);
  const setZoomLevel = (z: number) => {
    setZoom(z);
    setStart(0);
  };
  const pan = (dir: number) => setStart((s) => Math.min(Math.max(0, s + dir * Math.floor(win / 2)), n - win));

  const share = () => {
    const lines = [
      `Flicker: ${fmt(shown.frequencyHz).toFixed(1)} Hz, ${fmt(shown.percentFlicker).toFixed(1)} %, index ${fmt(shown.flickerIndex).toFixed(3)}, cycle ${fmt(shown.cycleMs).toFixed(1)} ms (${RISK_TEXT[risk]})`,
      msPerSample ? `Waveform spans ${shown.spanMs} ms` : 'Waveform (sample numbers)',
      shown.waveform.join(','),
    ];
    Share.share({ message: lines.join('\n') }).catch(() => {});
  };

  const openUpload = async () => {
    if (!upload) return;
    setSnap(shown); // upload exactly the frame on screen
    setUpMsg(null);
    setUpNotes(lastNotes);
    setUpTitle(lastTitle || (await upload.defaultTitle().catch(() => '')));
    setShowUpload(true);
  };
  const doUpload = async () => {
    if (!upload || upBusy) return;
    setUpBusy(true);
    const err = await upload.send(snap ?? shown, upTitle.trim(), upNotes.trim()).catch((e: any) => String(e?.message ?? e));
    setUpBusy(false);
    if (err) {
      setUpMsg({ ok: false, text: err });
    } else {
      lastTitle = upTitle.trim();
      lastNotes = upNotes.trim();
      setUpMsg({ ok: true, text: 'Uploaded to hCRI.io' });
      setTimeout(() => setShowUpload(false), 900);
    }
  };

  const bodyH = Math.max(40, height - HEAD_H - STATS_H - RISK_H - (canRun ? ACT_H : 0) - 2);

  // ---------------- waveform view ----------------
  const renderWave = () => {
    const padL = 30, padR = 8, padT = 16, padB = 18;
    const plotW = Math.max(10, width - padL - padR);
    const plotH = Math.max(10, bodyH - padT - padB);
    const yMax = max === 0 ? 1 : 1.2;
    const yMin = max === 0 ? 0 : Math.round((min / max) * 0.8 * 10) / 10;
    const x = (i: number) => padL + ((i - s0) / Math.max(1, win - 1)) * plotW;
    const y = (v: number) => padT + (1 - (v - yMin) / (yMax - yMin)) * plotH;
    const yTicks: number[] = [];
    const step = yMax - yMin > 0.8 ? 0.2 : 0.1;
    for (let t = Math.ceil(yMin / step) * step; t <= yMax + 1e-9; t += step) yTicks.push(Math.round(t * 100) / 100);
    const pts = norm.slice(s0, s0 + win).map((v, k) => `${x(s0 + k).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    const xTickIdx = [0, 1, 2, 3, 4].map((k) => s0 + Math.round((k / 4) * (win - 1)));
    const tickLabel = (i: number) => (msPerSample ? fmtMs(i * msPerSample) : String(i));
    // One-cycle bracket from the first peak (if the whole cycle is in view).
    const showCycle = !!period && first >= s0 && first + period <= s0 + win - 1;
    return (
      <Svg width={width} height={bodyH}>
        {yTicks.map((t) => (
          <React.Fragment key={t}>
            <Line x1={padL} x2={padL + plotW} y1={y(t)} y2={y(t)} stroke="#e3e5ea" strokeWidth={1} />
            <SvgText x={padL - 4} y={y(t) + 3} fontSize={9} fill="#666" textAnchor="end">{t.toFixed(1)}</SvgText>
          </React.Fragment>
        ))}
        {xTickIdx.map((i, k) => (
          <React.Fragment key={k}>
            <Line x1={x(i)} x2={x(i)} y1={padT} y2={padT + plotH} stroke="#eef0f3" strokeWidth={1} />
            <SvgText x={x(i)} y={padT + plotH + 12} fontSize={9} fill="#666" textAnchor={k === 0 ? 'start' : k === 4 ? 'end' : 'middle'}>{tickLabel(i)}</SvgText>
          </React.Fragment>
        ))}
        <Line x1={padL} x2={padL} y1={padT} y2={padT + plotH} stroke="#C5C9D3" strokeWidth={1} />
        <Line x1={padL} x2={padL + plotW} y1={padT + plotH} y2={padT + plotH} stroke="#C5C9D3" strokeWidth={1} />
        <Polyline points={pts} fill="none" stroke={LINE} strokeWidth={1.6} strokeLinejoin="round" />
        {showCycle && period ? (
          <>
            <Line x1={x(first)} x2={x(first + period)} y1={8} y2={8} stroke="#c47f00" strokeWidth={1.5} />
            <Line x1={x(first)} x2={x(first)} y1={4} y2={12} stroke="#c47f00" strokeWidth={1.5} />
            <Line x1={x(first + period)} x2={x(first + period)} y1={4} y2={12} stroke="#c47f00" strokeWidth={1.5} />
            <SvgText x={Math.min(padL + plotW - 4, Math.max(padL + 4, (x(first) + x(first + period)) / 2))} y={padT + 11} fontSize={9.5} fill="#c47f00" textAnchor={(x(first) + x(first + period)) / 2 < padL + 50 ? 'start' : (x(first) + x(first + period)) / 2 > padL + plotW - 50 ? 'end' : 'middle'} fontWeight="bold">
              {msPerSample ? `1 cycle = ${fmtMs(period * msPerSample)}` : `1 cycle ≈ ${period} samples`}
            </SvgText>
          </>
        ) : null}
      </Svg>
    );
  };

  // ---------------- risk chart view ----------------
  const renderRisk = () => {
    const padL = 34, padR = 10, padT = 8, padB = 28;
    const plotW = Math.max(10, width - padL - padR);
    const plotH = Math.max(10, bodyH - padT - padB);
    const X0 = Math.log10(1), X1 = Math.log10(2000), Y0 = Math.log10(0.01), Y1 = Math.log10(100);
    const clampY = (v: number) => Math.min(Y1, Math.max(Y0, Math.log10(Math.max(v, 1e-9))));
    const px = (f: number) => padL + ((Math.log10(Math.max(f, 1)) - X0) / (X1 - X0)) * plotW;
    const py = (p: number) => padT + (1 - (clampY(p) - Y0) / (Y1 - Y0)) * plotH;
    const line = (pts: [number, number][]) => pts.map(([f, p]) => `${px(f).toFixed(1)},${py(p).toFixed(1)}`);
    const top = [`${px(2000)},${py(100)}`, `${px(1)},${py(100)}`];
    const bottom = [`${px(2000)},${py(0.01)}`, `${px(1)},${py(0.01)}`];
    const redPoly = [...line(HIGH_LINE), ...top].join(' ');
    const greenPoly = [...line(LOW_LINE), ...bottom].join(' ');
    const amberPoly = [...line(HIGH_LINE), ...line([...LOW_LINE].reverse())].join(' ');
    const xTicks = [1, 10, 100, 1000];
    const yTicks = [0.01, 0.1, 1, 10, 100];
    const trail = history.slice(-30);
    return (
      <Svg width={width} height={bodyH}>
        <Polygon points={redPoly} fill={RISK_TINT.high} />
        <Polygon points={amberPoly} fill={RISK_TINT.low} />
        <Polygon points={greenPoly} fill={RISK_TINT.none} />
        {yTicks.map((t) => (
          <React.Fragment key={t}>
            <Line x1={padL} x2={padL + plotW} y1={py(t)} y2={py(t)} stroke="#d7dae0" strokeWidth={0.8} />
            <SvgText x={padL - 4} y={py(t) + 3} fontSize={9} fill="#666" textAnchor="end">{t >= 1 ? `${t}%` : `${t}%`}</SvgText>
          </React.Fragment>
        ))}
        {xTicks.map((t) => (
          <React.Fragment key={t}>
            <Line x1={px(t)} x2={px(t)} y1={padT} y2={padT + plotH} stroke="#d7dae0" strokeWidth={0.8} />
            <SvgText x={px(t)} y={padT + plotH + 12} fontSize={9} fill="#666" textAnchor="middle">{t}</SvgText>
          </React.Fragment>
        ))}
        <Polyline points={line(HIGH_LINE).join(' ')} fill="none" stroke="#cc2828" strokeWidth={1.2} />
        <Polyline points={line(LOW_LINE).join(' ')} fill="none" stroke="#2e8b4f" strokeWidth={1.2} />
        {trail.map((h, i) => (
          <Circle key={i} cx={px(h.f)} cy={py(h.p)} r={2} fill={LINE} opacity={0.15 + (0.55 * (i + 1)) / trail.length} />
        ))}
        <Circle cx={px(shown.frequencyHz)} cy={py(shown.percentFlicker)} r={5} fill={LINE} stroke="#fff" strokeWidth={1.5} />
        <SvgText x={padL + plotW / 2} y={bodyH - 2} fontSize={9} fill="#666" textAnchor="middle">Frequency (Hz) vs flicker (%)</SvgText>
      </Svg>
    );
  };

  return (
    <View style={{ height }}>
      <View style={styles.head}>
        <View style={styles.seg}>
          <TouchableOpacity style={[styles.segBtn, view === 'wave' && styles.segOn]} onPress={() => setView('wave')}>
            <Text style={[styles.segTxt, view === 'wave' && styles.segTxtOn]} allowFontScaling={false}>Wave</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.segBtn, view === 'risk' && styles.segOn]} onPress={() => setView('risk')}>
            <Text style={[styles.segTxt, view === 'risk' && styles.segTxtOn]} allowFontScaling={false}>Risk</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.spacer} />
        {view === 'wave' && (
          <>
            {zoom > 1 && (
              <>
                <TouchableOpacity style={styles.pill} onPress={() => pan(-1)}><Text style={styles.pillTxt} allowFontScaling={false}>◀</Text></TouchableOpacity>
                <TouchableOpacity style={styles.pill} onPress={() => pan(1)}><Text style={styles.pillTxt} allowFontScaling={false}>▶</Text></TouchableOpacity>
              </>
            )}
            <TouchableOpacity style={[styles.pill, zoom > 1 && styles.pillOn]} onPress={() => setZoomLevel(zoom === 1 ? 2 : zoom === 2 ? 4 : zoom === 4 ? 8 : 1)}>
              <Text style={[styles.pillTxt, zoom > 1 && styles.pillTxtOn]} allowFontScaling={false}>{zoom}×</Text>
            </TouchableOpacity>
          </>
        )}
        {headRight}
      </View>
      <View style={styles.statsRow}>
        <View style={styles.stat}>
          <Text style={styles.statVal} allowFontScaling={false}>{fmt(shown.frequencyHz).toFixed(1)}</Text>
          <Text style={styles.statLabel} allowFontScaling={false}>Freq (Hz)</Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.statVal} allowFontScaling={false}>{fmt(shown.percentFlicker).toFixed(1)}</Text>
          <Text style={styles.statLabel} allowFontScaling={false}>Flicker %</Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.statVal} allowFontScaling={false}>{fmt(shown.flickerIndex).toFixed(3)}</Text>
          <Text style={styles.statLabel} allowFontScaling={false}>Index</Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.statVal} allowFontScaling={false}>{fmt(shown.cycleMs).toFixed(1)}</Text>
          <Text style={styles.statLabel} allowFontScaling={false}>Cycle (ms)</Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.statVal} allowFontScaling={false}>{duty.toFixed(0)}</Text>
          <Text style={styles.statLabel} allowFontScaling={false}>Duty ≈ %</Text>
        </View>
      </View>
      <View style={styles.riskRow}>
        {(running || refreshes > 0) && (
          <Text style={[styles.counter, { color: running ? RISK_COLOR.none : HOLD_COLOR }]} allowFontScaling={false} numberOfLines={1}>
            {running ? '● ' : 'Stopped '}{refreshes} · {fmtElapsed(runMs)}
          </Text>
        )}
        <View style={[styles.badge, { backgroundColor: RISK_TINT[risk] }]}>
          <Text style={[styles.badgeTxt, { color: RISK_COLOR[risk] }]} allowFontScaling={false} numberOfLines={1}>
            Risk tip: {RISK_TEXT[risk]}
          </Text>
        </View>
        {!!settingTxt && <Text style={styles.settingTag} allowFontScaling={false} numberOfLines={1}>{settingTxt}</Text>}
      </View>
      {view === 'wave' ? renderWave() : renderRisk()}
      {canRun && (
        <View style={styles.actRow}>
          {startBtn}
          {!fromReading && (
            <TouchableOpacity style={styles.actBtn} onPress={share} accessibilityLabel="Share flicker reading">
              <HeaderIcon d={ICON_SHARE} color={LINE} size={20} />
              <Text style={[styles.actTxt, { color: LINE }]} allowFontScaling={false}>Share</Text>
            </TouchableOpacity>
          )}
          {!fromReading && upload && (
            <TouchableOpacity style={styles.actBtn} onPress={openUpload} accessibilityLabel="Upload flicker to hCRI.io">
              <HeaderIcon d={ICON_UPLOAD} color={LINE} size={20} />
              <Text style={[styles.actTxt, { color: LINE }]} allowFontScaling={false}>Upload flicker</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
      {settings && <FlickerSettingsModal visible={showSettings} onClose={() => setShowSettings(false)} api={settings} />}
      {upload && (
        <Modal visible={showUpload} transparent animationType="fade" onRequestClose={() => { if (!upBusy) setShowUpload(false); }}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: 20 }}>
            <View style={{ backgroundColor: '#fff', borderRadius: 12, padding: 16 }}>
              <Text style={{ fontSize: 16, fontWeight: '700', color: '#111', marginBottom: 10 }}>Upload flicker to hCRI.io</Text>
              <Text style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>Title</Text>
              <TextInput
                value={upTitle}
                onChangeText={setUpTitle}
                multiline
                numberOfLines={2}
                selectTextOnFocus
                style={{ borderWidth: 1, borderColor: '#C5C9D3', borderRadius: 8, padding: 8, minHeight: 56, textAlignVertical: 'top', color: '#111' }}
              />
              <Text style={{ fontSize: 12, color: '#666', marginTop: 10, marginBottom: 4 }}>Notes (optional)</Text>
              <TextInput
                value={upNotes}
                onChangeText={setUpNotes}
                multiline
                numberOfLines={4}
                style={{ borderWidth: 1, borderColor: '#C5C9D3', borderRadius: 8, padding: 8, minHeight: 90, textAlignVertical: 'top', color: '#111' }}
              />
              {!!upMsg && <Text style={{ marginTop: 10, color: upMsg.ok ? RISK_COLOR.none : RISK_COLOR.high, fontSize: 13 }}>{upMsg.text}</Text>}
              <View style={{ flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', marginTop: 14 }}>
                <TouchableOpacity onPress={() => setShowUpload(false)} disabled={upBusy} style={{ padding: 10 }}>
                  <Text style={{ color: LINE, fontWeight: '700' }}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={doUpload} disabled={upBusy} style={{ backgroundColor: LINE, borderRadius: 8, paddingHorizontal: 18, paddingVertical: 10, marginLeft: 8, minWidth: 90, alignItems: 'center' }}>
                  {upBusy ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff', fontWeight: '700' }}>Upload</Text>}
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAvoidingView>
        </Modal>
      )}
    </View>
  );
}
