// src/hcri/buildCsv.ts
//
// Builds the CSV payload hCRI.io expects. Per your earlier call on the ESP32
// project, this is deliberately minimal -- just the model name and the raw
// wavelength/value spectrum. Everything else (CCT, Ra, x/y, etc.) is a
// standard colorimetric calculation hCRI.io derives from the spectrum itself,
// so there's no need to duplicate that math here or send it over the wire.

import { MeterResult } from '../ble/parseResult';

export function buildCsv(result: MeterResult): string {
  const lines: string[] = [];
  lines.push(`Model,${result.deviceName || 'HPCS-330P'}`);

  if (result.spectrum.length > 0) {
    lines.push(`StartTestWave,${result.spectrum[0].nm}`);
    lines.push(`EndTestWave,${result.spectrum[result.spectrum.length - 1].nm}`);
  }

  for (const point of result.spectrum) {
    lines.push(`${point.nm},${point.value}`);
  }

  return lines.join('\n');
}

/** Default label when the user hasn't typed one: username + timestamp. */
export function defaultLabel(username: string | null): string {
  const now = new Date();
  const stamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return username ? `${username}-${stamp}` : stamp;
}
