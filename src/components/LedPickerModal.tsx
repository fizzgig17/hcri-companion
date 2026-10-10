// src/components/LedPickerModal.tsx
//
// Pick (or type) an LED brand, model and CCT. Each field is a text box with tappable matches from the
// hCRI.io lists underneath; anything typed that isn't in the lists is sent to hCRI.io for review.

import React, { useEffect, useMemo, useState } from 'react';
import { Modal, View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { useTheme } from '../contexts/ThemeContext';
import { LedLists } from '../hcri/ledLists';
import { LedDetails } from '../hcri/ledApi';

interface Props {
  visible: boolean;
  lists: LedLists;
  initial?: LedDetails;
  onSave: (d: LedDetails) => void;
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

export default function LedPickerModal({ visible, lists, initial, onSave, onCancel }: Props) {
  const { colors } = useTheme();
  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const [cct, setCct] = useState('');

  useEffect(() => {
    if (visible) {
      setBrand(initial?.brand ?? '');
      setModel(initial?.model ?? '');
      setCct(initial?.cct ?? '');
    }
  }, [visible, initial?.brand, initial?.model, initial?.cct]);

  const modelOptions = useMemo(() => {
    const key = Object.keys(lists.modelsByBrand).find((b) => b.toLowerCase() === brand.trim().toLowerCase());
    const mine = key ? lists.modelsByBrand[key] : [];
    return [...mine, ...lists.models.filter((m) => !mine.includes(m))];
  }, [lists, brand]);

  const can = !!(brand.trim() || model.trim() || cct.trim());
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.backdrop}>
        <View style={[styles.sheet, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
          <Text style={{ color: colors.text, fontSize: 17, fontWeight: '600', marginBottom: 12 }}>LED details</Text>
          <ScrollView keyboardShouldPersistTaps="handled">
            <Field label="LED brand" value={brand} onChange={setBrand} options={lists.brands} placeholder="e.g. Nichia" />
            <Field label="LED model" value={model} onChange={setModel} options={modelOptions} placeholder="e.g. 519A" />
            <Field label="CCT" value={cct} onChange={setCct} options={lists.ccts} placeholder="e.g. 4000" keyboardType="numeric" />
            <Text style={{ color: colors.mutedFaint, fontSize: 11 }}>Values that aren’t in the list yet are sent to hCRI.io for review.</Text>
          </ScrollView>
          <View style={styles.row}>
            <TouchableOpacity onPress={onCancel} style={styles.btn}><Text style={{ color: colors.muted, fontSize: 15 }}>Cancel</Text></TouchableOpacity>
            <TouchableOpacity
              disabled={!can}
              onPress={() => onSave({ brand: brand.trim(), model: model.trim(), cct: cct.trim() })}
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
