// src/components/LedPickerModal.tsx
//
// Pick (or type) the LEDs in a light: each LED has its own brand, model and CCT, so a light with two different LEDs
// keeps each one's values together. Each field is a text box with tappable matches from the hCRI.io lists underneath
// (a brand's own models are listed first); anything typed that isn't in the lists is sent to hCRI.io for review.

import React, { useEffect, useMemo, useState } from 'react';
import { Modal, View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, KeyboardAvoidingView, Platform, Keyboard, useWindowDimensions } from 'react-native';
import { useTheme } from '../contexts/ThemeContext';
import { LedLists } from '../hcri/ledLists';
import { LedDetails } from '../hcri/ledApi';
import { hasLed, MAX_LEDS } from '../hcri/leds';

interface Props {
  visible: boolean;
  lists: LedLists;
  /** The LEDs to start from (one blank LED if empty). */
  initial?: LedDetails[];
  onSave: (leds: LedDetails[]) => void;
  onCancel: () => void;
}

function Field({ label, value, onChange, options, placeholder, keyboardType }: {
  label: string; value: string; onChange: (v: string) => void; options: string[]; placeholder: string; keyboardType?: 'default' | 'numeric';
}) {
  const { colors } = useTheme();
  const q = value.trim().toLowerCase();
  const shown = useMemo(() => {
    const m = q ? options.filter((o) => o.toLowerCase().includes(q) && o.toLowerCase() !== q) : options;
    return m.slice(0, 14);
  }, [options, q]);
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.mutedFaint}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType={keyboardType}
        style={{ color: colors.text, borderWidth: 1, borderColor: colors.cardBorder, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontSize: 15 }}
      />
      {shown.length > 0 && (
        <ScrollView horizontal keyboardShouldPersistTaps="handled" showsHorizontalScrollIndicator={false} style={{ marginTop: 6 }}>
          {shown.map((o) => (
            <TouchableOpacity key={o} onPress={() => onChange(o)} style={{ borderWidth: 1, borderColor: colors.cardBorder, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 5, marginRight: 6 }}>
              <Text style={{ color: colors.text, fontSize: 13 }}>{o}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const blankLed = (): LedDetails => ({ brand: '', model: '', cct: '' });

export default function LedPickerModal({ visible, lists, initial, onSave, onCancel }: Props) {
  const { colors } = useTheme();
  const [rows, setRows] = useState<LedDetails[]>([blankLed()]);
  // Android doesn't resize a Modal for the keyboard, so track its height ourselves and shrink the sheet to what is left.
  const [kb, setKb] = useState(0);
  const { height: winH } = useWindowDimensions();
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const show = Keyboard.addListener('keyboardDidShow', (e) => setKb(e.endCoordinates?.height ?? 0));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKb(0));
    return () => { show.remove(); hide.remove(); };
  }, []);
  useEffect(() => { if (!visible) setKb(0); }, [visible]);

  // Re-seed each time the picker opens (from the LEDs passed in, or one blank LED).
  const seed = JSON.stringify(initial ?? []);
  useEffect(() => {
    if (visible) {
      const start = (initial ?? []).filter(hasLed).map((l) => ({ brand: l.brand ?? '', model: l.model ?? '', cct: l.cct ?? '' }));
      setRows(start.length ? start : [blankLed()]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, seed]);

  const setField = (i: number, f: keyof LedDetails, v: string) => setRows((r) => r.map((x, j) => (j === i ? { ...x, [f]: v } : x)));
  const removeAt = (i: number) => setRows((r) => (r.length > 1 ? r.filter((_, j) => j !== i) : [blankLed()]));
  const modelOptionsFor = (brand: string) => {
    const key = Object.keys(lists.modelsByBrand).find((b) => b.toLowerCase() === brand.trim().toLowerCase());
    const mine = key ? lists.modelsByBrand[key] : [];
    return [...mine, ...lists.models.filter((m) => !mine.includes(m))];
  };

  const can = rows.some(hasLed);
  const last = rows[rows.length - 1];
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={[styles.backdrop, kb > 0 && { paddingBottom: 20 + kb }]}>
        <View style={[styles.sheet, { backgroundColor: colors.card, borderColor: colors.cardBorder }, kb > 0 && { maxHeight: Math.max(220, winH - kb - 60) }]}>
          <Text style={{ color: colors.text, fontSize: 17, fontWeight: '600', marginBottom: 12 }}>{rows.length > 1 ? 'LEDs' : 'LED details'}</Text>
          <ScrollView keyboardShouldPersistTaps="handled">
            {rows.map((r, i) => (
              <View key={i} style={rows.length > 1 || hasLed(r) ? { borderWidth: 1, borderColor: colors.cardBorder, borderRadius: 10, padding: 10, marginBottom: 12 } : undefined}>
                {(rows.length > 1 || hasLed(r)) && (
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <Text style={{ color: colors.accent, fontSize: 12, fontWeight: '700', textTransform: 'uppercase' }}>{rows.length > 1 ? `LED ${i + 1}` : 'LED'}</Text>
                    <TouchableOpacity onPress={() => removeAt(i)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} accessibilityRole="button" accessibilityLabel={rows.length > 1 ? `Remove LED ${i + 1}` : 'Clear LED'}>
                      <Text style={{ color: colors.muted, fontSize: 12 }}>{rows.length > 1 ? 'Remove' : 'Clear'}</Text>
                    </TouchableOpacity>
                  </View>
                )}
                <Field label="LED brand" value={r.brand ?? ''} onChange={(v) => setField(i, 'brand', v)} options={lists.brands} placeholder="e.g. Nichia" />
                <Field label="LED model" value={r.model ?? ''} onChange={(v) => setField(i, 'model', v)} options={modelOptionsFor(r.brand ?? '')} placeholder="e.g. 519A" />
                <Field label="CCT" value={r.cct ?? ''} onChange={(v) => setField(i, 'cct', v)} options={lists.ccts} placeholder="e.g. 4000 (leave blank for a deep red)" keyboardType="numeric" />
              </View>
            ))}
            <TouchableOpacity
              disabled={!hasLed(last) || rows.length >= MAX_LEDS}
              onPress={() => setRows((r) => [...r, blankLed()])}
              accessibilityRole="button"
              style={{ alignSelf: 'flex-start', borderWidth: 1, borderColor: colors.cardBorder, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 7, marginBottom: 12, opacity: hasLed(last) && rows.length < MAX_LEDS ? 1 : 0.4 }}
            >
              <Text style={{ color: colors.accent, fontSize: 13, fontWeight: '600' }}>+ Add another LED</Text>
            </TouchableOpacity>
            <Text style={{ color: colors.mutedFaint, fontSize: 11 }}>Values that aren’t in the list yet are sent to hCRI.io for review.</Text>
          </ScrollView>
          <View style={styles.row}>
            <TouchableOpacity onPress={onCancel} style={styles.btn}><Text style={{ color: colors.muted, fontSize: 15 }}>Cancel</Text></TouchableOpacity>
            <TouchableOpacity
              disabled={!can}
              onPress={() => onSave(rows.filter(hasLed).map((r) => ({ brand: (r.brand ?? '').trim(), model: (r.model ?? '').trim(), cct: (r.cct ?? '').trim() })))}
              style={[styles.btn, { backgroundColor: colors.accent, opacity: can ? 1 : 0.4 }]}
            >
              <Text style={{ color: '#fff', fontSize: 15, fontWeight: '600' }}>Save</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', padding: 20 },
  sheet: { borderRadius: 14, borderWidth: 1, padding: 16, maxHeight: '85%' },
  row: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 12 },
  btn: { paddingHorizontal: 16, paddingVertical: 9, borderRadius: 8, marginLeft: 8 },
});
