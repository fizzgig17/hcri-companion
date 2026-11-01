// src/components/LiveStationView.tsx
//
// The live station on this phone: what is running now (or the last run), updated every few seconds. Same data as the
// hCRI.io ?live= page. Opened from Settings > Live station.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, View, Text, TouchableOpacity, ScrollView, StyleSheet, SafeAreaView } from 'react-native';
import { useTheme } from '../contexts/ThemeContext';
import RuntimeChart from './RuntimeChart';
import { fetchLiveShared, type LiveRunSummary } from '../hcri/liveStation';

interface Props {
  visible: boolean;
  token: string | null;
  onClose: () => void;
}

const POLL_MS = 5000;

function fmtDur(s: number): string {
  s = Math.max(0, Math.round(s));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const x = s % 60;
  return h > 0 ? `${h} h ${String(m).padStart(2, '0')} min` : m > 0 ? `${m} min ${String(x).padStart(2, '0')} s` : `${x} s`;
}
function fmtAgo(s: number | null): string {
  if (s == null) return '';
  if (s < 10) return 'just now';
  if (s < 90) return `${Math.round(s)} s ago`;
  if (s < 5400) return `${Math.round(s / 60)} min ago`;
  return `${(s / 3600).toFixed(1)} h ago`;
}
const fmtNum = (v: number | null) => (v == null ? '–' : Math.abs(v) >= 100 ? String(Math.round(v)) : v.toFixed(1));

export default function LiveStationView({ visible, token, onClose }: Props) {
  const { colors } = useTheme();
  const [run, setRun] = useState<LiveRunSummary | null>(null);
  const [values, setValues] = useState<number[]>([]);
  const [off, setOff] = useState(false);
  const [info, setInfo] = useState<{ title: string; details: string } | null>(null);
  const [err, setErr] = useState('');
  const [got, setGot] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const held = useRef<number[]>([]);
  const whole = useRef(false);

  useEffect(() => {
    if (!visible || !token) return;
    let alive = true;
    held.current = [];
    whole.current = false;
    const load = async () => {
      try {
        const d = await fetchLiveShared(token, whole.current ? held.current.length : -1);
        if (!alive) return;
        if (d.run) {
          held.current = d.from === 0 || d.from !== held.current.length ? d.values : held.current.concat(d.values);
          whole.current = d.run.points === held.current.length;
        } else held.current = [];
        setValues(held.current);
        setRun(d.run);
        setOff(!d.live);
        setInfo(d.info ?? null);
        setErr('');
        setGot(Date.now());
      } catch (e: any) {
        if (alive) setErr(e?.message ?? 'Could not reach hCRI.io.');
      }
    };
    load();
    const id = setInterval(load, POLL_MS);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => { alive = false; clearInterval(id); clearInterval(tick); };
  }, [visible, token]);

  const points = useMemo(() => {
    const dt = run?.intervalSeconds || 1;
    return values.map((lm, i) => ({ t: i * dt, lm }));
  }, [values, run?.intervalSeconds]);

  const styles = StyleSheet.create({
    wrap: { flex: 1, backgroundColor: colors.background },
    bar: { flexDirection: 'row', alignItems: 'center', padding: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.cardBorder },
    title: { flex: 1, color: colors.text, fontSize: 18, fontWeight: '700' },
    close: { paddingVertical: 6, paddingHorizontal: 12 },
    closeText: { color: colors.accent, fontSize: 16, fontWeight: '600' },
    body: { padding: 16 },
    big: { color: colors.text, fontSize: 44, fontWeight: '800' },
    unit: { color: colors.muted, fontSize: 16 },
    small: { color: colors.muted, fontSize: 13, marginTop: 4 },
    chip: { alignSelf: 'flex-start', borderWidth: 1.5, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 3, marginTop: 8 },
    chipText: { fontSize: 13, fontWeight: '700' },
    err: { color: colors.danger, marginTop: 10 },
  });

  const age = run?.ageSeconds == null ? null : run.ageSeconds + Math.max(0, (now - got) / 1000);
  const isRun = run?.kind !== 'monitor';
  let chip = isRun ? 'Live run' : 'Live';
  let chipColor = colors.accent;
  if (run?.status === 'finished') { chip = isRun ? 'Finished' : 'Stopped'; chipColor = colors.muted; }
  else if (run?.status === 'error') { chip = 'Problem'; chipColor = colors.danger; }
  else if (run?.stale) { chip = `No data for ${fmtDur(age ?? 0)}`; chipColor = colors.warning; }
  const last = values.length ? values[values.length - 1] : run?.last ?? null;
  const elapsed = run?.status === 'running' && !run.stale && run.startedAt ? (now - new Date(run.startedAt).getTime()) / 1000 : points.length ? points[points.length - 1].t : 0;
  const idle = !run || run.status === 'idle' || !run.runId;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.wrap}>
        <View style={styles.bar}>
          <Text style={styles.title}>Live station</Text>
          <TouchableOpacity style={styles.close} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close">
            <Text style={styles.closeText}>Close</Text>
          </TouchableOpacity>
        </View>
        <ScrollView contentContainerStyle={styles.body}>
          {!token && <Text style={styles.small}>Turn on Live station in Settings first.</Text>}
          {token && off && <Text style={styles.small}>The live station is switched off.</Text>}
          {token && !off && idle && <Text style={styles.small}>Nothing is live right now. This screen updates by itself when a tester starts sending.</Text>}
          {token && !off && !idle && run && (
            <>
              <Text style={[styles.title, { flex: 0 }]}>{info?.title || (isRun ? (run.label || 'TKLamp run') : 'Live reading')}</Text>
              <View style={[styles.chip, { borderColor: chipColor }]}><Text style={[styles.chipText, { color: chipColor }]}>{chip}</Text></View>
              {!!info?.details && <Text style={[styles.small, { color: colors.text, marginTop: 8, lineHeight: 19 }]}>{info.details}</Text>}
              {run.status === 'error' && !!run.message && <Text style={styles.err}>{run.message}</Text>}
              <Text style={{ marginTop: 10 }}><Text style={styles.big}>{fmtNum(last)}</Text><Text style={styles.unit}> {run.unit || 'lm'}</Text></Text>
              <Text style={styles.small}>{isRun ? `Running for ${fmtDur(elapsed)} · ` : ''}last reading {fmtAgo(age)}</Text>
              <View style={{ marginTop: 14 }}>
                <RuntimeChart points={points} windowS={0} height={220} />
              </View>
            </>
          )}
          {!!err && <Text style={styles.err}>{err}</Text>}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}
