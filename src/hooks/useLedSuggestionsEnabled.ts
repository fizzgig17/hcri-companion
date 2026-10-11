// src/hooks/useLedSuggestionsEnabled.ts
//
// Whether LED suggestions are switched on in Settings. Re-read each time the screen comes back into focus so
// flipping the switch in Settings takes effect as soon as you return. False until the saved value has loaded,
// so nothing is requested from hCRI.io before we know the setting.

import { useEffect, useState } from 'react';
import { loadLedSuggestionsPreference } from '../storage/preferences';

type Nav = { addListener: (event: 'focus', cb: () => void) => () => void };

export default function useLedSuggestionsEnabled(navigation: Nav): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    let live = true;
    const load = () => {
      loadLedSuggestionsPreference().then((v) => live && setEnabled(v)).catch(() => live && setEnabled(true));
    };
    load();
    const unsub = navigation.addListener('focus', load);
    return () => { live = false; unsub(); };
  }, [navigation]);
  return enabled;
}
