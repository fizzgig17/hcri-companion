// src/hooks/useKeyboardHeight.ts
//
// Current on-screen keyboard height (0 when hidden). Modals don't resize for the keyboard on Android and
// (inside a centered sheet) iOS doesn't move them either, so a popup with text boxes uses this to pad itself
// and shrink to the room that is left, which keeps the field being typed in on screen.
import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';

export function useKeyboardHeight(active: boolean = true): number {
  const [h, setH] = useState(0);
  useEffect(() => {
    if (!active) { setH(0); return; }
    const ios = Platform.OS === 'ios';
    const show = Keyboard.addListener(ios ? 'keyboardWillShow' : 'keyboardDidShow', (e) => setH(e.endCoordinates?.height ?? 0));
    const hide = Keyboard.addListener(ios ? 'keyboardWillHide' : 'keyboardDidHide', () => setH(0));
    return () => { show.remove(); hide.remove(); };
  }, [active]);
  return h;
}
