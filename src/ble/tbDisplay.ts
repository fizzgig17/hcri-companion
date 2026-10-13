// src/ble/tbDisplay.ts
//
// Which way up the Torch Bearer bridge's screen is drawn. The bridge keeps the choice in its own flash, so this only
// needs to say what the user picked in Settings: null until they have picked (the app then leaves the bridge as it is),
// otherwise true = turned 180 degrees. MeterConnection sends it when it connects to a bridge and again whenever it changes.

let flip: boolean | null = null;
const listeners = new Set<(flipped: boolean) => void>();

export function getTbFlip(): boolean | null {
  return flip;
}

/** Sets the choice. `notify` is false when loading the saved value at launch (nothing is connected yet). */
export function setTbFlip(value: boolean | null, notify = true): void {
  flip = value;
  if (notify && value !== null) listeners.forEach((cb) => cb(value));
}

export function onTbFlip(cb: (flipped: boolean) => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
