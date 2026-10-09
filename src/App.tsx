// src/App.tsx
//
// Ties the modular pieces together with simple stack navigation between the
// two screens. Requires @react-navigation/native + @react-navigation/native-stack
// (and their peer deps: react-native-screens, react-native-safe-area-context):
//
//   npm install @react-navigation/native @react-navigation/native-stack
//   npm install react-native-screens react-native-safe-area-context
//
// If you'd rather not add navigation yet, this file is the only place that
// needs to change -- swap it for simple conditional rendering of
// HomeScreen/SettingsScreen with a bit of local state instead.

import React, { useEffect } from 'react';
import { StatusBar, View } from 'react-native';
import { NavigationContainer, DarkTheme, DefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import HomeScreen from './screens/HomeScreen';
import HistoryScreen from './screens/HistoryScreen';
import SettingsScreen from './screens/SettingsScreen';
import ReadingDetailScreen from './screens/ReadingDetailScreen';
import ErrorBoundary from './components/ErrorBoundary';
import DevBuildBanner from './components/DevBuildBanner';
import SplashTitle from './components/SplashTitle';
import CrashReporter from './components/CrashReporter';
import { HomeIcon, HistoryIcon, SettingsIcon } from './components/TabBarIcons';
import { ThemeProvider, useTheme } from './contexts/ThemeContext';
import { LogProvider } from './contexts/LogContext';
import { MAX_CONTENT_WIDTH } from './layout';
import { navigationRef } from './navigationRef';
import { UpdateProvider } from './contexts/UpdateContext';
import { DevBuildProvider } from './contexts/DevBuildContext';
import UpdateBanner from './components/UpdateBanner';
import { setTapHapticsEnabled, setResultHapticsEnabled } from './utils/haptics';
import { loadHapticTapsPreference, loadHapticResultsPreference, loadTbCorrectionPreference } from './storage/preferences';
import { setTbCorrectionEnabled } from './ble/tbCorrection';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

// The three top-level destinations -- Home (take/view the current
// reading), History (every past reading), Settings (account, appearance,
// measurement customization, About). Used to be Home/Settings as stack
// screens with History and About as panels buried inside Home's own
// TabBar; pulling History and About out to where they're reachable in one
// tap, same footing as Settings, is what let Home's own top bar shrink
// down to just Main/Data/Logs -- see HomeScreen.tsx and SettingsScreen.tsx.
function Tabs() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  // Some phones (e.g. Galaxy Z Fold) report a tiny/zero bottom inset yet have
  // rounded corners or a gesture pill that clips the labels, so keep a floor.
  const bottomPad = Math.max(insets.bottom, 10);

  return (
    <Tab.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.card },
        headerTintColor: colors.text,
        // Compact bar: 40dp of content (icon + label) plus the gesture/nav inset below it.
        tabBarStyle: { backgroundColor: colors.card, borderTopColor: colors.cardBorder, height: 41 + bottomPad, paddingTop: 2, paddingBottom: bottomPad + 3 },
        tabBarItemStyle: { paddingVertical: 0 },
        tabBarLabelStyle: { fontSize: 10, marginTop: -2, marginBottom: 2 }, tabBarAllowFontScaling: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.muted,
      }}
    >
      {/* Draws its own compact status row (MainTab) instead of a native
          header -- see HomeScreen.tsx for why there's no title bar here any
          more. */}
      <Tab.Screen
        name="Home"
        component={HomeScreen}
        options={{ headerShown: false, tabBarIcon: ({ color }) => <HomeIcon color={color} size={22} /> }}
      />
      <Tab.Screen
        name="History"
        component={HistoryScreen}
        options={{
          headerShown: false,
          tabBarIcon: ({ color }) => <HistoryIcon color={color} size={22} />,
        }}
      />
      <Tab.Screen
        name="Settings"
        component={SettingsScreen}
        options={{
          // Same in-page heading as History (see SettingsScreen), so no native header.
          headerShown: false,
          tabBarLabel: 'Settings',
          tabBarIcon: ({ color }) => <SettingsIcon color={color} size={22} />,
        }}
      />
    </Tab.Navigator>
  );
}

// Pulled out so it can call useTheme() -- that only works BELOW
// <ThemeProvider>, which is why App() itself (below) doesn't call it
// directly and instead renders this as ThemeProvider's child.
function Navigation() {
  const { colors, scheme } = useTheme();
  useEffect(() => {
    loadHapticTapsPreference().then(setTapHapticsEnabled).catch(() => {});
    loadHapticResultsPreference().then(setResultHapticsEnabled).catch(() => {});
    loadTbCorrectionPreference().then(setTbCorrectionEnabled).catch(() => {});
  }, []);

  return (
    <View style={{ flex: 1, alignItems: 'center', backgroundColor: colors.background }}>
    <View style={{ flex: 1, width: '100%', maxWidth: MAX_CONTENT_WIDTH }}>
    <UpdateBanner />
    <NavigationContainer ref={navigationRef} theme={scheme === 'light' ? DefaultTheme : DarkTheme}>
      {/* Status bar text/icons need to flip too -- dark-on-light is
          unreadable against a light background, and vice versa. */}
      <StatusBar barStyle={scheme === 'light' ? 'dark-content' : 'light-content'} />
      <Stack.Navigator
        screenOptions={{ headerStyle: { backgroundColor: colors.card }, headerTintColor: colors.text }}
      >
        {/* The bottom tab bar IS the app's main shell -- Tabs owns its own
            headers per-tab, so this outer stack screen has none of its
            own. ReadingDetail (pushed from History, "open a past
            reading") sits on top of the tabs as a full-screen push, the
            same relationship it had to Home before. */}
        <Stack.Screen name="Tabs" component={Tabs} options={{ headerShown: false }} />
        <Stack.Screen name="ReadingDetail" component={ReadingDetailScreen} options={{ title: 'Reading' }} />
      </Stack.Navigator>
    </NavigationContainer>
    </View>
    {/* Title screen over the top for the first moment of every launch --
        the app keeps loading/connecting underneath. See SplashTitle.tsx. */}
    <SplashTitle />
    </View>
  );
}

export default function App() {
  return (
    // Required for useSafeAreaInsets()/SafeAreaView (from
    // react-native-safe-area-context) to work anywhere in the tree --
    // without this, nothing knows how tall the status bar/notch is.
    // Needed now specifically because HomeScreen hides the nav header
    // (which used to handle this automatically) and draws its own header
    // row instead, so that row has to account for the inset itself.
    <SafeAreaProvider>
      {/* Resolves the Light/Dark/System preference (see
          contexts/ThemeContext.tsx) once, here at the root, so every
          screen below reads the same live theme via useTheme() rather
          than each one loading/resolving the preference on its own.
          Has to be the OUTERMOST wrapper, further out than ErrorBoundary
          -- ErrorBoundary's own functional wrapper (see
          components/ErrorBoundary.tsx) calls useTheme() itself, to theme
          its fallback screen. useTheme() throws if there's no
          ThemeProvider above it in the tree, so with ErrorBoundary on
          the outside (as this used to be ordered) that throw happened
          unconditionally on every mount, before ErrorBoundary's own
          class component ever got a chance to render -- a crash with
          nothing left to catch it, since the thing that crashed was the
          catcher itself. */}
      <ThemeProvider>
        {/* The debug log (Logs tab, Share Debug Log) -- lives above the
            tab navigator, not inside HomeScreen, now that History is a
            sibling tab that also needs to append to it (its own uploads)
            rather than a panel nested inside Home. See
            contexts/LogContext.tsx. Ordering relative to ErrorBoundary
            doesn't matter (ErrorBoundary doesn't read it), but sitting
            outside it means a caught-and-reset crash doesn't wipe the log
            you'd want to read to find out what crashed. */}
        <LogProvider>
          {/* No UI of its own -- surfaces whatever crashLog.ts recorded
              right before the LAST crash (if any) into this session's
              debug log, so the "flash open then crash" report has
              something to go on next time it happens without needing
              adb attached at that exact moment. See CrashReporter.tsx. */}
          <CrashReporter />
          {/* Wraps EVERYTHING below it -- including navigation itself -- so an
              uncaught error anywhere in the tree (Home, Settings, any tab) hits
              this instead of taking the whole app down. See
              components/ErrorBoundary.tsx for why. */}
          <ErrorBoundary>
            {/* Sits above the navigator (every screen, not just Home) so
                it's impossible to be on ANY screen of a dev-targeted build
                without seeing it -- a no-op view in a production build, see
                components/DevBuildBanner.tsx. */}
            <DevBuildBanner />
            <UpdateProvider>
              <DevBuildProvider>
                <Navigation />
              </DevBuildProvider>
            </UpdateProvider>
          </ErrorBoundary>
        </LogProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
