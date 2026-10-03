// src/utils/placeholderReading.ts
//
// A zeroed-out MeterResult/SpectralAnalysis pair, shown on the Main tab
// before any reading has actually been taken yet (or before a meter is
// even connected). Rendering this instead of nothing means the stat grid
// and all three Spectrum/Chrom/R-Values charts are already in their final
// layout from the very first time the tab is shown -- just with "0"
// everywhere and blank-looking charts -- so the Take Reading button (which
// sits right below them) never has to jump to a different position the
// moment a real reading comes in. See MainTab.tsx for where this is used.

import { MeterResult } from '../ble/parseResult';
import { SpectralAnalysis } from './spectralAnalysis';

// 380-780nm in 5nm steps (81 points) -- the same tabulated CIE range this
// app's own spectral locus/analysis code uses elsewhere (see
// spectralAnalysis.ts's exactSpectralLocus5nm), so this placeholder spans
// the same domain a real reading's spectrum would. Every value is exactly
// 0, which SpectrumChart.tsx already renders as a flat line along its own
// baseline with no extra casing needed there -- a blank-looking chart
// comes for free.
export const EMPTY_SPECTRUM: { nm: number; value: number }[] = Array.from({ length: 81 }, (_, i) => ({
  nm: 380 + i * 5,
  value: 0,
}));

export const EMPTY_METER_RESULT: MeterResult = {
  deviceName: '',
  firmwareVersion: 0,
  cct: 0,
  ra: 0,
  lux: 0,
  par: 0,
  peakSignal: 0,
  darkSignal: 0,
  integrationTimeMs: 0,
  compensateLevel: 0,
  x: 0,
  y: 0,
  duv: 0,
  rIndices: Array(15).fill(0),
  tm30Rf: 0,
  tm30Rg: 0,
  timestampOnDevice: '',
  spectrum: EMPTY_SPECTRUM,
};

export const EMPTY_SPECTRAL_ANALYSIS: SpectralAnalysis = {
  x: 0,
  y: 0,
  cct: 0,
  duv: 0,
  ra: 0,
  r9: 0,
  ri: Array(15).fill(0),
  rf: 0,
  rg: 0,
};
