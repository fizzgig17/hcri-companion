// src/components/FlickerSettingsModal.tsx
//
// The meter's flicker range ("gear") and sample-rate settings, as in the stock
// app's settings sheet. Values are read from the meter when opened and written
// back one at a time. These settings live on the meter itself.
//
// What the meter actually does (seen in debug logs): the range and sample RATE you pick stay put across
// reconnects, but its "auto sample rate" flag turns itself back on. So the chips are always shown (the current
// value highlighted), picking one turns Auto off and sets it in one step, and after every write the values are
// read back from the meter so the popup shows what the meter really has, not what we hoped we set.

import React, { useEffect, useState } from 'react';
import { Modal, View, Text, TouchableOpacity, Switch, ActivityIndicator, StyleSheet } from 'react-native';
import { useTheme } from '../contexts/ThemeContext';
import type { FlickerSettings, FlickerSettingKey } from '../ble/liveSessions';

export interface FlickerSettingsApi {
  load: () => Promise<FlickerSettings>;
  apply: (key: FlickerSettingKey, value: number | boolean) => Promise<boolean>;
  /** False while a Live/Flicker run is active -- settings can't be changed mid-run. */
  canEdit: boolean;
}

const GEARS = ['x1', 'x10', 'x100', 'x1k'];
const RATES = ['100 Hz', '200 Hz', '500 Hz', '1 kHz', '2 kHz', '5 kHz', '10 kHz', '20 kHz', '50 kHz', '100 kHz', '200 kHz'];
const SPANS = ['100 s', '50 s', '20 s', '10 s', '5 s', '2 s', '1 s', '500 ms', '200 ms', '100 ms', '50 ms'];

export default function FlickerSettingsModal({ visible, onClose, api }: { visible: boolean; onClose: () => void; api: FlickerSettingsApi }) {
  const { colors } = useTheme();
  const [s, setS] = useState<FlickerSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setS(null);
    setNote('');
    api.load().then((v) => !cancelled && setS(v)).catch(() => !cancelled && setS({}));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const change = async (key: FlickerSettingKey, value: number | boolean) => {
    if (!api.canEdit || busy) return;
    setBusy(true);
    setNote('');
    const ok = await api.apply(key, value);
    if (!ok) {
      setNote('The meter did not confirm that change.');
    } else {
      const fresh = await refresh();
      if (fresh && fresh[key] !== undefined && fresh[key] !== value) {
        setNote('The meter did not keep that change, so it is showing what the meter reports.');
      }
    }
    setBusy(false);
  };

  /** Reads the settings back from the meter and shows them (only values the meter actually answered). */
  const refresh = async (): Promise<FlickerSettings | null> => {
    try {
      const fresh = await api.load();
      setS((prev) => {
        const next: FlickerSettings = { ...(prev ?? {}) };
        (Object.keys(fresh) as (keyof FlickerSettings)[]).forEach((k) => {
          if (fresh[k] !== undefined) (next as any)[k] = fresh[k];
        });
        return next;
      });
      return fresh;
    } catch {
      return null;
    }
  };

  /** Tapping a range / rate chip: turns Auto off if needed, sets the value, then reads it back. */
  const pick = async (key: 'gear' | 'sampleIdx', idx: number) => {
    if (!api.canEdit || busy) return;
    setBusy(true);
    setNote('');
    const autoKey: FlickerSettingKey = key === 'gear' ? 'autoGear' : 'autoRate';
    let ok = true;
    if (s?.[autoKey]) ok = await api.apply(autoKey, false);
    if (ok) ok = await api.apply(key, idx);
    if (!ok) {
      setNote('The meter did not confirm that change.');
    } else {
      const fresh = await refresh();
      if (fresh && fresh[key] !== undefined && fresh[key] !== idx) {
        setNote('The meter did not keep that change, so it is showing what the meter reports.');
      } else if (key === 'sampleIdx' && fresh?.autoRate) {
        setNote('The meter shows Auto again by itself, but it keeps the rate you picked.');
      }
    }
    setBusy(false);
  };

  const styles = StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: 20 },
    sheet: { width: '100%', maxWidth: 420, backgroundColor: colors.card, borderRadius: 14, borderWidth: 1, borderColor: colors.cardBorder, padding: 16 },
    title: { color: colors.text, fontSize: 16, fontWeight: '700', marginBottom: 2 },
    sub: { color: colors.muted, fontSize: 12, marginBottom: 12 },
    row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 },
    label: { color: colors.text, fontSize: 14, fontWeight: '600', flexShrink: 1 },
    autoWrap: { flexDirection: 'row', alignItems: 'center' },
    autoTxt: { color: colors.muted, fontSize: 12, marginRight: 4 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 8 },
    chip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: colors.cardBorder, marginRight: 6, marginBottom: 6 },
    chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
    chipTxt: { color: colors.text, fontSize: 12.5 },
    chipTxtOn: { color: '#fff', fontWeight: '700' },
    note: { color: colors.muted, fontSize: 12, marginTop: 8 },
    close: { alignItems: 'center', paddingVertical: 12, marginTop: 8 },
    closeTxt: { color: colors.accent, fontSize: 14, fontWeight: '700' },
  });

  const chip = (label: string, on: boolean, onPress: () => void, key: string, sub?: string) => (
    <TouchableOpacity key={key} style={[styles.chip, on && styles.chipOn]} onPress={onPress} disabled={!api.canEdit || busy}>
      <Text style={[styles.chipTxt, on && styles.chipTxtOn]}>{label}{sub ? `  · ${sub}` : ''}</Text>
    </TouchableOpacity>
  );

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.title}>Flicker settings</Text>
          <Text style={styles.sub}>Stored on the meter itself. Tap a value to fix it, or turn Auto on to let the meter choose.</Text>
          {!s ? (
            <ActivityIndicator color={colors.accent} style={{ marginVertical: 24 }} />
          ) : (
            <>
              <View style={styles.row}>
                <Text style={styles.label}>Gear (range){s.gear !== undefined && GEARS[s.gear] ? `: ${GEARS[s.gear]}` : ''}</Text>
                <View style={styles.autoWrap}>
                  <Text style={styles.autoTxt}>Auto</Text>
                  <Switch value={!!s.autoGear} onValueChange={(v) => change('autoGear', v)} disabled={!api.canEdit || busy} />
                </View>
              </View>
              <View style={styles.chips}>
                {GEARS.map((g, i) => chip(g, s.gear === i, () => pick('gear', i), g))}
              </View>
              <View style={styles.row}>
                <Text style={styles.label}>
                  Sample rate{s.sampleIdx !== undefined && RATES[s.sampleIdx] ? `: ${RATES[s.sampleIdx]} · ${SPANS[s.sampleIdx]}` : ''}
                </Text>
                <View style={styles.autoWrap}>
                  <Text style={styles.autoTxt}>Auto</Text>
                  <Switch value={!!s.autoRate} onValueChange={(v) => change('autoRate', v)} disabled={!api.canEdit || busy} />
                </View>
              </View>
              <View style={styles.chips}>
                {RATES.map((r, i) => chip(r, s.sampleIdx === i, () => pick('sampleIdx', i), r, SPANS[i]))}
              </View>
              {s.autoGear === undefined && s.autoRate === undefined && <Text style={styles.note}>The meter did not answer the settings request.</Text>}
              {!api.canEdit && <Text style={styles.note}>Stop the current run to change settings.</Text>}
              {!!note && <Text style={styles.note}>{note}</Text>}
            </>
          )}
          <TouchableOpacity style={styles.close} onPress={onClose}>
            <Text style={styles.closeTxt}>Done</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}
