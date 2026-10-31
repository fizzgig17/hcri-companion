// src/ble/useBridgeSimName.ts
//
// The name of the instrument the bridge is simulating right now (developer builds), or null. Re-renders when it changes.

import { useEffect, useState } from 'react';
import { onBridgeSimState, simulatingName } from './bridgeSim';

export function useBridgeSimName(): string | null {
  const [name, setName] = useState<string | null>(simulatingName());
  useEffect(() => {
    setName(simulatingName());
    return onBridgeSimState(() => setName(simulatingName()));
  }, []);
  return name;
}
