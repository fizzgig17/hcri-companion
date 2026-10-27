// src/components/TkLampLive.tsx
//
// The Main tab's content while a TKLamp tester is behind the bridge: a big live lumen number, a rolling chart of the last
// couple of minutes, and Record / Stop. A finished recording uploads to the signed-in user's private Runtime list on
// hCRI.io (label, 1 s curve in lumens). Lumens = the tester's raw count / "counts per lumen" (editable, saved on the
// phone); see ble/tklamp.ts for where 313.2 comes from.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TextInput, Alert, StyleSheet } from 'react-native';
import Svg, { Polyline, Line, Text as SvgText } from 'react-native-svg';
import { useTheme } from '../contexts/ThemeContext';
import PrimaryButton from './PrimaryButton';
import type { MeterConnection } from '../ble/MeterConnection';
import { TK_RAW_PER_LM_DEFAULT, TkRecorder, TkSmoother, defaultRunLabel, getTkRawPerLm, onTkRawPerLm, resampleRun, scaleFromLamp, setTkRawPerLm, tkLumens, type TkSample } from '../ble/tklamp';
import { addRuntime, deleteRuntime, updateRuntime } from '../storage/runtimeHistory';
import { loadHcriCredentials } from '../storage/secureStorage';
import { loadTkScalePreference, saveTkScalePreference } from '../storage/preferences';
import { uploadRuntimeToHcri } from '../hcri/uploadRuntimeToHcri';

const WINDOW_S = 120;       // chart shows the last two minutes
const CHART_H = 140;
const CHART_W = 320;

interface Props {
  conn: MeterConnection | null;
}

function fmtDur(s: number): string {
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${String(r).padStart(2, '0')}`;
}

export default function TkLampLive({ conn }: Props) {
  const { colors } = useTheme();
  const [rawPerLm, setRawPerLm] = useState(getTkRawPerLm());
  const [lampDraft, setLampDraft] = useState('');
  const savedId = useRef<string | null>(null);
  const [lm, setLm] = useState<number | null>(null);
  const [trace, setTrace] = useState<{ t: number; lm: number }[]>([]);
  const [recording, setRecording] = useState(false);
  const [recSeconds, setRecSeconds] = useState(0);
  const [recCount, setRecCount] = useState(0);
  const [finished, setFinished] = useState<boolean>(false);
  const [label, setLabel] = useState(defaultRunLabel());
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [stale, setStale] = useState(false);

  const smoother = useRef(new TkSmoother(5));
  const recorder = useRef(new TkRecorder());
  const recordingRef = useRef(false);
  const scaleRef = useRef(rawPerLm);
  const lastRx = useRef(0);
  const lastDraw = useRef(0);
  const traceRef = useRef<{ t: number; lm: number }[]>([]);
  const t0 = useRef<number | null>(null);

  useEffect(() => {
    loadTkScalePreference(TK_RAW_PER_LM_DEFAULT).then(setTkRawPerLm);
    return onTkRawPerLm((v) => {
      scaleRef.current = v;
      setRawPerLm(v);
      smoother.current.reset();
    });
  }, []);

  useEffect(() => {
    if (!conn) return;
    const off = conn.onTkSample((s: TkSample) => {
      lastRx.current = Date.now();
      if (t0.current == null) t0.current = s.ms;
      const t = (s.ms - t0.current) / 1000;
      const v = tkLumens(s.raw, scaleRef.current);
      const avg = smoother.current.push(v);
      traceRef.current.push({ t, lm: avg });
      const cutoff = t - WINDOW_S;
      while (traceRef.current.length && traceRef.current[0].t < cutoff) traceRef.current.shift();
      if (recordingRef.current) recorder.current.add(s, scaleRef.current);
      const now = Date.now();
      if (now - lastDraw.current > 250) {   // redraw about 4 times a second, however fast readings arrive
        lastDraw.current = now;
        setLm(avg);
        setTrace(traceRef.current.slice());
        setStale(false);
        if (recordingRef.current) {
          setRecSeconds(recorder.current.seconds);
          setRecCount(recorder.current.count);
        }
      }
    });
    const timer = setInterval(() => {
      if (lastRx.current && Date.now() - lastRx.current > 5000) setStale(true);
    }, 1000);
    return () => {
      off();
      clearInterval(timer);
    };
  }, [conn]);

  // Calibrate from a lamp of known output: a steady reading of it, taken at the current scale, sets the new scale.
  const calibrate = useCallback(() => {
    const known = Number(lampDraft.replace(',', '.'));
    const v = scaleFromLamp(smoother.current.value(), scaleRef.current, known);
    if (v == null) {
      Alert.alert('Enter the lamp\'s lumens', 'Put the lamp in the sphere, wait for a steady number, then enter its rated lumens (for example 2150).');
      return;
    }
    Alert.alert('Use this scale?', `The lamp reads ${smoother.current.value().toFixed(0)} lm now. A scale of ${v} counts per lumen would make it read ${known}.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Use it', onPress: () => { setTkRawPerLm(v); saveTkScalePreference(v).catch(() => {}); setLampDraft(''); } },
    ]);
  }, [lampDraft]);

  const start = () => {
    recorder.current.reset();
    recordingRef.current = true;
    setRecording(true);
    setFinished(false);
    setRecSeconds(0);
    setRecCount(0);
    setNote(null);
    setLabel(defaultRunLabel());
  };
  const stop = () => {
    recordingRef.current = false;
    setRecording(false);
    setRecSeconds(recorder.current.seconds);
    setRecCount(recorder.current.count);
    setFinished(recorder.current.count > 1);
    if (recorder.current.count <= 1) setNote('Nothing recorded. Make sure readings are coming in, then try again.');
    // Keep every finished run on the phone (History > Runtime), whether or not it is uploaded.
    const r = resampleRun(recorder.current.points());
    savedId.current = null;
    if (r) {
      const l = label.trim() || defaultRunLabel();
      addRuntime({ label: l, intervalSeconds: r.intervalSeconds, values: r.values, rawPerLm: scaleRef.current })
        .then((e) => { savedId.current = e.id; })
        .catch(() => setNote('The run could not be saved on this phone.'));
    }
  };
  const discard = () => {
    recorder.current.reset();
    if (savedId.current) deleteRuntime(savedId.current).catch(() => {});
    savedId.current = null;
    setFinished(false);
    setNote(null);
  };
  const upload = async () => {
    const r = resampleRun(recorder.current.points());
    if (!r) {
      setNote('The recording is too short to upload.');
      return;
    }
    setBusy(true);
    setNote(null);
    try {
      const creds = await loadHcriCredentials();
      if (!creds?.token) {
        setNote('Sign in to hCRI.io in Settings first, then upload.');
        return;
      }
      const err = await uploadRuntimeToHcri({
        label: label.trim() || defaultRunLabel(),
        group: 'TKLamp',
        unit: 'lm',
        intervalSeconds: r.intervalSeconds,
        values: r.values,
      }, creds.token);
      if (err) {
        setNote(err);
      } else {
        if (savedId.current) await updateRuntime(savedId.current, { label: label.trim() || defaultRunLabel(), uploaded: true }).catch(() => {});
        savedId.current = null;
        setFinished(false);
        recorder.current.reset();
        Alert.alert('Uploaded', `${label.trim() || 'Run'} is in your Runtime list on hCRI.io (Explore > Runtime).`);
      }
    } finally {
      setBusy(false);
    }
  };

  const chart = useMemo(() => {
    if (trace.length < 2) return null;
    const tMax = trace[trace.length - 1].t;
    const tMin = Math.max(trace[0].t, tMax - WINDOW_S);
    const span = Math.max(1, tMax - tMin);
    const vals = trace.map((p) => p.lm);
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    const pad = Math.max(1, (hi - lo) * 0.15, hi * 0.01);
    const yLo = Math.max(0, lo - pad);
    const yHi = hi + pad;
    const X = (t: number) => ((t - tMin) / span) * (CHART_W - 8) + 4;
    const Y = (v: number) => CHART_H - 16 - ((v - yLo) / (yHi - yLo)) * (CHART_H - 28);
    return {
      pts: trace.map((p) => `${X(p.t).toFixed(1)},${Y(p.lm).toFixed(1)}`).join(' '),
      yHi, yLo, span,
    };
  }, [trace]);

  const styles = StyleSheet.create({
    wrap: { flex: 1 },
    big: { color: colors.text, fontSize: 64, fontWeight: '700', textAlign: 'center', marginTop: 4 },
    unit: { color: colors.muted, fontSize: 16, textAlign: 'center', marginTop: -6 },
    stale: { color: colors.danger, fontSize: 13, textAlign: 'center', marginTop: 4 },
    chartBox: { marginTop: 10, alignItems: 'center' },
    row: { flexDirection: 'row', alignItems: 'center', marginTop: 10 },
    fieldLabel: { color: colors.muted, fontSize: 11, marginBottom: 4 },
    input: { flex: 1, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.cardBorder, borderRadius: 8, color: colors.text, paddingHorizontal: 10, paddingVertical: 8, fontSize: 14 },
    rec: { color: colors.danger, fontSize: 14, fontWeight: '600', textAlign: 'center', marginTop: 10 },
    note: { color: colors.warning, fontSize: 13, marginTop: 8, textAlign: 'center' },
    small: { color: colors.muted, fontSize: 11, marginTop: 8, textAlign: 'center' },
  });

  return (
    <View style={styles.wrap}>
      <Text style={styles.big}>{lm == null ? '—' : lm >= 100 ? lm.toFixed(0) : lm.toFixed(1)}</Text>
      <Text style={styles.unit}>lumens (1 s average)</Text>
      {stale && <Text style={styles.stale}>No readings for 5 s. Is the tester still on and connected?</Text>}

      <View style={styles.chartBox}>
        <Svg width={CHART_W} height={CHART_H}>
          <Line x1={4} y1={CHART_H - 16} x2={CHART_W - 4} y2={CHART_H - 16} stroke={colors.cardBorder} strokeWidth={1} />
          {chart && <Polyline points={chart.pts} fill="none" stroke={colors.accent} strokeWidth={2} />}
          {chart && <SvgText x={6} y={11} fontSize={10} fill={colors.muted}>{Math.round(chart.yHi)}</SvgText>}
          {chart && <SvgText x={6} y={CHART_H - 20} fontSize={10} fill={colors.muted}>{Math.round(chart.yLo)}</SvgText>}
          <SvgText x={CHART_W - 6} y={CHART_H - 3} fontSize={10} fill={colors.muted} textAnchor="end">last {Math.min(WINDOW_S, Math.round(chart?.span ?? 0))} s</SvgText>
        </Svg>
      </View>

      {recording && <Text style={styles.rec}>● Recording {fmtDur(recSeconds)} ({recCount} readings)</Text>}

      {!recording && !finished && <PrimaryButton title="Record run" onPress={start} disabled={lm == null || stale} />}
      {recording && <PrimaryButton title="Stop recording" onPress={stop} variant="danger" />}
      {finished && !recording && (
        <View>
          <Text style={styles.fieldLabel}>Name on hCRI.io (same name replaces an earlier run)</Text>
          <TextInput style={styles.input} value={label} onChangeText={setLabel} autoCapitalize="none" autoCorrect={false} maxLength={160} />
          <Text style={styles.small}>{fmtDur(recSeconds)} recorded, {recCount} readings</Text>
          <PrimaryButton title={busy ? 'Uploading…' : 'Upload to Runtime'} onPress={upload} disabled={busy} />
          <PrimaryButton title="Discard" onPress={discard} variant="muted" disabled={busy} />
        </View>
      )}
      {note && <Text style={styles.note}>{note}</Text>}

      <View style={{ marginTop: 'auto' as any }}>
        <Text style={styles.fieldLabel}>Calibrate with a lamp of known output</Text>
        <View style={styles.row}>
          <TextInput
            style={styles.input}
            value={lampDraft}
            onChangeText={setLampDraft}
            placeholder="Lamp lumens, e.g. 2150"
            placeholderTextColor={colors.muted}
            keyboardType="decimal-pad"
            returnKeyType="done"
            accessibilityLabel="Known lumens of the calibration lamp"
          />
          <PrimaryButton title="Set scale" onPress={calibrate} variant="muted" style={{ marginTop: 0, marginLeft: 8, paddingHorizontal: 14 }} disabled={lm == null || stale} />
        </View>
        <Text style={styles.small}>Scale: {rawPerLm} counts per lumen (also in Settings).</Text>
      </View>
    </View>
  );
}
