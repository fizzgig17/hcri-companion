// src/screens/SettingsScreen.tsx
//
// hCRI.io username + API token entry, backed by secureStorage (Keystore/
// Keychain), not plaintext -- unlike the ESP32 firmware's NVS storage.

import React, { useEffect, useState } from 'react';
import { ScrollView, View, Text, TextInput, Switch, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import PrimaryButton from '../components/PrimaryButton';
import DraggableStatList from '../components/DraggableStatList';
import {
  loadHcriCredentials,
  saveHcriCredentials,
  clearHcriCredentials,
} from '../storage/secureStorage';
import {
  loadKeepAwakePreference,
  saveKeepAwakePreference,
  loadVerboseLoggingPreference,
  saveVerboseLoggingPreference,
} from '../storage/preferences';
import {
  StatDisplayPrefs,
  loadStatDisplayPrefs,
  saveStatDisplayPrefs,
  defaultStatDisplayPrefs,
} from '../storage/statDisplayPrefs';
import { STAT_METRIC_BY_ID } from '../utils/statMetrics';
import { maskSecret } from '../utils/maskSecret';
import { useTheme } from '../contexts/ThemeContext';
import { ThemeMode } from '../theme';
import AboutTab from './tabs/AboutTab';
import { APP_VERSION, BUILD_DATE } from '../buildInfo';

// Labels/order for the Light/Dark/System picker below -- System first since
// it's the default every fresh install starts on (see ThemeContext.tsx).
const THEME_MODE_OPTIONS: { value: ThemeMode; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

export default function SettingsScreen() {
  const { colors, mode, setMode } = useTheme();
  const [username, setUsername] = useState('');
  const [token, setToken] = useState('');
  const [hasSaved, setHasSaved] = useState(false);
  // What's actually loaded right now, shown read-only (see maskedToken
  // below) -- separate from `token` above, which is only ever the NEW
  // value being typed in to replace it (see the hasSaved-gated fields
  // below: the two are never shown/editable at the same time).
  const [loadedToken, setLoadedToken] = useState('');
  const [keepAwake, setKeepAwake] = useState(false);
  // Default OFF -- see preferences.ts's loadVerboseLoggingPreference/
  // HomeScreen.tsx's appendLog for what this actually gates (the BLE hex
  // dumps and full raw-result-body dump, not the ordinary connect/measure
  // milestones and errors, which always show regardless of this setting).
  const [verboseLogging, setVerboseLogging] = useState(false);
  // Which measurements show on the Main tab's result card, and in what
  // order -- starts from the built-in default so the list renders
  // immediately (not empty) while loadStatDisplayPrefs() resolves.
  const [statPrefs, setStatPrefs] = useState<StatDisplayPrefs>(defaultStatDisplayPrefs());

  useEffect(() => {
    loadHcriCredentials().then((creds) => {
      if (creds) {
        setUsername(creds.username);
        setLoadedToken(creds.token);
        setHasSaved(true);
        // The token field itself is intentionally not pre-filled -- same
        // masking spirit as the ESP32 provisioning page, which only showed
        // the last few characters of a saved token, never the full value.
        // (The masked first10...last10 below is the "which key is this"
        // check that replaces needing to see the full value.)
      }
    });
    loadKeepAwakePreference().then(setKeepAwake);
    loadVerboseLoggingPreference().then(setVerboseLogging);
    loadStatDisplayPrefs().then(setStatPrefs);
    // Intentionally run once on mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Both handlers use the functional setState form and persist from the
  // freshly-computed `next` value, rather than closing over the
  // `statPrefs` variable above -- that would be a stale read if, say, a
  // fast double-tap on two different checkboxes both fired from the same
  // render's closure.
  const handleReorder = (newOrder: string[]) => {
    setStatPrefs((prev) => {
      const next: StatDisplayPrefs = { order: newOrder, enabled: prev.enabled };
      saveStatDisplayPrefs(next).catch(() => {});
      return next;
    });
  };

  const handleToggleStat = (id: string) => {
    setStatPrefs((prev) => {
      const enabled = new Set(prev.enabled);
      if (enabled.has(id)) enabled.delete(id);
      else enabled.add(id);
      const next: StatDisplayPrefs = { order: prev.order, enabled };
      saveStatDisplayPrefs(next).catch(() => {});
      return next;
    });
  };

  const resetStatsToDefault = () => {
    const next = defaultStatDisplayPrefs();
    setStatPrefs(next);
    saveStatDisplayPrefs(next).catch(() => {});
  };

  const toggleKeepAwake = async (value: boolean) => {
    // Update the toggle immediately rather than waiting on the write to
    // resolve -- same "feel instant" reasoning as HomeScreen's disconnect().
    // HomeScreen reads this preference itself (on connect/disconnect) via
    // loadKeepAwakePreference(), not from this component's state, so it
    // picks up the new value the next time it checks -- it doesn't need to
    // be told about this change directly.
    setKeepAwake(value);
    await saveKeepAwakePreference(value);
  };

  const toggleVerboseLogging = async (value: boolean) => {
    // Same "feel instant" reasoning as toggleKeepAwake above. Unlike
    // keepAwake, nothing needs to react to this mid-connection -- it's read
    // via a ref the next time appendLog is called (see HomeScreen.tsx),
    // not consulted once at connect/disconnect time -- so there's nothing
    // else to notify here.
    setVerboseLogging(value);
    await saveVerboseLoggingPreference(value);
  };

  const save = async () => {
    if (!username.trim() || !token.trim()) {
      Alert.alert('Both fields are required');
      return;
    }
    const trimmedToken = token.trim();
    await saveHcriCredentials({ username: username.trim(), token: trimmedToken });
    // loadedToken (what the locked view's maskSecret() reads) was only
    // ever set by the mount-time loadHcriCredentials() effect -- never
    // here, so right after a fresh Save it was still '', and maskSecret('')
    // returns '' (nothing renders). Only leaving Settings and coming back
    // re-ran that effect and actually populated it. Setting it directly
    // from what was just saved fixes the immediate case without waiting on
    // a round trip back through storage.
    setLoadedToken(trimmedToken);
    setToken('');
    setHasSaved(true);
    Alert.alert('Saved');
  };

  const forget = async () => {
    await clearHcriCredentials();
    setUsername('');
    setToken('');
    setLoadedToken('');
    setHasSaved(false);
  };

  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    // Padding lives here (the scrollable content) rather than on the
    // ScrollView's own `style` -- padding on the outer style can clip the
    // last bit of content at the bottom of a scroll on some platforms.
    // paddingBottom is generous, not just enough to clear the content itself
    // -- this screen has no SafeAreaView of its own, so nothing else is
    // reserving room for the home indicator/nav bar below the last field,
    // and the draggable measurement list (DraggableStatList) can run long
    // enough that a tighter value left it crowding the bottom of the screen.
    contentContainer: { padding: 16, paddingBottom: 56 },
    versionText: { color: colors.mutedFaint, fontSize: 11, textAlign: 'center', marginBottom: 18 },
    label: { color: colors.muted, marginTop: 14, marginBottom: 6 },
    input: {
      backgroundColor: colors.card,
      color: colors.text,
      padding: 11,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.cardBorder,
    },
    // Visually distinct from `input` (no editable-looking border/background)
    // so it reads as "locked display", not just a disabled text field.
    lockedField: {
      backgroundColor: colors.card,
      padding: 11,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.cardBorder,
    },
    // Matches `input`'s own text color rather than a dimmer gray -- a dimmer
    // tone on this box's near-black background read as "I can't see the
    // key, maybe it's too dark" in practice, even though it technically had
    // enough contrast on paper.
    lockedFieldText: { color: colors.text, fontFamily: 'monospace', fontSize: 14 },
    hint: { color: colors.mutedFaint, fontSize: 12, marginTop: 10, lineHeight: 16 },
    // Provides the gap above the Save button; noTopMargin below cancels out
    // PrimaryButton's own default marginTop so it doesn't stack on top of this.
    saveButtonWrap: { marginTop: 18 },
    noTopMargin: { marginTop: 0 },
    // No borderTop/marginTop like toggleRow below -- this is the first
    // section on the screen, directly under the credentials form, so there's
    // nothing above it yet to separate from.
    appearanceSection: { marginTop: 28 },
    appearanceLabel: { color: colors.text, fontSize: 14, fontWeight: '600', marginBottom: 10 },
    // Segmented control: three equal-width options sharing one pill-shaped
    // track, rather than three separate buttons -- makes clear they're a
    // single mutually-exclusive choice, not three independent toggles.
    modeSegment: {
      flexDirection: 'row',
      backgroundColor: colors.card,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      padding: 3,
    },
    modeOption: {
      flex: 1,
      paddingVertical: 9,
      borderRadius: 8,
      alignItems: 'center',
    },
    modeOptionActive: { backgroundColor: colors.accent },
    modeOptionText: { color: colors.muted, fontSize: 13, fontWeight: '600' },
    // Matches PrimaryButton's own accent-background text color (colors.text,
    // not colors.background) so this reads as the same "selected/accent"
    // treatment used everywhere else in the app.
    modeOptionTextActive: { color: colors.text },

    toggleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: 28,
      paddingTop: 20,
      borderTopWidth: 1,
      borderTopColor: colors.cardBorder,
    },
    toggleTextWrap: { flex: 1, marginRight: 12 },
    toggleLabel: { color: colors.text, fontSize: 14, fontWeight: '600', marginBottom: 4 },
    toggleHint: { color: colors.muted, fontSize: 12, lineHeight: 16 },

    statsSection: {
      marginTop: 28,
      paddingTop: 20,
      borderTopWidth: 1,
      borderTopColor: colors.cardBorder,
    },
    statsHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    statsTitle: { color: colors.text, fontSize: 14, fontWeight: '600' },
    statsResetLink: { color: colors.info, fontSize: 12.5 },
    statsHint: { color: colors.muted, fontSize: 12, lineHeight: 16, marginTop: 4, marginBottom: 14 },

    aboutSection: {
      marginTop: 28,
      paddingTop: 20,
      borderTopWidth: 1,
      borderTopColor: colors.cardBorder,
    },
    aboutTitle: { color: colors.text, fontSize: 14, fontWeight: '600', marginBottom: 12 },
  });

  // Formatted once per render from the plain 'YYYY-MM-DD' in buildInfo.ts --
  // not worth memoizing, this screen doesn't re-render often enough for it
  // to matter.
  const builtOn = new Date(`${BUILD_DATE}T00:00:00`).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer}>
      {/* Which build you're looking at, at a glance -- came up more than
          once this session when testing against a build that was already
          a few fixes behind develop. See buildInfo.ts for how this stays
          in sync with the native versionName/versionCode. */}
      <Text style={styles.versionText}>
        hCRI Companion v{APP_VERSION} · Built {builtOn}
      </Text>

      {hasSaved ? (
        // Locked view: credentials are already saved, so the fields are
        // read-only and there's no Save button here at all -- "Forget
        // Credentials" is the only way back to an editable form. Without
        // this, it was possible to fat-finger a character in the token
        // field and silently overwrite a working key with a broken one
        // (no confirmation, no way to tell beforehand), with no record of
        // what the old value even was. Forcing a deliberate clear first
        // makes replacing a key a two-step, harder-to-do-by-accident
        // action, same spirit as the ESP32 provisioning flow.
        <>
          <Text style={styles.label}>hCRI.io Username</Text>
          <View style={styles.lockedField}>
            <Text style={styles.lockedFieldText}>{username}</Text>
          </View>

          <Text style={styles.label}>hCRI.io API Token (currently loaded)</Text>
          <View style={styles.lockedField}>
            <Text style={styles.lockedFieldText}>{maskSecret(loadedToken)}</Text>
          </View>
          <Text style={styles.hint}>
            To use a different account or key, forget the current credentials first.
          </Text>

          <View style={styles.saveButtonWrap}>
            <PrimaryButton title="Forget Credentials" onPress={forget} variant="danger" style={styles.noTopMargin} />
          </View>
        </>
      ) : (
        <>
          <Text style={styles.label}>hCRI.io Username</Text>
          <TextInput
            style={styles.input}
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
            placeholder="username"
            placeholderTextColor={colors.mutedFaint}
          />

          <Text style={styles.label}>hCRI.io API Token</Text>
          <TextInput
            style={styles.input}
            value={token}
            onChangeText={setToken}
            autoCapitalize="none"
            secureTextEntry
            placeholder="hcri_..."
            placeholderTextColor={colors.mutedFaint}
          />

          <View style={styles.saveButtonWrap}>
            <PrimaryButton title="Save" onPress={save} style={styles.noTopMargin} />
          </View>
        </>
      )}

      <View style={styles.appearanceSection}>
        <Text style={styles.appearanceLabel}>Appearance</Text>
        <View style={styles.modeSegment}>
          {THEME_MODE_OPTIONS.map((opt) => {
            const active = mode === opt.value;
            return (
              <TouchableOpacity
                key={opt.value}
                style={[styles.modeOption, active && styles.modeOptionActive]}
                onPress={() => setMode(opt.value)}
              >
                <Text style={[styles.modeOptionText, active && styles.modeOptionTextActive]}>{opt.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      <View style={styles.toggleRow}>
        <View style={styles.toggleTextWrap}>
          <Text style={styles.toggleLabel}>Keep screen awake while connected</Text>
          <Text style={styles.toggleHint}>
            Prevents the screen from locking during a session with the meter connected. Uses more battery.
          </Text>
        </View>
        <Switch value={keepAwake} onValueChange={toggleKeepAwake} trackColor={{ true: colors.accent }} />
      </View>

      <View style={styles.toggleRow}>
        <View style={styles.toggleTextWrap}>
          <Text style={styles.toggleLabel}>Verbose logging</Text>
          <Text style={styles.toggleHint}>
            Adds full wavelength-by-wavelength data and Bluetooth connection/transmission details to the
            debug log, for troubleshooting a specific problem with Share Debug Log. Off by default -- the
            standard log already covers connection and measurement status.
          </Text>
        </View>
        <Switch value={verboseLogging} onValueChange={toggleVerboseLogging} trackColor={{ true: colors.accent }} />
      </View>

      <View style={styles.statsSection}>
        <View style={styles.statsHeaderRow}>
          <Text style={styles.statsTitle}>Main Screen Measurements</Text>
          <TouchableOpacity onPress={resetStatsToDefault}>
            <Text style={styles.statsResetLink}>Reset to Default</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.statsHint}>
          Check which measurements show on the Main tab after a reading. Hold the ⠿ handle and drag a row to
          reorder it.
        </Text>
        <DraggableStatList
          order={statPrefs.order}
          enabled={statPrefs.enabled}
          labelFor={(id) => STAT_METRIC_BY_ID[id]?.label ?? id}
          onReorder={handleReorder}
          onToggle={handleToggleStat}
        />
      </View>

      {/* Used to be its own tab in Home's TabBar -- static reference
          content (which meter models are supported) you check once, maybe
          twice ever, not something that deserves a permanent slot next to
          Main/Data/Logs. Settings is the right home for it: everything
          else on this screen is also "look at this rarely, not every
          session." */}
      <View style={styles.aboutSection}>
        <Text style={styles.aboutTitle}>About</Text>
        <AboutTab />
      </View>
    </ScrollView>
  );
}
