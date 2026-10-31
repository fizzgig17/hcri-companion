// src/ble/bridgeSim.ts
//
// Developer builds only: simulating an instrument on the bridge. With nothing plugged into the bridge, command 07 <kind>
// makes it advertise, draw its screens and answer like a Torch Bearer, ColorMunki or TKLamp tester (with made-up
// readings), so each instrument's screen can be worked on without the instrument. While it is on, the bridge also
// reports every press and release of its own buttons (result packet 07), which Settings shows.
//
// The chosen kind is kept here, and only for as long as the bridge link lasts: null until chosen, so a bridge is left alone
// until someone picks something, and back to null when the bridge disconnects (the bridge ends its simulation on disconnect
// too, so the two agree). MeterConnection sends it when it connects to a bridge and again whenever it changes.

import { Buffer } from 'buffer';

/** 0 off, 1 Torch Bearer, 2 ColorMunki, 3 TKLamp tester (the bridge's own numbering). */
export type BridgeSimKind = 0 | 1 | 2 | 3;

export const BRIDGE_SIM_OPTIONS: [BridgeSimKind, string][] = [
  [0, 'Off'],
  [2, 'ColorMunki'],
  [1, 'Torch Bearer'],
  [3, 'TKLamp'],
];

/** Command 08, base64: restarts the bridge. */
export const BRIDGE_RESET_CMD_B64 = Buffer.from([0x08]).toString('base64');

/** What the bridge's two buttons do for each simulated instrument (top first). */
export const BRIDGE_SIM_BUTTON_ROLES: Record<Exclude<BridgeSimKind, 0>, { top: string; bottom: string }> = {
  1: { top: 'Read (one reading)', bottom: 'Live (simulated, press again to stop)' },
  2: { top: 'Turn the dial', bottom: 'Calibrate / measure' },
  3: { top: 'Previous light level', bottom: 'Next light level' },
};

/** Command 07 <kind>, base64, ready for the bridge's command characteristic. */
export function bridgeSimCommandB64(kind: BridgeSimKind): string {
  return Buffer.from([0x07, kind]).toString('base64');
}

let sim: BridgeSimKind | null = null;
const simListeners = new Set<(kind: BridgeSimKind) => void>();

export function getBridgeSim(): BridgeSimKind | null {
  return sim;
}

/** Sets the choice. `notify` is false when only the app's own record changes (the bridge is not told). */
export function setBridgeSim(kind: BridgeSimKind | null, notify = true): void {
  sim = kind;
  stateListeners.forEach((cb) => cb());
  if (notify && kind !== null) simListeners.forEach((cb) => cb(kind));
}

// ---- Bridge link, Connect and Reset from Settings -----------------------------------------------------------------------

let linked = false;
const stateListeners = new Set<() => void>();

export function isBridgeLinked(): boolean {
  return linked;
}

/** Called by MeterConnection as a bridge connects and disconnects. Losing the link ends the simulation on the app's side. */
export function setBridgeLinked(up: boolean): void {
  if (linked === up) return;
  linked = up;
  if (!up) {
    sim = null;
    lastButton = null;
  }
  stateListeners.forEach((cb) => cb());
}

/** Settings listens here to redraw when the link or the choice changes. */
export function onBridgeSimState(cb: () => void): () => void {
  stateListeners.add(cb);
  return () => {
    stateListeners.delete(cb);
  };
}

const connectListeners = new Set<() => void>();
/** Settings' Connect button: the Home screen listens and runs its normal connect flow. */
export function requestBridgeConnect(): void {
  connectListeners.forEach((cb) => cb());
}
export function onBridgeConnectRequest(cb: () => void): () => void {
  connectListeners.add(cb);
  return () => {
    connectListeners.delete(cb);
  };
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

/** "Top button pressed: Read (one reading)", naming what the press does for the simulated instrument. */
export function bridgeButtonText(e: BridgeButtonEvent, kind: BridgeSimKind | null = null): string {
  const name = e.button === 'top' ? 'Top' : 'Bottom';
  const roles = kind ? BRIDGE_SIM_BUTTON_ROLES[kind as 1 | 2 | 3] : undefined;
  const does = roles ? `: ${e.button === 'top' ? roles.top : roles.bottom}` : '';
  return e.pressed ? `${name} button pressed${does}` : `${name} button released${does} (held ${(e.heldMs / 1000).toFixed(1)} s)`;
}
