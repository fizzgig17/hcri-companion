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
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import HomeScreen from './screens/HomeScreen';
import SettingsScreen from './screens/SettingsScreen';
import ErrorBoundary from './components/ErrorBoundary';

const Stack = createNativeStackNavigator();

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
        <NavigationContainer>
          <Stack.Navigator screenOptions={{ headerStyle: { backgroundColor: '#111' }, headerTintColor: '#eee' }}>
            <Stack.Screen name="Home" component={HomeScreen} options={{ headerShown: false }} />
            <Stack.Screen name="Settings" component={SettingsScreen} options={{ title: 'hCRI.io Settings' }} />
          </Stack.Navigator>
        </NavigationContainer>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
