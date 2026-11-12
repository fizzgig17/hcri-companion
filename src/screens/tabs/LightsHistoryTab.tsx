// src/screens/tabs/LightsHistoryTab.tsx
//
// History > Lights. A light groups several readings of the same flashlight and is kept in step with hCRI.io:
// create it here (offline is fine), add readings from History, categorize it like a reading, then Sync: the light is created
// on hCRI.io, every reading that was never uploaded is uploaded, all of them are linked in this order, and the trend numbers
// come back. Lights already on hCRI.io (made on the website) show up here too. Needs an API token; without a valid one
// the tab asks for it first (see LightsGate).

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Modal, ScrollView, ActivityIndicator, Alert, StyleSheet, Keyboard } from 'react-native';
import Svg, { Polyline, Circle } from 'react-native-svg';
import { useTheme } from '../../contexts/ThemeContext';
import { useLog } from '../../contexts/LogContext';
import CategorizeModal from '../../components/CategorizeModal';
import { CategoryValues } from '../../hcri/categorize';
import { LedDetails } from '../../hcri/ledApi';
import { hasLed } from '../../hcri/leds';
import { LedLists } from '../../hcri/ledLists';
import { checkLightsToken, deleteServerLight, LightKind } from '../../hcri/lightsApi';
import { pullLights, syncLight } from '../../hcri/lightsSync';
import { generateApiToken } from '../../hcri/generateApiToken';
import { loadHcriCredentials, saveHcriCredentials } from '../../storage/secureStorage';
import { createLocalLight, deleteLocalLight, loadLights, LocalLight, patchLight, setLightsChangeListener } from '../../storage/lightsStore';
import type { SavedReading } from '../../storage/readingHistory';

const SEP = ' / ';
const splitVals = (s?: string) => (s ?? '').split(SEP).map((x) => x.trim()).filter(Boolean);
const uniq = (a: string[]) => Array.from(new Set(a.filter(Boolean)));

/** A light's categories in the Categorize dialog's shape (LEDs paired by position). */
function toValues(l: LocalLight): CategoryValues {
  const b = l.cats.led_brand ?? [], m = l.cats.led_model ?? [], c = l.cats.led_cct ?? [];
  const leds: LedDetails[] = [];
  for (let i = 0; i < Math.max(b.length, m.length, c.length); i++) leds.push({ brand: b[i] ?? '', model: m[i] ?? '', cct: c[i] ?? '' });
  return { leds, other: { light_brand: (l.cats.light_brand ?? []).join(SEP), light_model: (l.cats.light_model ?? []).join(SEP), optic: (l.cats.optic ?? []).join(SEP) } };
}
function fromValues(v: CategoryValues): LocalLight['cats'] {
  const leds = v.leds.filter(hasLed);
  return {
    led_brand: uniq(leds.map((x) => x.brand ?? '')), led_model: uniq(leds.map((x) => x.model ?? '')), led_cct: uniq(leds.map((x) => x.cct ?? '')),
    light_brand: splitVals(v.other.light_brand), light_model: splitVals(v.other.light_model), optic: splitVals(v.other.optic),
  };
}
const catLine = (l: LocalLight) => {
  const c = l.cats; const j = (k: LightKind) => (c[k] ?? []).join(SEP);
  const led = [j('led_brand'), j('led_model'), j('led_cct')].filter(Boolean).join(' ');
  return [[j('light_brand'), j('light_model')].filter(Boolean).join(' '), led && `LED ${led}`, j('optic')].filter(Boolean).join(' · ');
};

const TREND: [string, string, number, string][] = [['cct', 'CCT', 0, 'K'], ['duv', 'Duv', 4, ''], ['ra', 'Ra', 1, ''], ['r9', 'R9', 1, '']];
function Spark({ values, color, w = 96, h = 22 }: { values: (number | null)[]; color: string; w?: number; h?: number }) {
  const v = values.map((x, i) => [i, x] as const).filter((p): p is readonly [number, number] => p[1] != null);
  if (!v.length) return <View style={{ width: w, height: h }} />;
  const lo = Math.min(...v.map((p) => p[1])), hi = Math.max(...v.map((p) => p[1])), span = hi - lo || 1;
  const x = (i: number) => 3 + (values.length > 1 ? (i / (values.length - 1)) * (w - 6) : (w - 6) / 2);
  const y = (n: number) => 3 + (1 - (n - lo) / span) * (h - 6);
  const last = v[v.length - 1];
  return (
    <Svg width={w} height={h}>
      {v.length > 1 && <Polyline points={v.map((p) => `${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join(' ')} fill="none" stroke={color} strokeWidth={1.5} />}
      <Circle cx={x(last[0])} cy={y(last[1])} r={2.6} fill={color} />
    </Svg>
  );
}

// ── Token gate ──────────────────────────────────────────────────────────────────────────────────────
type Access = 'checking' | 'need' | 'ok' | 'offline';

function LightsGate({ invalid, onDone }: { invalid: boolean; onDone: () => void }) {
  const { colors } = useTheme();
  const [mode, setMode] = useState<'login' | 'paste'>('login');
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [tok, setTok] = useState('');
  const [busy, setBusy] = useState(false);
  const input = { borderWidth: 1, borderColor: colors.cardBorder, borderRadius: 8, color: colors.text, padding: 10, fontSize: 15, marginBottom: 8 } as const;
  useEffect(() => { loadHcriCredentials().then((c) => c?.username && setUser(c.username)).catch(() => {}); }, []);

  const go = async () => {
    Keyboard.dismiss();
    setBusy(true);
    try {
      let name = user.trim(), token = tok.trim();
      if (mode === 'login') {
        if (!name || !pass) throw new Error('Enter your username or email and your password.');
        const r = await generateApiToken(name, pass, 'hCRI Companion');
        name = r.username; token = r.token; setPass('');
      } else if (!token) throw new Error('Paste your API token.');
      const ok = await checkLightsToken(token);
      if (ok === 'invalid') throw new Error('hCRI.io did not accept that token.');
      if (ok === 'offline') throw new Error('Could not reach hCRI.io. Check your connection and try again.');
      await saveHcriCredentials({ username: name || 'user', token });
      onDone();
    } catch (e: any) {
      Alert.alert('Could not sign in', e?.message || 'Something went wrong.');
    } finally { setBusy(false); }
  };
  return (
    <View style={{ backgroundColor: colors.card, borderColor: colors.cardBorder, borderWidth: 1, borderRadius: 12, padding: 14 }}>
      <Text style={{ color: colors.text, fontSize: 16, fontWeight: '700', marginBottom: 4 }}>{invalid ? 'Your hCRI.io token is not valid' : 'Sign in to use Lights'}</Text>
      <Text style={{ color: colors.muted, fontSize: 13, marginBottom: 12, lineHeight: 18 }}>
        Lights are kept on hCRI.io, so the app needs an API token for your account. {invalid ? 'The saved one was rejected (it may have been deleted on the website). ' : ''}Sign in once to create one, or paste one from Profile → API on the website.
      </Text>
      <View style={{ flexDirection: 'row', marginBottom: 10 }}>
        {(['login', 'paste'] as const).map((m) => (
          <TouchableOpacity key={m} onPress={() => setMode(m)} style={{ borderWidth: 1, borderColor: mode === m ? colors.accent : colors.cardBorder, backgroundColor: mode === m ? colors.accent : 'transparent', borderRadius: 14, paddingHorizontal: 12, paddingVertical: 6, marginRight: 8 }}>
            <Text style={{ color: mode === m ? '#fff' : colors.text, fontSize: 13 }}>{m === 'login' ? 'Sign in' : 'Paste a token'}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <TextInput value={user} onChangeText={setUser} placeholder="Username or email" placeholderTextColor={colors.mutedFaint} autoCapitalize="none" autoCorrect={false} style={input} />
      {mode === 'login'
        ? <TextInput value={pass} onChangeText={setPass} placeholder="Password" placeholderTextColor={colors.mutedFaint} secureTextEntry autoCapitalize="none" style={input} />
        : <TextInput value={tok} onChangeText={setTok} placeholder="hcri_…" placeholderTextColor={colors.mutedFaint} autoCapitalize="none" autoCorrect={false} style={input} />}
      <TouchableOpacity disabled={busy} onPress={go} style={{ backgroundColor: colors.accent, borderRadius: 8, paddingVertical: 11, alignItems: 'center', opacity: busy ? 0.6 : 1 }}>
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>{mode === 'login' ? 'Sign in and continue' : 'Save token and continue'}</Text>}
      </TouchableOpacity>
    </View>
  );
}

// ── The tab ─────────────────────────────────────────────────────────────────────────────────────────
interface Props {
  history: SavedReading[];
  lists: LedLists;
  onOpenReading: (r: SavedReading) => void;
}

export default function LightsHistoryTab({ history, lists, onOpenReading }: Props) {
  const { colors } = useTheme();
  const { appendLog: appendLogLive } = useLog();
  const logRef = useRef(appendLogLive);
  logRef.current = appendLogLive;
  const appendLog = useCallback((m: string) => logRef.current(m), []);   // stable, so the effects below run once
  const [access, setAccess] = useState<Access>('checking');
  const [rejected, setRejected] = useState(false);   // a saved token the server refused
  const [lights, setLights] = useState<LocalLight[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string>('');           // progress text while syncing / refreshing
  const [naming, setNaming] = useState(false);
  const [draft, setDraft] = useState('');
  const [picking, setPicking] = useState(false);
  const [pickSel, setPickSel] = useState<string[]>([]);
  const [pickQ, setPickQ] = useState('');
  const [cat, setCat] = useState(false);
  const [nameEdit, setNameEdit] = useState<string | null>(null);
  const [notesEdit, setNotesEdit] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const reload = useCallback(async () => { const l = await loadLights(); if (alive.current) setLights([...l]); }, []);
  useEffect(() => { setLightsChangeListener(() => { reload(); }); reload(); return () => setLightsChangeListener(null); }, [reload]);

  const check = useCallback(async () => {
    setAccess('checking');
    const c = await loadHcriCredentials().catch(() => null);
    if (!c?.token) { setRejected(false); setAccess('need'); return; }
    const r = await checkLightsToken(c.token);
    if (!alive.current) return;
    setRejected(r === 'invalid');
    setAccess(r === 'ok' ? 'ok' : r === 'invalid' ? 'need' : 'offline');
    if (r === 'ok') { setBusy('Refreshing…'); await pullLights(appendLog); if (alive.current) setBusy(''); }
  }, [appendLog]);
  useEffect(() => { check(); }, [check]);

  const open = lights.find((l) => l.id === openId) || null;
  const byId = useMemo(() => new Map(history.map((h) => [h.id, h])), [history]);
  const sendable = access === 'ok';

  const doSync = async (l: LocalLight, quiet = false) => {
    setBusy(`Syncing “${l.name}”…`);
    const r = await syncLight(l.id, appendLog, (m) => setBusy(m));
    if (alive.current) setBusy('');
    if (!quiet) Alert.alert(r.ok ? 'Synced' : 'Not finished', r.ok ? `“${l.name}” is in sync with hCRI.io${r.uploaded ? ` (${r.uploaded} reading${r.uploaded === 1 ? '' : 's'} uploaded)` : ''}.` : r.message);
    return r;
  };
  const syncAll = async () => {
    for (const l of lights.filter((x) => x.dirty || !x.serverId)) await doSync(l, true);
    setBusy('Refreshing…'); await pullLights(appendLog); if (alive.current) setBusy('');
  };

  const create = async () => {
    const name = draft.trim(); if (!name) return;
    const l = await createLocalLight(name);
    setNaming(false); setDraft(''); setOpenId(l.id);
  };
  const remove = (l: LocalLight) => {
    Alert.alert(`Delete “${l.name}”?`, l.serverId ? 'The light is removed here and on hCRI.io. Its readings are kept (in History and on hCRI.io); only the grouping is deleted.' : 'The light is removed from this phone. Its readings stay in History.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        if (l.serverId) {
          const c = await loadHcriCredentials().catch(() => null);
          const r = c?.token ? await deleteServerLight(c.token, l.serverId) : null;
          if (!r || !r.ok) { Alert.alert('Not deleted', r ? r.error : 'Add your API token first.'); return; }
        }
        await deleteLocalLight(l.id); setOpenId(null);
      } },
    ]);
  };
  const move = (l: LocalLight, i: number, d: number) => {
    const ids = [...l.readingIds]; const j = i + d; if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]]; patchLight(l.id, () => ({ readingIds: ids }));
  };
  const take = (l: LocalLight, i: number) => {
    const rd = byId.get(l.readingIds[i]);
    patchLight(l.id, (x) => ({
      readingIds: x.readingIds.filter((_, k) => k !== i),
      removedReportIds: rd?.reportId != null ? [...x.removedReportIds, String(rd.reportId)] : x.removedReportIds,
    }));
  };
  const addPicked = async () => {
    if (!open) return;
    const ids = pickSel.filter((id) => !open.readingIds.includes(id));
    // A reading put back after being taken off is no longer pending removal.
    const back = new Set(ids.map((id) => byId.get(id)?.reportId).filter((x) => x != null).map(String));
    await patchLight(open.id, (x) => ({ readingIds: [...x.readingIds, ...ids], removedReportIds: x.removedReportIds.filter((r) => !back.has(r)) }));
    setPicking(false); setPickSel([]); setPickQ('');
  };

  const styles = StyleSheet.create({
    card: { backgroundColor: colors.card, borderColor: colors.cardBorder, borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 10 },
    h: { color: colors.text, fontSize: 15, fontWeight: '700' },
    sub: { color: colors.muted, fontSize: 12, marginTop: 2 },
    btn: { borderWidth: 1, borderColor: colors.cardBorder, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, marginRight: 8 },
    btnT: { color: colors.text, fontSize: 13, fontWeight: '600' },
    primary: { backgroundColor: colors.accent, borderColor: colors.accent },
    input: { borderWidth: 1, borderColor: colors.cardBorder, borderRadius: 8, color: colors.text, padding: 10, fontSize: 15 },
    backdrop: { flex: 1, backgroundColor: '#000a', justifyContent: 'center', padding: 20 },
    sheet: { backgroundColor: colors.card, borderRadius: 14, padding: 16, maxHeight: '85%' },
  });
  const badge = (l: LocalLight) => (!l.serverId ? ['Not on hCRI.io yet', colors.muted] : l.dirty ? ['Unsent changes', '#e0a030'] : ['In sync', '#3fb27f']) as [string, string];
  const pending = (l: LocalLight) => l.readingIds.filter((id) => { const r = byId.get(id); return r && r.reportId == null; }).length;

  if (access === 'checking') return <ActivityIndicator color={colors.muted} style={{ marginVertical: 24 }} />;
  if (access === 'need') return <LightsGate invalid={rejected} onDone={check} />;

  const offlineNote = access === 'offline' ? <Text style={{ color: '#e0a030', fontSize: 12, marginBottom: 10 }}>Can’t reach hCRI.io right now: you can still work on lights; Sync is available when you’re back online. <Text style={{ color: colors.accent }} onPress={check}>Retry</Text></Text> : null;
  const progress = busy ? (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}><ActivityIndicator color={colors.muted} /><Text style={{ color: colors.muted, fontSize: 13, marginLeft: 8 }}>{busy}</Text></View>
  ) : null;

  // ── Detail ──
  if (open) {
    const l = open;
    const s = l.server;
    const srvOnly = (s?.readings ?? []).filter((r) => !history.some((h) => h.reportId != null && String(h.reportId) === r.id) || false).filter((r) => !l.removedReportIds.includes(r.id));
    const [bt, bc] = badge(l);
    const pend = pending(l);
    const cands = history.filter((h) => !l.readingIds.includes(h.id) && (!pickQ.trim() || h.label.toLowerCase().includes(pickQ.trim().toLowerCase())));
    return (
      <View>
        <TouchableOpacity onPress={() => { setOpenId(null); setNameEdit(null); setNotesEdit(null); }} style={{ marginBottom: 10 }}><Text style={{ color: colors.accent, fontSize: 15, fontWeight: '600' }}>‹ Lights</Text></TouchableOpacity>
        {offlineNote}{progress}
        <View style={styles.card}>
          <TextInput value={nameEdit ?? l.name} onChangeText={setNameEdit} onBlur={() => { if (nameEdit != null && nameEdit.trim() && nameEdit.trim() !== l.name) patchLight(l.id, () => ({ name: nameEdit.trim() })); setNameEdit(null); }} style={[styles.input, { fontWeight: '700', fontSize: 17 }]} placeholder="Name" placeholderTextColor={colors.mutedFaint} />
          <TextInput value={notesEdit ?? l.notes} onChangeText={setNotesEdit} onBlur={() => { if (notesEdit != null && notesEdit !== l.notes) patchLight(l.id, () => ({ notes: notesEdit })); setNotesEdit(null); }} style={[styles.input, { marginTop: 8, minHeight: 44 }]} placeholder="Notes" placeholderTextColor={colors.mutedFaint} multiline />
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 }}>
            <Text style={{ color: bc, fontSize: 12, fontWeight: '600' }}>● {bt}</Text>
            <TouchableOpacity onPress={() => setCat(true)}><Text style={{ color: colors.accent, fontSize: 13, fontWeight: '600' }}>{catLine(l) ? 'Edit categories' : 'Categorize'}</Text></TouchableOpacity>
          </View>
          {!!catLine(l) && <Text style={[styles.sub, { marginTop: 4 }]}>{catLine(l)}</Text>}
        </View>
        {!!s && s.count > 0 && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 6 }}>
            {TREND.filter(([k]) => s.stats[k]).map(([k, lab, d, u], i) => (
              <View key={k} style={[styles.card, { width: '48.5%', marginRight: i % 2 === 0 ? '3%' : 0, padding: 8 }]}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={styles.sub}>{lab}</Text>
                  <Text style={{ color: colors.text, fontWeight: '700', fontSize: 14 }}>{s.stats[k].latest == null ? '–' : Number(s.stats[k].latest).toFixed(d)}{u}</Text>
                </View>
                <Spark values={s.series[k] ?? []} color={['#4ea1ff', '#f5a623', '#7ed957', '#e66ba8'][i % 4]} w={130} />
              </View>
            ))}
          </View>
        )}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <Text style={styles.h}>Readings ({l.readingIds.length + srvOnly.length})</Text>
          <TouchableOpacity onPress={() => { setPickSel([]); setPicking(true); }} style={[styles.btn, { marginRight: 0 }]}><Text style={styles.btnT}>+ Add readings</Text></TouchableOpacity>
        </View>
        {l.readingIds.length + srvOnly.length === 0 && <Text style={{ color: colors.muted, fontSize: 13, paddingVertical: 12 }}>No readings yet. Add some from History.</Text>}
        {l.readingIds.map((id, i) => {
          const r = byId.get(id);
          return (
            <View key={id} style={[styles.card, { flexDirection: 'row', alignItems: 'center', padding: 10 }]}>
              <TouchableOpacity style={{ flex: 1 }} disabled={!r} onPress={() => r && onOpenReading(r)}>
                <Text style={{ color: colors.text, fontSize: 14, fontWeight: '600' }} numberOfLines={1}>{i + 1}. {r ? r.label : 'Reading deleted from History'}</Text>
                <Text style={{ color: r && r.reportId == null ? '#e0a030' : colors.muted, fontSize: 11 }}>{!r ? 'Will be skipped' : r.reportId == null ? 'Not uploaded yet — Sync uploads it' : 'On hCRI.io'}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => move(l, i, -1)} hitSlop={8} style={{ padding: 8 }}><Text style={{ color: colors.muted, fontSize: 16 }}>↑</Text></TouchableOpacity>
              <TouchableOpacity onPress={() => move(l, i, 1)} hitSlop={8} style={{ padding: 8 }}><Text style={{ color: colors.muted, fontSize: 16 }}>↓</Text></TouchableOpacity>
              <TouchableOpacity onPress={() => take(l, i)} hitSlop={8} style={{ padding: 8 }}><Text style={{ color: colors.muted, fontSize: 16 }}>✕</Text></TouchableOpacity>
            </View>
          );
        })}
        {srvOnly.map((r) => (
          <View key={r.id} style={[styles.card, { padding: 10 }]}>
            <Text style={{ color: colors.text, fontSize: 14, fontWeight: '600' }} numberOfLines={1}>{r.label}</Text>
            <Text style={styles.sub}>On hCRI.io only{r.cct != null ? ` · ${Math.round(r.cct)} K` : ''}{r.ra != null ? ` · Ra ${r.ra.toFixed(1)}` : ''}</Text>
          </View>
        ))}
        <TouchableOpacity disabled={!sendable || !!busy} onPress={() => doSync(l)} style={[styles.btn, styles.primary, { marginRight: 0, marginTop: 4, alignItems: 'center', paddingVertical: 12, opacity: !sendable || busy ? 0.5 : 1 }]}>
          <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>{pend ? `Upload ${pend} reading${pend === 1 ? '' : 's'} and sync` : l.serverId ? 'Sync with hCRI.io' : 'Upload light to hCRI.io'}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => remove(l)} style={{ alignSelf: 'center', marginTop: 16, padding: 8 }}><Text style={{ color: '#d9534f', fontSize: 13 }}>Delete light</Text></TouchableOpacity>

        <Modal visible={picking} transparent animationType="fade" onRequestClose={() => setPicking(false)}>
          <View style={styles.backdrop}><View style={styles.sheet}>
            <Text style={[styles.h, { marginBottom: 8 }]}>Add readings</Text>
            <TextInput value={pickQ} onChangeText={setPickQ} placeholder="Search by name…" placeholderTextColor={colors.mutedFaint} style={[styles.input, { marginBottom: 8 }]} />
            <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 360 }}>
              {cands.length === 0 && <Text style={{ color: colors.muted, fontSize: 13, padding: 12 }}>No readings to add.</Text>}
              {cands.map((h) => {
                const on = pickSel.includes(h.id);
                return (
                  <TouchableOpacity key={h.id} onPress={() => setPickSel((p) => on ? p.filter((x) => x !== h.id) : [...p, h.id])} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 9 }}>
                    <View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: on ? colors.accent : colors.cardBorder, backgroundColor: on ? colors.accent : 'transparent', alignItems: 'center', justifyContent: 'center', marginRight: 10 }}>{on && <Text style={{ color: '#fff', fontSize: 13 }}>✓</Text>}</View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: colors.text, fontSize: 14 }} numberOfLines={1}>{h.label}</Text>
                      <Text style={{ color: colors.muted, fontSize: 11 }}>{new Date(h.savedAt).toLocaleString()}{h.reportId == null ? ' · not uploaded' : ''}</Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 10 }}>
              <TouchableOpacity onPress={() => setPicking(false)} style={styles.btn}><Text style={styles.btnT}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity disabled={!pickSel.length} onPress={addPicked} style={[styles.btn, styles.primary, { marginRight: 0, opacity: pickSel.length ? 1 : 0.4 }]}><Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>Add {pickSel.length || ''}</Text></TouchableOpacity>
            </View>
          </View></View>
        </Modal>
        <CategorizeModal visible={cat} light title={`Categorize “${l.name}”`} lists={lists} initial={toValues(l)} onCancel={() => setCat(false)} onApply={async (v) => { await patchLight(l.id, () => ({ cats: fromValues(v) })); setCat(false); }} />
      </View>
    );
  }

  // ── List ──
  return (
    <View>
      {offlineNote}{progress}
      <View style={{ flexDirection: 'row', marginBottom: 12 }}>
        <TouchableOpacity onPress={() => { setDraft(''); setNaming(true); }} style={[styles.btn, styles.primary]}><Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>+ New light</Text></TouchableOpacity>
        <TouchableOpacity disabled={!sendable || !!busy} onPress={syncAll} style={[styles.btn, { opacity: !sendable || busy ? 0.5 : 1 }]}><Text style={styles.btnT}>Sync all</Text></TouchableOpacity>
        <TouchableOpacity disabled={!sendable || !!busy} onPress={async () => { setBusy('Refreshing…'); const r = await pullLights(appendLog); setBusy(''); if (!r.ok) Alert.alert('Could not refresh', r.message); }} style={[styles.btn, { opacity: !sendable || busy ? 0.5 : 1 }]}><Text style={styles.btnT}>Refresh</Text></TouchableOpacity>
      </View>
      {lights.length === 0 && <Text style={{ color: colors.muted, fontSize: 13, textAlign: 'center', paddingVertical: 28, lineHeight: 19 }}>No lights yet.{'\n'}Create one, add readings from History, then sync it to hCRI.io.</Text>}
      {lights.map((l) => {
        const [bt, bc] = badge(l); const s = l.server; const n = l.readingIds.length || s?.count || 0;
        return (
          <TouchableOpacity key={l.id} style={styles.card} onPress={() => setOpenId(l.id)}>
            <Text style={styles.h} numberOfLines={1}>{l.name}</Text>
            {!!catLine(l) && <Text style={styles.sub} numberOfLines={1}>{catLine(l)}</Text>}
            <Text style={styles.sub}>{n} reading{n === 1 ? '' : 's'} · <Text style={{ color: bc }}>{bt}</Text></Text>
            {!!s && s.count > 0 && (
              <View style={{ flexDirection: 'row', marginTop: 6 }}>
                {TREND.slice(0, 3).filter(([k]) => s.stats[k]).map(([k, lab, d], i) => (
                  <View key={k} style={{ marginRight: 12 }}>
                    <Text style={{ color: colors.muted, fontSize: 10 }}>{lab} <Text style={{ color: colors.text, fontWeight: '700' }}>{s.stats[k].latest == null ? '–' : Number(s.stats[k].latest).toFixed(d)}</Text></Text>
                    <Spark values={s.series[k] ?? []} color={['#4ea1ff', '#f5a623', '#7ed957'][i]} w={84} h={20} />
                  </View>
                ))}
              </View>
            )}
          </TouchableOpacity>
        );
      })}
      <Modal visible={naming} transparent animationType="fade" onRequestClose={() => setNaming(false)}>
        <View style={styles.backdrop}><View style={styles.sheet}>
          <Text style={[styles.h, { marginBottom: 8 }]}>New light</Text>
          <TextInput autoFocus value={draft} onChangeText={setDraft} placeholder="Name, e.g. Zebralight SC64" placeholderTextColor={colors.mutedFaint} style={styles.input} onSubmitEditing={create} returnKeyType="done" />
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 12 }}>
            <TouchableOpacity onPress={() => setNaming(false)} style={styles.btn}><Text style={styles.btnT}>Cancel</Text></TouchableOpacity>
            <TouchableOpacity disabled={!draft.trim()} onPress={create} style={[styles.btn, styles.primary, { marginRight: 0, opacity: draft.trim() ? 1 : 0.4 }]}><Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>Create</Text></TouchableOpacity>
          </View>
        </View></View>
      </Modal>
    </View>
  );
}
