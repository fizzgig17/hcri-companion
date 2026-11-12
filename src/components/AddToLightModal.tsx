// src/components/AddToLightModal.tsx
//
// History > Select > "To light": put the checked readings on an existing light or start a new one. It only changes the light on
// this phone (the readings are not uploaded here); the Lights tab's Sync sends it all to hCRI.io, uploading what was never uploaded.

import React, { useEffect, useState } from 'react';
import { Modal, View, Text, TextInput, TouchableOpacity, ScrollView } from 'react-native';
import { useTheme } from '../contexts/ThemeContext';
import { createLocalLight, loadLights, LocalLight, patchLight } from '../storage/lightsStore';

/** The words every label starts with (a name for the light), unless that is only the auto-made "Reading <time>". */
export function suggestLightName(labels: string[]): string {
  const ws = labels.map((l) => l.trim().split(/\s+/));
  if (ws.length < 2) return '';
  const out: string[] = [];
  for (let i = 0; i < ws[0].length; i++) {
    const w = ws[0][i];
    if (ws.every((x) => x[i] && x[i].toLowerCase() === w.toLowerCase())) out.push(w); else break;
  }
  const s = out.join(' ').replace(/[\s\-–—_:,]+$/, '');
  return /^reading\b/i.test(s) || /^\d/.test(s) ? '' : s;
}

interface Props {
  visible: boolean;
  /** The checked readings, in the order they should be added. */
  readings: { id: string; label: string; reportId?: number | string }[];
  onClose: () => void;
  /** Called after the readings were added; `light` is the light they went on. */
  onAdded: (light: LocalLight, count: number) => void;
}

export default function AddToLightModal({ visible, readings, onClose, onAdded }: Props) {
  const { colors } = useTheme();
  const [lights, setLights] = useState<LocalLight[]>([]);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!visible) return;
    loadLights().then((l) => setLights([...l]));
    setName(suggestLightName(readings.map((r) => r.label)));
    setBusy(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const addTo = async (light: LocalLight) => {
    setBusy(true);
    const fresh = readings.filter((r) => !light.readingIds.includes(r.id));
    const back = new Set(fresh.map((r) => r.reportId).filter((x) => x != null).map(String));   // put back after being taken off
    const next = await patchLight(light.id, (x) => ({ readingIds: [...x.readingIds, ...fresh.map((r) => r.id)], removedReportIds: x.removedReportIds.filter((r) => !back.has(r)) }));
    setBusy(false);
    onAdded(next ?? light, fresh.length);
  };
  const createAndAdd = async () => {
    const n = name.trim(); if (!n) return;
    setBusy(true);
    const l = await createLocalLight(n, '', readings.map((r) => r.id));
    setBusy(false);
    onAdded(l, readings.length);
  };

  const input = { borderWidth: 1, borderColor: colors.cardBorder, borderRadius: 8, color: colors.text, padding: 10, fontSize: 15 } as const;
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: '#000a', justifyContent: 'center', padding: 20 }}>
        <View style={{ backgroundColor: colors.card, borderRadius: 14, padding: 16, maxHeight: '85%' }}>
          <Text style={{ color: colors.text, fontSize: 17, fontWeight: '700', marginBottom: 2 }}>Add to light</Text>
          <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 12 }}>{readings.length} reading{readings.length === 1 ? '' : 's'} selected. They are uploaded when you sync the light.</Text>
          <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>New light</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <TextInput value={name} onChangeText={setName} placeholder="Name, e.g. Zebralight SC64" placeholderTextColor={colors.mutedFaint} style={[input, { flex: 1 }]} />
            <TouchableOpacity disabled={!name.trim() || busy} onPress={createAndAdd} style={{ marginLeft: 8, backgroundColor: colors.accent, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 11, opacity: !name.trim() || busy ? 0.4 : 1 }}>
              <Text style={{ color: '#fff', fontWeight: '700', fontSize: 14 }}>Create</Text>
            </TouchableOpacity>
          </View>
          {lights.length > 0 && <Text style={{ color: colors.muted, fontSize: 12, marginTop: 14, marginBottom: 4 }}>Or an existing light</Text>}
          <ScrollView style={{ maxHeight: 260 }} keyboardShouldPersistTaps="handled">
            {lights.map((l) => (
              <TouchableOpacity key={l.id} disabled={busy} onPress={() => addTo(l)} style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.cardBorder }}>
                <Text style={{ color: colors.text, fontSize: 15, fontWeight: '600' }} numberOfLines={1}>{l.name}</Text>
                <Text style={{ color: colors.muted, fontSize: 11 }}>{l.readingIds.length} reading{l.readingIds.length === 1 ? '' : 's'}{l.serverId ? ' · on hCRI.io' : ''}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 12 }}>
            <TouchableOpacity onPress={onClose} style={{ paddingHorizontal: 14, paddingVertical: 9 }}><Text style={{ color: colors.muted, fontSize: 15 }}>Cancel</Text></TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}
