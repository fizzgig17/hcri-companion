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

import React from 'react';
import { StatusBar } from 'react-native';
import { NavigationContainer, DarkTheme, DefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import HomeScreen from './screens/HomeScreen';
import SettingsScreen from './screens/SettingsScreen';
import ReadingDetailScreen from './screens/ReadingDetailScreen';
import ErrorBoundary from './components/ErrorBoundary';
import DevBuildBanner from './components/DevBuildBanner';
import { ThemeProvider, useTheme } from './contexts/ThemeContext';

const Stack = createNativeStackNavigator();

// Pulled out so it can call useTheme() -- that only works BELOW
// <ThemeProvider>, which is why App() itself (below) doesn't call it
// directly and instead renders this as ThemeProvider's child.
function Navigation() {
  const { colors, scheme } = useTheme();

  return (
    <NavigationContainer theme={scheme === 'light' ? DefaultTheme : DarkTheme}>
      {/* Status bar text/icons need to flip too -- dark-on-light is
          unreadable against a light background, and vice versa. */}
      <StatusBar barStyle={scheme === 'light' ? 'dark-content' : 'light-content'} />
      <Stack.Navigator
        screenOptions={{ headerStyle: { backgroundColor: colors.card }, headerTintColor: colors.text }}
      >
        <Stack.Screen name="Home" component={HomeScreen} options={{ headerShown: false }} />
        <Stack.Screen name="Settings" component={SettingsScreen} options={{ title: 'hCRI.io Settings' }} />
        <Stack.Screen name="ReadingDetail" component={ReadingDetailScreen} options={{ title: 'Reading' }} />
      </Stack.Navigator>
    </NavigationContainer>
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
      {/* Wraps EVERYTHING below it -- including navigation itself -- so an
          uncaught error anywhere in the tree (Home, Settings, any tab) hits
          this instead of taking the whole app down. See
          components/ErrorBoundary.tsx for why. */}
      <ErrorBoundary>
        {/* Resolves the Light/Dark/System preference (see
            contexts/ThemeContext.tsx) once, here at the root, so every
            screen below reads the same live theme via useTheme() rather
            than each one loading/resolving the preference on its own. */}
        <ThemeProvider>
          {/* Sits above the navigator (every screen, not just Home) so
              it's impossible to be on ANY screen of a dev-targeted build
              without seeing it -- a no-op view in a production build, see
              components/DevBuildBanner.tsx. */}
          <DevBuildBanner />
          <Navigation />
        </ThemeProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
