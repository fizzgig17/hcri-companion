// src/utils/statMetrics.ts
//
// Registry of every measurement the Main tab's result card is able to
// show, plus which one shows under which label/unit/formatting. One place
// defining a metric's id/label/unit/formatter means MainTab and
// SettingsScreen (and storage/statDisplayPrefs.ts, which only ever talks
// in these ids) always agree on what "Rf" or "R9" means and how many
// decimals it gets -- the same single-source-of-truth spirit as
// spectralAnalysis.ts itself, and the formatting here matches exactly
// what DataTab already shows for the same values (CCT 0dp, Ra/R9/Ri 1dp,
// Duv 5dp, x/y 4dp) so a value never reads differently in two places.
//
// `par` (also on MeterResult) is deliberately NOT offered here -- see
// ble/protocol.ts's own comment on it ("present but unverified/unused by
// this app"). Surfacing a field nothing has confirmed is actually PAR
// (and not, say, mislabeled raw ADC counts) as a user-selectable
// measurement risked showing confidently-wrong numbers; every metric
// below is one the app already computes and trusts elsewhere.

import { MeterResult } from '../ble/parseResult';
import { SpectralAnalysis } from './spectralAnalysis';

export interface StatMetric {
  id: string;
  label: string;
  /**
   * Returns null if this metric has no value for the current reading --
   * currently only Lux on a device that doesn't report illuminance
   * (result.lux === null; see parseResult.ts). MainTab skips rendering
   * the tile entirely in that case rather than showing a dash for a
   * measurement the person deliberately chose to see.
   */
  format: (result: MeterResult, analysis: SpectralAnalysis) => { value: string; unit?: string } | null;
}

const CORE_METRICS: StatMetric[] = [
  { id: 'cct', label: 'CCT', format: (_r, a) => ({ value: a.cct.toFixed(0), unit: 'K' }) },
  { id: 'ra', label: 'Ra (CRI)', format: (_r, a) => ({ value: a.ra.toFixed(1) }) },
  { id: 'duv', label: 'Duv', format: (_r, a) => ({ value: a.duv.toFixed(5) }) },
  { id: 'lux', label: 'Lux', format: (r) => (r.lux !== null ? { value: r.lux.toFixed(0) } : null) },
  { id: 'rf', label: 'Rf', format: (_r, a) => ({ value: a.rf.toFixed(0) }) },
  { id: 'r9', label: 'R9', format: (_r, a) => ({ value: a.r9.toFixed(1) }) },
  { id: 'rg', label: 'Rg', format: (_r, a) => ({ value: a.rg.toFixed(0) }) },
  // x/y chromaticity: already computed and trusted (DataTab's own
  // "Chromaticity" section shows these two), and genuinely useful to a
  // lighting enthusiast plotting a source against a target locus -- the
  // most defensible "other measurement worth adding" beyond the R-values
  // the person explicitly asked for.
  { id: 'x', label: 'x', format: (_r, a) => ({ value: a.x.toFixed(4) }) },
  { id: 'y', label: 'y', format: (_r, a) => ({ value: a.y.toFixed(4) }) },
  // Reading-quality values straight from the meter (MeterResult). Hidden by
  // default; handy for judging whether a reading was well exposed.
  { id: 'peakSignal', label: 'Peak signal', format: (r) => ({ value: r.peakSignal.toFixed(0) }) },
  { id: 'darkSignal', label: 'Dark signal', format: (r) => ({ value: r.darkSignal.toFixed(0) }) },
  { id: 'integrationTime', label: 'Integ. time', format: (r) => ({ value: r.integrationTimeMs.toFixed(0), unit: 'ms' }) },
  { id: 'compensateLevel', label: 'Compensate', format: (r) => ({ value: r.compensateLevel.toFixed(0) }) },
];

// R1-R15, individually selectable -- analysis.ri[0] is R1, ri[14] is R15.
// R9 is deliberately excluded here: it's already its own CORE_METRICS
// entry above (same underlying value -- analysis.r9 and analysis.ri[8]
// are the identical number, calcCriHires's special TCS-9 sample, just
// exposed two ways on SpectralAnalysis) and having two list entries for
// the same measurement would be confusing, not additive.
const R_METRICS: StatMetric[] = Array.from({ length: 15 }, (_, i) => ({
  id: `r${i + 1}`,
  label: `R${i + 1}`,
  format: (_r: MeterResult, a: SpectralAnalysis) => ({ value: a.ri[i].toFixed(1) }),
})).filter((m) => m.id !== 'r9');

/** Every selectable measurement, in the registry's own natural order -- the core colorimetric values first, R1-R15 last (see DEFAULT_VISIBLE_STAT_IDS / defaultStatOrder() below for how that maps to Settings' default list ordering). */
export const STAT_METRICS: StatMetric[] = [...CORE_METRICS, ...R_METRICS];

export const STAT_METRIC_IDS: string[] = STAT_METRICS.map((m) => m.id);

export const STAT_METRIC_BY_ID: Record<string, StatMetric> = Object.fromEntries(
  STAT_METRICS.map((m) => [m.id, m]),
);

/**
 * Shown on the Main tab's result card out of the box, in this order,
 * before anyone touches Settings -- CCT/Ra/Duv/Lux/Rf/R9/Rg, matching
 * what the app already showed prior to this being configurable (just
 * reordered to the sequence requested: CCT, Ra, Duv, Lux, Rf, R9, Rg).
 */
export const DEFAULT_VISIBLE_STAT_IDS: string[] = ['cct', 'ra', 'duv', 'lux', 'rf', 'r9', 'rg'];
