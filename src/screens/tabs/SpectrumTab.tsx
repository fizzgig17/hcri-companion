// src/screens/tabs/SpectrumTab.tsx
//
// Three swipeable sub-pages -- the wavelength-colored SPD graph (+ raw
// per-nm values), the CIE 1931 chromaticity diagram, and the CRI R1-R15
// bar chart (ported from hCRI.io's own report page -- see
// RValuesBarChart.tsx). Swipe between them, or tap the dot indicator. No
// longer a top-level tab of its own -- it's mounted directly below the
// measurement grid on MainTab (and ReadingDetailScreen, for a past
// reading), the one place that grid already lives, rather than a separate
// tab you'd have to switch to after every reading. Chrom's own x/y numbers
// are annotated directly on its chart (see ChromaticityChart.tsx) instead
// of a second stat-card row here -- the measurement grid above already
// covers CCT/Duv/Ra/R9/etc. for whichever of those the person has chosen
// to see.
//
// This same component is reused, unchanged, by both MainTab.tsx (the live
// reading) and ReadingDetailScreen.tsx (the History tab's "View" ->
// past-reading detail screen) -- a saved reading's result/analysis are the
// exact same shape as a live one, so there's exactly one implementation of
// "Spectrum/Chrom/R-Values" to keep in sync rather than two that could
// drift apart.

import React, { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useContentWidth } from '../../layout';
import SpectrumChart, { SPECTRUM_HEADER_H } from '../../components/SpectrumChart';
import ChromaticityChart from '../../components/ChromaticityChart';
import RValuesBarChart from '../../components/RValuesBarChart';
import FlickerChart from '../../components/FlickerChart';
import type { FlickerReading } from '../../ble/liveSessions';
import type { FlickerSettingsApi } from '../../components/FlickerSettingsModal';
import type { FlickerUploadApi } from '../../components/FlickerChart';
import SwipablePages from '../../components/SwipablePages';
import { useTheme } from '../../contexts/ThemeContext';
import { MeterResult } from '../../ble/parseResult';
import { SpectralAnalysis } from '../../utils/spectralAnalysis';

interface Props {
  result: MeterResult | null;
  /** Spectrum-derived x/y/CCT/Duv/Ra/R9 for `result`, computed once in HomeScreen via analyzeSpectrum() -- the exact port of hCRI.io's own algorithm, so this matches what hCRI.io itself will show for the same upload. */
  analysis: SpectralAnalysis | null;
  /**
   * Extra horizontal chrome (both sides combined) imposed by whatever
   * wraps THIS instance of SpectrumTab, beyond the screen's own usual
   * 16px-each-side scroll padding -- which both this component and the
   * three chart components it renders used to just assume was the only
   * chrome there'd ever be. ReadingDetailScreen really does render
   * SpectrumTab directly inside its own padded scroll content, so 0
   * (the default) is correct there. MainTab, though, additionally wraps
   * it in its own `resultCard` (padding: 14 AND borderWidth: 1 each
   * side -- 30px combined, not just the 28px of padding alone) --
   * confirmed 2026-10-03 as the actual cause of "the box around the
   * chart is too big for the viewport, missing left or right lines":
   * every chart was computing its width as if only the screen's 32px
   * padding existed, so on Main every chart (and the swipeable pager
   * itself) rendered wider than the real room left inside resultCard,
   * pushing their right edge (and the pager's forced page width, which
   * every chart's own container stretches to fill) out past the card's
   * visible border. First fixed by passing 28 here (resultCard's padding
   * alone), which turned out to still be 2px short -- resultCard's own
   * 1px border on each side was never counted either, the same mistake
   * CARD_PADDING below made one level in for chartCard/chromCard's own
   * border. MainTab now passes its real 30px here instead.
   */
  extraHorizontalChrome?: number;
  /** Main tab: the exact height the swipeable pager (charts + dots) may fill. Charts are sized to fit it so nothing scrolls. Omit for the natural sizes (200 spectrum, 230 chrom/R-values). */
  regionHeight?: number;
  /** Set when `result` is a sample from a public hCRI.io report (not a reading from the person's own meter) -- only changes the "What's this?" text. */
  sampleLabel?: string;
  /** Present only when the connected meter can measure flicker: adds the fourth (Flicker) page. `focusNonce` changing jumps to it. */
  flicker?: { reading: FlickerReading | null; running: boolean; focusNonce: number; history: { f: number; p: number }[]; settings?: FlickerSettingsApi; upload?: FlickerUploadApi };
  /** Changing this sends the pager back to the Spectrum page; defaults to `result`. Live updates replace `result` constantly without changing this. */
  pagerResetKey?: unknown;
}

// The screen's own scroll-content padding (HomeScreen's and
// ReadingDetailScreen's `content` styles both use paddingHorizontal: 16
// / padding: 16 -- 16px each side) -- true for every host of this
// component regardless of extraHorizontalChrome above.
const SCREEN_PADDING = 32;
// Each chart's own chartCard/chromCard, below, has padding: 10 AND
// borderWidth: 1 each side -- 22px of combined horizontal inset, not just
// the 20px of padding alone. Confirmed 2026-10-03 as the actual "right
// side is cut off, charts are slightly too big for where they are" bug:
// this constant used to only subtract the padding, so every chart's own
// SVG was drawn 2px wider than the room the card's border really left
// for it. That 2px used to just quietly overlap the card's own border
// line; once chartCard/chromCard picked up overflow: 'hidden' (to stop
// content spilling past the Chrom page's rounded corner), those same 2px
// started getting hard-clipped off the right edge instead -- visible
// now, when it was only ever cosmetically overlapping the border line
// before.
const CARD_PADDING = 22;
// Spectrum plot proportions (width : height), matching the vendor app's wide,
// short plot rather than filling all the vertical room it's offered.
const SPECTRUM_ASPECT = 1.65;

// A box with an exact, computed height (no layout feedback): hands that height to the chart. `center`
// vertically centers the chart in it (spectrum page only).
function FixedBox({ h, center, children }: { h: number; center?: boolean; children: (height: number) => React.ReactNode }) {
  return <View style={{ height: h, justifyContent: center ? 'center' : 'flex-start' }}>{h > 0 ? children(h) : null}</View>;
}

export default function SpectrumTab({ result, analysis, extraHorizontalChrome = 0, regionHeight, sampleLabel, flicker, pagerResetKey }: Props) {
  const source = sampleLabel
    ? `This is a sample from a public hCRI.io report (${sampleLabel}), not a reading from your own meter. It isn't saved to History and can't be uploaded or shared.`
    : 'This comes from the reading your meter just took.';
  const { colors } = useTheme();
  // Main tab (regionHeight given): the pager is exactly the region minus its dots row (26 tall + 8 above +
  // 4 below = 38), every page's card fills it, and each chart is sized from the space its card actually has
  // (see MeasuredBox) instead of from hand-added overhead constants -- those kept drifting a few px short
  // and clipped the bottom of the cards. Elsewhere (no regionHeight) charts keep their fixed default sizes.
  const fill = !!regionHeight && regionHeight > 0;
  // Exact numbers all the way down (see SwipablePages: pages are the region minus the 38 dots strip). The
  // card is the page height minus a little breathing room; its inner room is that minus padding+border (22).
  const cardH = fill ? Math.max(100, Math.floor(regionHeight as number) - 38 - 6) : 0;
  const innerH = Math.max(40, cardH - 22);
  // Computed once, here, rather than separately (and inconsistently) in
  // SwipablePages and in each of the three chart components -- see this
  // file's own Props comment above for why a hardcoded per-component
  // chrome constant was the actual bug. `pageWidth` is what the
  // swipeable pager's own page (and so each chart's chartCard, which
  // stretches to fill it) should be; `chartWidth` is what's left once a
  // chartCard's own padding is subtracted, i.e. what each chart itself
  // should draw its SVG at.
  const windowWidth = useContentWidth();
  const totalChrome = SCREEN_PADDING + extraHorizontalChrome;
  const pageWidth = windowWidth - totalChrome;
  const chartWidth = Math.max(pageWidth - CARD_PADDING, 0);

  const styles = StyleSheet.create({
    empty: { paddingVertical: 40, alignItems: 'center' },
    emptyText: { color: colors.muted, fontSize: 13 },

    // overflow: 'hidden' on both of these -- confirmed 2026-10-03: without
    // it, a child that draws right up to its own edge (the Chrom page's
    // CCT label column in particular, see ChromaticityChart.tsx) can
    // visibly spill a few px past this card's rounded corner instead of
    // being clipped to it, since a plain View doesn't clip its children
    // to its own border-radius by default. Harmless on the other two
    // pages, which don't draw anything that close to their own edge.
    chartCard: {
      backgroundColor: colors.card,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      padding: 10,
      marginBottom: 12,
      overflow: 'hidden',
    },
    // Same card as chartCard above (identical radius/border/padding, so
    // the border reads as the same shape swiping from either neighboring
    // page) but with a guaranteed white background instead of the
    // theme's card color -- the CIE diagram's colors (and the reference
    // image it matches) assume a plain white backdrop regardless of
    // light/dark mode, same reasoning ChromaticityChart's own plot-box
    // Polygon fill has always used. Only the chart's background color
    // differs between these two styles; keeping the radius/border
    // identical is what actually fixes "the border doesn't line up
    // between tabs" -- the Chrom page used to nest a SECOND, differently-
    // rounded white box (ChromaticityChart's own `container` style)
    // inside this one, which is what made its border look different from
    // Spectrum/R-Values' as you swiped between them.
    chromCard: {
      backgroundColor: '#ffffff',
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      padding: 10,
      marginBottom: 12,
      overflow: 'hidden',
    },

    // Main tab: every page's card is the pager's full height, content centered,
    // so the dots (and the ? beside them) sit directly under the card on every page.
    

    rvaluesTitle: { color: colors.muted, fontSize: 11, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', height: 14, marginBottom: 2 },
  });

  if (!result || !analysis) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>Take a reading to see its spectrum here.</Text>
      </View>
    );
  }

  return (
    <SwipablePages
      resetKey={pagerResetKey ?? result}
      goTo={flicker ? { key: 'flicker', n: flicker.focusNonce } : undefined}
      horizontalChrome={totalChrome}
      fill={fill}
      fixedHeight={fill ? Math.floor(regionHeight as number) : undefined}
      pages={[
        {
          key: 'spectrum',
          label: 'Spectrum',
          info: {
            title: 'Spectrum',
            message: `${source}\n\nThe spectral power distribution: how much light the source puts out at each wavelength from about 380 to 780 nm (violet to red), scaled so the tallest point is 1. The red line starts at the peak: press and hold it, then drag to read the wavelength and spectral value anywhere on the curve (a quick swipe still changes charts). Everything else here (CCT, CRI, TM-30) is calculated from this curve.`,
          },
          content: (
            <View style={[styles.chartCard, fill && { height: cardH, marginBottom: 0 }]}>
              {fill ? <FixedBox h={innerH} center>{(h) => (<SpectrumChart
                spectrum={result.spectrum}
                width={chartWidth}
                height={Math.max(60, Math.min(h - SPECTRUM_HEADER_H, Math.round(chartWidth / SPECTRUM_ASPECT)))}
                // A test reading only shows the wavelength under the red line; a real
                // reading adds the integration time and peak/dark signal (and the spectral value).
                details={
                  sampleLabel
                    ? { showRelative: true }
                    : result.source === 'torchbearer'
                    ? { integrationMs: result.integrationTimeMs, integrationDecimals: 1, showSpectral: true, showRelative: true }
                    : {
                        integrationMs: result.integrationTimeMs,
                        peakSignal: result.peakSignal,
                        darkSignal: result.darkSignal,
                        showSpectral: true,
                      }
                }
              />)}</FixedBox> : (((h) => (<SpectrumChart
                spectrum={result.spectrum}
                width={chartWidth}
                height={Math.max(60, Math.min(h - SPECTRUM_HEADER_H, Math.round(chartWidth / SPECTRUM_ASPECT)))}
                // A test reading only shows the wavelength under the red line; a real
                // reading adds the integration time and peak/dark signal (and the spectral value).
                details={
                  sampleLabel
                    ? { showRelative: true }
                    : result.source === 'torchbearer'
                    ? { integrationMs: result.integrationTimeMs, integrationDecimals: 1, showSpectral: true, showRelative: true }
                    : {
                        integrationMs: result.integrationTimeMs,
                        peakSignal: result.peakSignal,
                        darkSignal: result.darkSignal,
                        showSpectral: true,
                      }
                }
              />))(200))}
            </View>
          ),
        },
        {
          key: 'chrom',
          label: 'Chrom',
          info: {
            title: 'CIE 1931 chromaticity',
            message: `${source}\n\nThe colored horseshoe is every color the eye can see (CIE 1931 x,y). The black curve is the Planckian locus, the colors of a heated blackbody from 2,000 K to 10,000 K, and the blue dot is where this light falls. The closer the dot is to the curve, the closer to a natural white (Duv is the distance).`,
          },
          content: (
            <View style={[styles.chromCard, fill && { height: cardH, marginBottom: 0 }]}>
              {/* Shorter than the original 280 -- trimmed because this
                  page (plus the measurement grid and docked tab bar above
                  it) was running long on Main. The diagram's X/Y domain
                  (0.8 x 0.9, see ChromaticityChart.tsx) was already a bit
                  wider than tall at 280, so this compresses the horseshoe
                  a little further rather than clipping anything -- still
                  fully legible, just slightly flatter-looking. */}
              {/* (0,0) is the "no reading yet" placeholder: leave the card blank
                  rather than drawing the empty CIE diagram. */}
              {fill ? (
                <FixedBox h={innerH}>
                  {(h) =>
                    analysis.x > 0 || analysis.y > 0 ? (
                      // -16: the chart's own container adds 6px of top padding, plus a little bottom breathing room
                      // so the x-axis labels never touch the card border.
                      <ChromaticityChart x={analysis.x} y={analysis.y} cct={analysis.cct} height={h - 16} width={chartWidth} />
                    ) : null
                  }
                </FixedBox>
              ) : analysis.x > 0 || analysis.y > 0 ? (
                <ChromaticityChart x={analysis.x} y={analysis.y} cct={analysis.cct} height={230} width={chartWidth} />
              ) : (
                <View style={{ height: 230 }} />
              )}
            </View>
          ),
        },
        {
          key: 'rvalues',
          label: 'R-Values',
          info: {
            title: 'CRI R1-R15',
            message: `${source}\n\nHow faithfully this light renders 15 reference colors compared with a natural light of the same color temperature. 100 is perfect. Ra is the average of R1-R8; R9 (saturated red) is the one most often low in LED lights.`,
          },
          content: (
            <View style={[styles.chartCard, fill && { height: cardH, marginBottom: 0 }]}>
              <Text style={styles.rvaluesTitle} allowFontScaling={false} numberOfLines={1}>CRI R1-R15</Text>
              {/* Explicit height, same as the Chrom page's chart just
                  above -- left to its own default (rowCount*22+28, ~360px
                  for all 15 R-values) this was noticeably taller than the
                  other two swipeable pages. Trimmed from 280 for the same
                  "running long on Main" reason as Chrom's -- still room
                  enough per row (~14px) for all 15 R# labels and bars to
                  stay legible without crowding. */}
              {fill ? (
                <FixedBox h={innerH - 16}>{(h) => <RValuesBarChart ri={analysis.ri} height={h} width={chartWidth} />}</FixedBox>
              ) : (
                <RValuesBarChart ri={analysis.ri} height={230} width={chartWidth} />
              )}
            </View>
          ),
        },
        ...(flicker
          ? [
              {
                key: 'flicker',
                label: 'Flicker',
                info: {
                  title: 'Flicker',
                  message: `Tap Flicker below to start measuring, and Stop to freeze the reading. Shows how fast (Hz) and how deeply (%) this light pulses, the flicker index, and the captured waveform. The waveform is scaled to its highest sample, so a steady light is a flat line near the top and a flickering one rises and falls. The risk tip uses the same bands as the vendor app.`,
                },
                content: (
                  <View style={[styles.chromCard, fill && { height: cardH, marginBottom: 0 }]}>
                    {fill ? (
                      <FixedBox h={innerH}>
                        {(h) => <FlickerChart reading={flicker.reading} running={flicker.running} history={flicker.history} settings={flicker.settings} upload={flicker.upload} width={chartWidth} height={h} />}
                      </FixedBox>
                    ) : (
                      <FlickerChart reading={flicker.reading} running={flicker.running} history={flicker.history} settings={flicker.settings} upload={flicker.upload} width={chartWidth} height={230} />
                    )}
                  </View>
                ),
              },
            ]
          : []),
      ]}
    />
  );
}
