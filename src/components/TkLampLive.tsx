// src/components/TkLampLive.tsx
//
// The Main tab's content while a TKLamp tester is behind the bridge: a big live lumen number, a rolling chart of the last
// couple of minutes, and Record / Stop. A finished recording uploads to the signed-in user's private Runtime list on
// hCRI.io (label, 1 s curve in lumens). Lumens = the tester's raw count / "counts per lumen" (editable, saved on the
// phone); see ble/tklamp.ts for where 313.2 comes from.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, Alert, Modal, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import RuntimeChart from './RuntimeChart';
import { useTheme } from '../contexts/ThemeContext';
import type { MeterConnection } from '../ble/MeterConnection';
import { TK_LIMITS_DEFAULT, TK_RAW_PER_LM_DEFAULT, TK_STOP_BELOW_HOLD_S, TkRecorder, TkRunGuard, TkSmoother, defaultRunLabel, getTkLimits, getTkRawPerLm, getTkTrim, getTkWindowS, onTkRawPerLm, onTkRunToggle, onTkUploadRequest, onTkWindowS, parseTkLimit, setTkLimits, setTkRunState, setTkTrim, setTkWindowS, trimLeading, resampleRun, scaleFromLamp, setTkRawPerLm, tkLumens, type TkLimits, type TkSample } from '../ble/tklamp';
import { addRuntime, updateRuntime } from '../storage/runtimeHistory';
import { loadHcriCredentials } from '../storage/secureStorage';
import { loadTkLimitsPreference, loadTkScalePreference, loadTkTrimPreference, loadTkWindowPreference, saveTkLimitsPreference, saveTkScalePreference } from '../storage/preferences';
import { uploadRuntimeToHcri } from '../hcri/uploadRuntimeToHcri';

const LIMIT_FIELDS: { key: keyof TkLimits; label: string }[] = [
  { key: 'startAtLm', label: 'Start at (lumens)' },
  { key: 'stopBelowLm', label: 'Stop below (lumens)' },
  { key: 'durationMin', label: 'Stop after (minutes)' },
  { key: 'idleMin', label: 'Stop if no readings (min)' },
];
function limitDrafts(l: TkLimits): Record<keyof TkLimits, string> {
  const t = (v: number | null) => (v == null || v === 0 ? '' : String(v));
  return { startAtLm: t(l.startAtLm), stopBelowLm: t(l.stopBelowLm), durationMin: t(l.durationMin), idleMin: t(l.idleMin) };
}

const TRACE_GAP_S = 0.5;     // the on-screen trace keeps one point per half second
const TRACE_MAX = 20000;     // about 2.7 hours; beyond that every other point is dropped

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
  const [uploadedNow, setUploadedNow] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [windowS, setWindowS] = useState(getTkWindowS());
  const [calOpen, setCalOpen] = useState(false);
  const [armed, setArmed] = useState(false);              // waiting for the light to reach the start level
  const [limits, setLimitsState] = useState<TkLimits>(getTkLimits());
  const [drafts, setDrafts] = useState(() => limitDrafts(getTkLimits()));

  const smoother = useRef(new TkSmoother(5));
  const recorder = useRef(new TkRecorder());
  const recordingRef = useRef(false);
  const scaleRef = useRef(rawPerLm);
  const lastRx = useRef(0);
  const lastDraw = useRef(0);
  const traceRef = useRef<{ t: number; lm: number }[]>([]);
  const t0 = useRef<number | null>(null);
  const armedRef = useRef(false);
  const guard = useRef(new TkRunGuard(getTkLimits()));
  const startRef = useRef<() => void>(() => {});
  const stopRef = useRef<(why?: string) => void>(() => {});

  useEffect(() => {
    loadTkScalePreference(TK_RAW_PER_LM_DEFAULT).then(setTkRawPerLm);
    loadTkWindowPreference(getTkWindowS()).then(setTkWindowS);
    loadTkTrimPreference().then(setTkTrim);
    loadTkLimitsPreference(TK_LIMITS_DEFAULT).then((v) => { setTkLimits(v); setLimitsState(v); setDrafts(limitDrafts(v)); guard.current.setLimits(v); });
    const offW = onTkWindowS(setWindowS);
    const offS = onTkRawPerLm((v) => {
      scaleRef.current = v;
      setRawPerLm(v);
      smoother.current.reset();
    });
    return () => { offW(); offS(); };
  }, []);

  useEffect(() => {
    if (!conn) return;
    const off = conn.onTkSample((s: TkSample) => {
      lastRx.current = Date.now();
      if (t0.current == null) t0.current = s.ms;
      const t = (s.ms - t0.current) / 1000;
      const v = tkLumens(s.raw, scaleRef.current);
      const avg = smoother.current.push(v);
      const tr = traceRef.current;
      if (!tr.length || t - tr[tr.length - 1].t >= TRACE_GAP_S) {
        tr.push({ t, lm: avg });
        if (tr.length > TRACE_MAX) traceRef.current = tr.filter((_, i) => i % 2 === 0);
      }
      if (armedRef.current && !recordingRef.current && guard.current.shouldStart(avg)) {
        armedRef.current = false;
        setArmed(false);
        startRef.current();
      }
      if (recordingRef.current) {
        recorder.current.add(s, scaleRef.current);
        const why = guard.current.onReading(avg, s.ms);
        if (why) stopRef.current(why);
      }
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

  // Time limit and the no-readings timeout are checked once a second, even when no readings arrive.
  useEffect(() => {
    const id = setInterval(() => {
      if (!recordingRef.current) return;
      const why = guard.current.onTimer(recorder.current.seconds, lastRx.current ? Date.now() - lastRx.current : 0);
      if (why) stopRef.current(why);
    }, 1000);
    return () => clearInterval(id);
  }, []);

  // The main button in the bottom bar starts and stops a run.
  const lmRef = useRef<number | null>(null);
  lmRef.current = lm;
  const staleRef = useRef(false);
  staleRef.current = stale;
  useEffect(() => onTkRunToggle(() => {
    if (recordingRef.current) stop();
    else if (armedRef.current) { armedRef.current = false; setArmed(false); setNote('Stopped waiting for the start level.'); }
    else if (lmRef.current != null && !staleRef.current) {
      const a = getTkLimits().startAtLm;
      if (a != null && !(lmRef.current >= a)) {
        armedRef.current = true;
        setArmed(true);
        setNote(null);
        setFinished(false);
      } else start();
    }
  }));   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    setTkRunState({ recording, armed, canRecord: lm != null && !stale, canUpload: finished && !recording, uploading: busy, uploaded: uploadedNow });
  }, [recording, armed, lm, stale, finished, busy, uploadedNow]);
  useEffect(() => () => setTkRunState({ recording: false, armed: false, canRecord: false, canUpload: false, uploading: false, uploaded: false }), []);
  // The bottom bar's Upload button.
  const uploadRef = useRef<() => void>(() => {});
  useEffect(() => onTkUploadRequest(() => uploadRef.current()), []);

  // Wipe the chart and the number (not allowed mid-recording, which keeps its own copy).
  const clearScreen = () => {
    traceRef.current = [];
    t0.current = null;
    smoother.current.reset();
    setTrace([]);
    setLm(null);
    setStale(false);
    lastRx.current = 0;
  };

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
      { text: 'Use it', onPress: () => { setTkRawPerLm(v); saveTkScalePreference(v).catch(() => {}); setLampDraft(''); setCalOpen(false); } },
    ]);
  }, [lampDraft]);

  const start = () => {
    recorder.current.reset();
    guard.current.reset();
    armedRef.current = false;
    setArmed(false);
    recordingRef.current = true;
    setRecording(true);
    setFinished(false);
    setUploadedNow(false);
    setRecSeconds(0);
    setRecCount(0);
    setNote(null);
    setLabel(defaultRunLabel());
  };
  const stop = (why?: string) => {
    recordingRef.current = false;
    armedRef.current = false;
    setArmed(false);
    setRecording(false);
    setRecSeconds(recorder.current.seconds);
    setRecCount(recorder.current.count);
    setFinished(recorder.current.count > 1);
    if (recorder.current.count <= 1) setNote('Nothing recorded. Make sure readings are coming in, then try again.');
    else if (why) setNote(`Run stopped automatically: ${why}`);
    // Keep every finished run on the phone (History > Runtime), whether or not it is uploaded.
    const r = resampleRun(getTkTrim() ? trimLeading(recorder.current.points()) : recorder.current.points());
    savedId.current = null;
    if (r) {
      const l = label.trim() || defaultRunLabel();
      addRuntime({ label: l, intervalSeconds: r.intervalSeconds, values: r.values, rawPerLm: scaleRef.current })
        .then((e) => { savedId.current = e.id; })
        .catch(() => setNote('The run could not be saved on this phone.'));
    }
  };
  const upload = async () => {
    const r = resampleRun(getTkTrim() ? trimLeading(recorder.current.points()) : recorder.current.points());
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
        setUploadedNow(true);
        recorder.current.reset();
        Alert.alert('Uploaded', `${label.trim() || 'Run'} is in your Runtime list on hCRI.io (Explore > Runtime).`);
      }
    } finally {
      setBusy(false);
    }
  };

  uploadRef.current = upload;
  startRef.current = start;
  stopRef.current = stop;

  // Commits one limit box (on leaving it): blank turns that limit off; a bad entry goes back to the saved value.
  const commitLimit = (key: keyof TkLimits) => {
    const parsed = parseTkLimit(drafts[key]);
    const next: TkLimits = { ...limits };
    if (parsed === undefined) {
      setDrafts(limitDrafts(limits));
      return;
    }
    if (key === 'idleMin') next.idleMin = parsed ?? 0;
    else next[key] = parsed;
    setLimitsState(next);
    setDrafts(limitDrafts(next));
    setTkLimits(next);
    guard.current.setLimits(next);
    saveTkLimitsPreference(next).catch(() => {});
  };

  const styles = StyleSheet.create({
    wrap: { flex: 1 },
    big: { color: colors.text, fontSize: 64, fontWeight: '700', textAlign: 'center', marginTop: 4 },
    unit: { color: colors.muted, fontSize: 16, textAlign: 'center', marginTop: -6 },
    stale: { color: colors.danger, fontSize: 13, textAlign: 'center', marginTop: 4 },
    chartBox: { marginTop: 10 },
    row: { flexDirection: 'row', alignItems: 'center', marginTop: 10 },
    fieldLabel: { color: colors.muted, fontSize: 11, marginBottom: 4 },
    input: { flex: 1, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.cardBorder, borderRadius: 8, color: colors.text, paddingHorizontal: 10, paddingVertical: 8, fontSize: 14 },
    rec: { color: colors.danger, fontSize: 14, fontWeight: '600', textAlign: 'center', marginTop: 10 },
    note: { color: colors.warning, fontSize: 13, marginTop: 8, textAlign: 'center' },
    clear: { position: 'absolute', top: 2, right: 2, zIndex: 2, borderWidth: 1, borderColor: colors.cardBorder, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 4 },
    clearText: { color: colors.muted, fontSize: 12, fontWeight: '600' },
    link: { color: colors.accent, fontSize: 12, textAlign: 'center', marginTop: 14, paddingVertical: 6 },
    backdrop: { flex: 1, backgroundColor: '#000a', justifyContent: 'flex-start', paddingTop: 90, paddingHorizontal: 20 },
    card: { backgroundColor: colors.card, borderRadius: 14, padding: 16 },
    cardTitle: { color: colors.text, fontSize: 16, fontWeight: '700', marginBottom: 8 },
    modalRow: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 14 },
    modalBtn: { paddingVertical: 8, paddingHorizontal: 14 },
    modalBtnText: { color: colors.accent, fontWeight: '700', fontSize: 15 },
    small: { color: colors.muted, fontSize: 11, marginTop: 8, textAlign: 'center' },
    limits: { backgroundColor: colors.card, borderColor: colors.cardBorder, borderWidth: 1, borderRadius: 12, padding: 10, marginTop: 12 },
    limitsTitle: { color: colors.text, fontSize: 13, fontWeight: '700', marginBottom: 2 },
    limitRow: { flexDirection: 'row', marginTop: 8 },
    limitCell: { flex: 1, marginRight: 8 },
    wait: { color: colors.accent, fontSize: 14, fontWeight: '600', textAlign: 'center', marginTop: 10 },
  });

  return (
    <ScrollView style={styles.wrap} contentContainerStyle={{ paddingBottom: 8 }} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
      {!recording && trace.length > 0 && (
        <TouchableOpacity style={styles.clear} onPress={clearScreen} accessibilityRole="button" accessibilityLabel="Clear the reading and chart" hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={styles.clearText}>✕ Clear</Text>
        </TouchableOpacity>
      )}
      <Text style={styles.big}>{lm == null ? '—' : lm >= 100 ? lm.toFixed(0) : lm.toFixed(1)}</Text>
      <Text style={styles.unit}>lumens (1 s average)</Text>
      {stale && <Text style={styles.stale}>No readings for 5 s. Is the tester still on and connected?</Text>}

      <View style={styles.chartBox}>
        <RuntimeChart points={trace} windowS={windowS} follow />
      </View>
      <Text style={styles.small}>Scale 0–top in lumens, {windowS >= 60 ? `${Math.round(windowS / 60 * 10) / 10} min` : `${windowS} s`} across the screen. Swipe the chart to look back.</Text>

      {!recording && !finished && lm != null && <Text style={styles.small}>Press Start run below to record.</Text>}
      {recording && <Text style={styles.rec}>● Recording {fmtDur(recSeconds)} ({recCount} readings)</Text>}
      {armed && <Text style={styles.wait}>Waiting for the light to reach {limits.startAtLm} lm to start recording. Tap Cancel below to stop waiting.</Text>}

      {finished && !recording && (
        <View>
          <Text style={styles.fieldLabel}>Name on hCRI.io (same name replaces an earlier run)</Text>
          <TextInput style={styles.input} value={label} onChangeText={setLabel} autoCapitalize="none" autoCorrect={false} maxLength={160} />
          <Text style={styles.small}>{fmtDur(recSeconds)} recorded, {recCount} readings. Tap Upload run below to send it to hCRI.io.</Text>
        </View>
      )}
      {note && <Text style={styles.note}>{note}</Text>}

      <View style={styles.limits}>
        <Text style={styles.limitsTitle}>Run limits</Text>
        <Text style={styles.fieldLabel}>Blank means off. They are kept between runs and when the app restarts.</Text>
        <View style={styles.limitRow}>
          {LIMIT_FIELDS.slice(0, 2).map((f) => (
            <View key={f.key} style={styles.limitCell}>
              <Text style={styles.fieldLabel}>{f.label}</Text>
              <TextInput style={styles.input} value={drafts[f.key]} onChangeText={(t) => setDrafts({ ...drafts, [f.key]: t })} onBlur={() => commitLimit(f.key)} onSubmitEditing={() => commitLimit(f.key)} keyboardType="decimal-pad" returnKeyType="done" placeholder="off" placeholderTextColor={colors.muted} accessibilityLabel={f.label} />
            </View>
          ))}
        </View>
        <View style={styles.limitRow}>
          {LIMIT_FIELDS.slice(2).map((f) => (
            <View key={f.key} style={styles.limitCell}>
              <Text style={styles.fieldLabel}>{f.label}</Text>
              <TextInput style={styles.input} value={drafts[f.key]} onChangeText={(t) => setDrafts({ ...drafts, [f.key]: t })} onBlur={() => commitLimit(f.key)} onSubmitEditing={() => commitLimit(f.key)} keyboardType="decimal-pad" returnKeyType="done" placeholder="off" placeholderTextColor={colors.muted} accessibilityLabel={f.label} />
            </View>
          ))}
        </View>
        <Text style={styles.small}>Start level: Start run waits until the light reaches it. Stop level: ends the run when the output stays below it for {TK_STOP_BELOW_HOLD_S} s (only after it has been above it). No readings: ends the run when the tester has been silent that long (default 5 minutes).</Text>
      </View>

      <TouchableOpacity onPress={() => setCalOpen(true)} accessibilityRole="button" accessibilityLabel="Set the scale from a lamp of known output">
        <Text style={styles.link}>Scale: {rawPerLm} counts per lumen. Tap to set it from a lamp</Text>
      </TouchableOpacity>

      <Modal visible={calOpen} transparent animationType="fade" onRequestClose={() => setCalOpen(false)}>
        <View style={styles.backdrop}>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Set scale from a lamp</Text>
            <Text style={styles.fieldLabel}>Put the lamp in the sphere, wait for a steady number ({lm == null ? '—' : lm.toFixed(0)} lm now), then enter its rated lumens.</Text>
            <TextInput
              style={styles.input}
              value={lampDraft}
              onChangeText={setLampDraft}
              placeholder="Lamp lumens, e.g. 2150"
              placeholderTextColor={colors.muted}
              keyboardType="decimal-pad"
              returnKeyType="done"
              autoFocus
              accessibilityLabel="Known lumens of the calibration lamp"
            />
            <View style={styles.modalRow}>
              <TouchableOpacity style={styles.modalBtn} onPress={() => setCalOpen(false)}><Text style={styles.modalBtnText}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity style={styles.modalBtn} onPress={calibrate} disabled={lm == null || stale}><Text style={styles.modalBtnText}>Set scale</Text></TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}
