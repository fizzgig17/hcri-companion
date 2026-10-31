// src/ble/bridgeSim.ts
//
// Developer builds only: simulating an instrument on the bridge. With nothing plugged into the bridge, command 07 <kind>
// makes it advertise, draw its screens and answer like a Torch Bearer, ColorMunki or TKLamp tester (with made-up
// readings), so each instrument's screen can be worked on without the instrument. While it is on, the bridge also
// reports every press and release of its own buttons (result packet 07), which Settings shows.
//
// The chosen kind is kept here (and saved by preferences.ts): null until chosen, so a bridge is left alone until someone
// picks something. MeterConnection sends it when it connects to a bridge and again whenever it changes.

import { Buffer } from 'buffer';

/** 0 off, 1 Torch Bearer, 2 ColorMunki, 3 TKLamp tester (the bridge's own numbering). */
export type BridgeSimKind = 0 | 1 | 2 | 3;

export const BRIDGE_SIM_OPTIONS: [BridgeSimKind, string][] = [
  [0, 'Off'],
  [2, 'ColorMunki'],
  [1, 'Torch Bearer'],
  [3, 'TKLamp'],
];

/** Command 07 <kind>, base64, ready for the bridge's command characteristic. */
export function bridgeSimCommandB64(kind: BridgeSimKind): string {
  return Buffer.from([0x07, kind]).toString('base64');
}

let sim: BridgeSimKind | null = null;
const simListeners = new Set<(kind: BridgeSimKind) => void>();

export function getBridgeSim(): BridgeSimKind | null {
  return sim;
}

/** Sets the choice. `notify` is false when loading the saved value at launch (nothing is connected yet). */
export function setBridgeSim(kind: BridgeSimKind | null, notify = true): void {
  sim = kind;
  if (notify && kind !== null) simListeners.forEach((cb) => cb(kind));
}

export function onBridgeSim(cb: (kind: BridgeSimKind) => void): () => void {
  simListeners.add(cb);
  return () => {
    simListeners.delete(cb);
  };
}

// ---- Button presses reported by the bridge ----------------------------------------------------------------------------

export interface BridgeButtonEvent {
  button: 'top' | 'bottom';
  /** true = pressed down, false = let go. */
  pressed: boolean;
  /** How long it was held, in ms (on release only; 0 on press). */
  heldMs: number;
  /** When the app received it. */
  at: number;
}

/** Result packet 07: [07][button 1 top / 2 bottom][pressed 1 / 0][bridge uptime ms u32][held ms u16]. */
export function parseBridgeButton(p: Uint8Array): BridgeButtonEvent | null {
  if (p.length < 3 || p[0] !== 0x07 || (p[1] !== 1 && p[1] !== 2)) return null;
  const heldMs = p.length >= 9 ? p[7] | (p[8] << 8) : 0;
  return { button: p[1] === 1 ? 'top' : 'bottom', pressed: p[2] === 1, heldMs, at: Date.now() };
}

let lastButton: BridgeButtonEvent | null = null;
const buttonListeners = new Set<(e: BridgeButtonEvent) => void>();

export function getLastBridgeButton(): BridgeButtonEvent | null {
  return lastButton;
}

export function emitBridgeButton(e: BridgeButtonEvent): void {
  lastButton = e;
  buttonListeners.forEach((cb) => cb(e));
}

export function onBridgeButton(cb: (e: BridgeButtonEvent) => void): () => void {
  buttonListeners.add(cb);
  return () => {
    buttonListeners.delete(cb);
  };
}

export function bridgeButtonText(e: BridgeButtonEvent): string {
  const name = e.button === 'top' ? 'Top' : 'Bottom';
  return e.pressed ? `${name} button pressed` : `${name} button released (held ${(e.heldMs / 1000).toFixed(1)} s)`;
}
