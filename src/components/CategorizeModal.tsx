// src/components/CategorizeModal.tsx
//
// The Categorize dialog: the LEDs (via the existing LED picker) plus light brand / model, optic, lumens and current,
// each a text box with tappable matches from the hCRI.io lists. Used for one reading (History row, reading page) and
// for several at once (History > Select > Categorize).
//
// Nothing is applied until the person taps Categorize. The dialog opens with the reading's own values, and any field
// the reading has nothing for starts from what was applied last time (`remembered`) -- a starting point, not an action.
// For several readings it also asks whether to fill only readings that have no value yet, or replace what they have.

import React, { useEffect, useState } from 'react';
import { Modal, View, Text, TouchableOpacity, ScrollView, StyleSheet, KeyboardAvoidingView, Platform, Keyboard, useWindowDimensions } from 'react-native';
import { useTheme } from '../contexts/ThemeContext';
import { LedLists } from '../hcri/ledLists';
import { CategoryValues, OTHER_KINDS, EMPTY_VALUES, hasAnyValue } from '../hcri/categorize';
import { hasLed, ledsLine } from '../hcri/leds';
import LedPickerModal, { Field } from './LedPickerModal';

interface Props {
  visible: boolean;
  /** "Categorize" or "Categorize 3 readings". */
  title: string;
  lists: LedLists;
  /** The reading's own values (empty for several readings). */
  initial?: CategoryValues;
  /** What was applied last time: fills only the fields `initial` leaves blank. */
  remembered?: CategoryValues;
  /** True for several readings: shows the fill-only / replace choice. */
  bulk?: boolean;
  /** Categorizing a light: no lumens / current (a light has no single value for those). */
  light?: boolean;
  onApply: (values: CategoryValues, replace: boolean) => void;
  onCancel: () => void;
}

export default function CategorizeModal({ visible, title, lists, initial, remembered, bulk, light, onApply, onCancel }: Props) {
  const { colors } = useTheme();
  const kinds = light ? OTHER_KINDS.filter((k) => !k.numeric) : OTHER_KINDS;
  const [values, setValues] = useState<CategoryValues>(EMPTY_VALUES);
  const [replace, setReplace] = useState(false);
  const [ledOpen, setLedOpen] = useState(false);
  const [kb, setKb] = useState(0);
  const { height: winH } = useWindowDimensions();

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const show = Keyboard.addListener('keyboardDidShow', (e) => setKb(e.endCoordinates?.height ?? 0));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKb(0));
    return () => { show.remove(); hide.remove(); };
  }, []);
  useEffect(() => { if (!visible) setKb(0); }, [visible]);

  // Re-seed every time the dialog opens.
  const seed = JSON.stringify([initial ?? null, remembered ?? null]);
  useEffect(() => {
    if (!visible) return;
    const own = initial ?? EMPTY_VALUES;
    const mem = remembered ?? EMPTY_VALUES;
    const other: CategoryValues['other'] = {};
    for (const { kind } of kinds) other[kind] = own.other[kind] || mem.other[kind] || '';
    setValues({ leds: own.leds.some(hasLed) ? own.leds : mem.leds, other });
    setReplace(false);
    setLedOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, seed]);

  const leds = values.leds.filter(hasLed);
  const can = hasAnyValue(values);
  const setOther = (k: string, v: string) => setValues((p) => ({ ...p, other: { ...p.other, [k]: v } }));
  const clearAll = () => setValues({ leds: [], other: {} });

  return (
    <>
      <Modal visible={visible && !ledOpen} transparent animationType="fade" onRequestClose={onCancel}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={[styles.backdrop, kb > 0 && { paddingBottom: 20 + kb }]}>
          <View style={[styles.sheet, { backgroundColor: colors.card, borderColor: colors.cardBorder }, kb > 0 && { maxHeight: Math.max(220, winH - kb - 60) }]}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <Text style={{ color: colors.text, fontSize: 17, fontWeight: '600', flexShrink: 1 }}>{title}</Text>
              <TouchableOpacity onPress={clearAll} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} accessibilityRole="button" accessibilityLabel="Clear all fields">
                <Text style={{ color: colors.muted, fontSize: 13 }}>Clear fields</Text>
              </TouchableOpacity>
            </View>
            <ScrollView keyboardShouldPersistTaps="handled">
              <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>LEDs</Text>
              <TouchableOpacity
                onPress={() => setLedOpen(true)}
                accessibilityRole="button"
                accessibilityLabel="Edit LEDs"
                style={{ borderWidth: 1, borderColor: colors.cardBorder, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 10, marginBottom: 14, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}
              >
                <Text numberOfLines={2} style={{ color: leds.length ? colors.text : colors.mutedFaint, fontSize: 15, flexShrink: 1 }}>{leds.length ? ledsLine(leds) : 'Not set'}</Text>
                <Text style={{ color: colors.accent, fontSize: 13, fontWeight: '600', marginLeft: 8 }}>{leds.length ? 'Edit' : 'Add'}</Text>
              </TouchableOpacity>
              {kinds.map(({ kind, label, numeric }) => (
                <Field
                  key={kind}
                  label={label}
                  value={values.other[kind] ?? ''}
                  onChange={(v) => setOther(kind, v)}
                  options={lists.others?.[kind] ?? []}
                  placeholder={numeric ? 'e.g. 800' : `e.g. ${kind === 'optic' ? 'TIR' : kind === 'light_brand' ? 'Convoy' : 'S2+'}`}
                  keyboardType={numeric ? 'numeric' : 'default'}
                />
              ))}
              {bulk && (
                <View style={{ marginTop: 2, marginBottom: 10 }}>
                  <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 6 }}>Readings that already have a value</Text>
                  <View style={{ flexDirection: 'row' }}>
                    {([[false, 'Keep their value'], [true, 'Replace it']] as const).map(([val, lab]) => (
                      <TouchableOpacity
                        key={lab}
                        onPress={() => setReplace(val)}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: replace === val }}
                        style={{ borderWidth: 1, borderColor: replace === val ? colors.accent : colors.cardBorder, backgroundColor: replace === val ? colors.accent : 'transparent', borderRadius: 14, paddingHorizontal: 12, paddingVertical: 6, marginRight: 8 }}
                      >
                        <Text style={{ color: replace === val ? '#fff' : colors.text, fontSize: 13 }}>{lab}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  <Text style={{ color: colors.mutedFaint, fontSize: 11, marginTop: 6 }}>
                    {replace ? 'Every selected reading gets the values filled in above, replacing what it has.' : 'A reading only gets a value where it has none yet; what it already has is left alone.'}
                  </Text>
                </View>
              )}
              <Text style={{ color: colors.mutedFaint, fontSize: 11 }}>
                Blank fields are left as they are. {light ? 'Values that aren’t in the lists yet are not kept on a light; suggest them from a reading or on hCRI.io.' : 'Values that aren’t in the list yet are sent to hCRI.io for review (lumens and current are added as typed).'} Nothing changes until you tap Categorize.
              </Text>
            </ScrollView>
            <View style={styles.row}>
              <TouchableOpacity onPress={onCancel} style={styles.btn}><Text style={{ color: colors.muted, fontSize: 15 }}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity
                disabled={!can}
                onPress={() => onApply(values, bulk ? replace : true)}
                accessibilityRole="button"
                style={[styles.btn, { backgroundColor: colors.accent, opacity: can ? 1 : 0.4 }]}
              >
                <Text style={{ color: '#fff', fontSize: 15, fontWeight: '600' }}>Categorize</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
      {/* The LED picker is a second dialog; this one steps aside while it is open, then comes back. */}
      <LedPickerModal
        visible={visible && ledOpen}
        lists={lists}
        initial={leds.length ? leds : undefined}
        onSave={(l) => { setValues((p) => ({ ...p, leds: l })); setLedOpen(false); }}
        onCancel={() => setLedOpen(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', padding: 20 },
  sheet: { borderRadius: 14, borderWidth: 1, padding: 16, maxHeight: '88%' },
  row: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 12 },
  btn: { paddingHorizontal: 16, paddingVertical: 9, borderRadius: 8, marginLeft: 8 },
});
