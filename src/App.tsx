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
import HomeScreen from './screens/HomeScreen';
import SettingsScreen from './screens/SettingsScreen';

const Stack = createNativeStackNavigator();

export default function App() {
  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerStyle: { backgroundColor: '#111' }, headerTintColor: '#eee' }}>
        <Stack.Screen name="Home" component={HomeScreen} options={{ title: 'HPCS-330P' }} />
        <Stack.Screen name="Settings" component={SettingsScreen} options={{ title: 'hCRI.io Settings' }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}