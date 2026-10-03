// src/components/ErrorBoundary.tsx
//
// Top-level crash guard. Without this, ANY uncaught error anywhere in the
// component tree -- including something as narrow as a single malformed
// BLE reply slipping past a bounds check (see takeMeasurement.ts's
// 2026-09-28 crash) -- takes the WHOLE app down to React Native's red error
// screen, with no way back in except a full app restart. This catches it
// instead: shows a plain "something went wrong" screen with the error
// message and a button that resets just the crashed subtree, without
// needing to kill and relaunch the app -- and, since the BLE connection
// itself lives in HomeScreen's own state (one level below this boundary),
// resetting just remounts HomeScreen and starts a fresh connect attempt,
// exactly like a normal app launch would.
//
// Class component because React's error boundary API
// (getDerivedStateFromError/componentDidCatch) has no hook equivalent --
// this is the one place in the app that has to be a class for that reason
// alone.

import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { useTheme } from '../contexts/ThemeContext';
import { ThemeColors } from '../theme';

interface Props {
  children: React.ReactNode;
}

interface State {
  error: Error | null;
}

// Class component because React's error boundary API has no hook
// equivalent (see the file-level comment) -- so it can't call useTheme()
// itself. The colors it needs are resolved by the thin functional wrapper
// at the bottom of this file (the actual default export) and passed in as
// a prop instead.
class ErrorBoundaryImpl extends React.Component<Props & { colors: ThemeColors }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Mirrors console.log's own forwarding to the Metro terminal in debug
    // builds (see HomeScreen's appendLog) -- this is the one crash path
    // that can't go through the in-app Logs tab, since the component tree
    // holding it just got torn down.
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary] Uncaught error:', error, info.componentStack);
  }

  reset = () => {
    this.setState({ error: null });
  };

  render() {
    const { colors } = this.props;
    const styles = StyleSheet.create({
      container: { flex: 1, backgroundColor: colors.background },
      scroll: { flexGrow: 1, justifyContent: 'center', padding: 24 },
      title: { color: colors.danger, fontSize: 20, fontWeight: '700', marginBottom: 12, textAlign: 'center' },
      message: { color: colors.text, fontSize: 14, marginBottom: 16, textAlign: 'center', fontFamily: 'monospace' },
      hint: { color: colors.muted, fontSize: 12, marginBottom: 24, textAlign: 'center' },
      button: { backgroundColor: colors.accent, borderRadius: 10, paddingVertical: 14, alignItems: 'center' },
      buttonText: { color: colors.text, fontSize: 15, fontWeight: '700' },
    });

    if (this.state.error) {
      return (
        <View style={styles.container}>
          <ScrollView contentContainerStyle={styles.scroll}>
            <Text style={styles.title}>Something went wrong</Text>
            <Text style={styles.message}>{this.state.error.message}</Text>
            <Text style={styles.hint}>
              This is a crash, not a normal error -- if it keeps happening, screenshot this and send it over.
            </Text>
            <TouchableOpacity style={styles.button} onPress={this.reset} activeOpacity={0.8}>
              <Text style={styles.buttonText}>Try Again</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      );
    }
    return this.props.children;
  }
}

export default function ErrorBoundary(props: Props) {
  const { colors } = useTheme();
  return <ErrorBoundaryImpl {...props} colors={colors} />;
}
