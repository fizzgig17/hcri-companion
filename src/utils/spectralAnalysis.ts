// src/utils/spectralAnalysis.ts
//
// This is a line-for-line port of hCRI.io's own production CCT/Duv/CRI
// algorithm (api/_core/spd.php: _cmf1nm/_xy_hires/_planck_uv_hires/
// calc_cct_duv_hires/calc_cri_hires/analyze_spd), not a separate
// approximation of the same math. The user's own hCRI.io source was
// supplied specifically so that every colorimetric number this app shows
// (CCT, Duv, x, y, Ra, R9, R1-R15) is produced by the *exact same*
// algorithm hCRI.io itself will compute for the identical uploaded
// spectrum -- not a "close enough" local approximation that could quietly
// disagree with the website by tens of Kelvin or a point of Ra.
//
// Specifically this ports the "hires" (1nm-resolution) variant of
// hCRI.io's math rather than its base 5nm-table variant, because that's
// what hCRI.io itself uses whenever it has 1nm-ish source data to work
// with (matches the IES TM-30 calculator's own resolution) -- and this
// app's spectrum (see parseResult.ts) is already effectively 1nm-spaced,
// so the hires path is the correct match, not a downgrade.
//
// Deliberately NOT ported: calc_rf_rg (TM-30 Rf/Rg + the CVG wheel) --
// that needs a 99-sample CES reflectance set (ces_data.php) and a full
// CIECAM02 -> CAM02-UCS pipeline the app has no display for yet. Nothing
// here currently calls it; add it the same way (port verbatim, don't
// re-derive) if Rf/Rg ever need to show up in the UI.
//
// Every exported numeric result the app displays should flow through
// analyzeSpectrum() below -- that's the single entry point, computed once
// per reading (see HomeScreen.tsx) and threaded down to every tab that
// shows a colorimetric value, so there is exactly one code path producing
// CCT/Duv/Ra/R9/x/y anywhere in the app.

/**
 * The real CIE 1931 2-degree spectral locus -- xy chromaticity of each pure
 * wavelength from 380-780nm, 5nm steps (81 points) -- computed directly
 * from the exact tabulated CMF_X/CMF_Y/CMF_Z data above (the same verbatim
 * hCRI.io tables analyzeSpectrum() itself integrates against), not a
 * closed-form approximation of the CMFs' shape.
 *
 * ChromaticityChart.tsx used to draw its horseshoe from a Gaussian-lobe
 * approximation of the CMFs (Wyman/Sloan/Shirley) instead -- fine for
 * roughly the right shape, but its wobble right at the violet and red
 * extremes (where the real locus is very tightly curved) is what was
 * actually causing that chart's persistent fill/overlap glitches there,
 * independent of anything about render order. This is the fix: the exact
 * same real data the rest of this file (and hCRI.io itself) treats as
 * ground truth, so the drawn curve is the real locus, not a stand-in for
 * it.
 */
export function exactSpectralLocus5nm(): { nm: number; x: number; y: number }[] {
  const points: { nm: number; x: number; y: number }[] = [];
  for (let i = 0; i < 81; i++) {
    const X = CMF_X[i], Y = CMF_Y[i], Z = CMF_Z[i];
    const s = X + Y + Z;
    points.push({ nm: 380 + i * 5, x: s > 0 ? X / s : 0.3333, y: s > 0 ? Y / s : 0.3333 });
  }
  return points;
}

export interface SpectralAnalysis {
  x: number;
  y: number;
  cct: number;
  duv: number;
  ra: number;
  r9: number;
  /** R1..R15, in order (index 0 = R1). */
  ri: number[];
}

// ── CIE 1931 2-degree standard observer, exact tabulated values, 5nm steps,
// 380-780nm (81 values each) -- verbatim from hCRI.io's CMF_X/CMF_Y/CMF_Z. ──
const CMF_X = [0.001368,0.002236,0.004243,0.007650,0.014310,0.023190,0.043510,0.077630,0.134380,0.214770,0.283900,0.328500,0.348280,0.348060,0.336200,0.318700,0.290800,0.251100,0.195360,0.142100,0.095640,0.057950,0.032010,0.014700,0.004900,0.002400,0.009300,0.029100,0.063270,0.109600,0.165500,0.225750,0.290400,0.359700,0.433450,0.512050,0.594500,0.678400,0.762100,0.842500,0.916300,0.978600,1.026300,1.056700,1.062200,1.045600,1.002600,0.938400,0.854450,0.751400,0.642400,0.541900,0.447900,0.360800,0.283500,0.218700,0.164900,0.121200,0.087400,0.063600,0.046770,0.032900,0.022700,0.015840,0.011359,0.008111,0.005790,0.004109,0.002899,0.002049,0.001440,0.001000,0.000690,0.000476,0.000332,0.000235,0.000166,0.000117,0.000083,0.000059,0.000042];
const CMF_Y = [0.000039,0.000064,0.000120,0.000217,0.000396,0.000640,0.001210,0.002180,0.004000,0.007300,0.011600,0.016840,0.023000,0.029800,0.038000,0.048000,0.060000,0.073900,0.090980,0.112600,0.139020,0.169300,0.208020,0.258600,0.323000,0.407300,0.503000,0.608200,0.710000,0.793200,0.862000,0.914850,0.954000,0.980300,0.994950,1.000000,0.995000,0.978600,0.952000,0.915400,0.870000,0.816300,0.757000,0.694900,0.631000,0.566800,0.503000,0.441200,0.381000,0.321000,0.265000,0.217000,0.175000,0.138200,0.107000,0.081600,0.061000,0.044580,0.032000,0.023200,0.017000,0.011920,0.008210,0.005723,0.004102,0.002929,0.002091,0.001484,0.001047,0.000740,0.000520,0.000361,0.000249,0.000172,0.000120,0.000085,0.000060,0.000042,0.000030,0.000021,0.000015];
const CMF_Z = [0.006450,0.010550,0.020050,0.036210,0.067850,0.110200,0.207400,0.371300,0.645600,1.039050,1.385600,1.622960,1.747060,1.782600,1.772110,1.744100,1.669200,1.528100,1.287640,1.041900,0.812950,0.616200,0.465180,0.353300,0.272000,0.212300,0.158200,0.111700,0.078250,0.057250,0.042160,0.029840,0.020300,0.013400,0.008750,0.005750,0.003900,0.002750,0.002100,0.001800,0.001650,0.001400,0.001100,0.001000,0.000800,0.000600,0.000340,0.000240,0.000190,0.000100,0.000050,0.000030,0.000020,0.000010,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000];

// Robertson (1968) isotherm table -- [mired, u, v, slope] -- used for the
// closed-form CCT seed that the Ohno hires search below then refines.
const ROBERTSON: [number, number, number, number][] = [
  [0,0.18006,0.26352,-0.24341],[10,0.18066,0.26589,-0.25479],[20,0.18133,0.26846,-0.26876],[30,0.18208,0.27119,-0.28539],
  [40,0.18293,0.27407,-0.30470],[50,0.18388,0.27709,-0.32675],[60,0.18494,0.28021,-0.35156],[70,0.18611,0.28342,-0.37915],
  [80,0.18740,0.28668,-0.40955],[90,0.18880,0.28997,-0.44278],[100,0.19032,0.29326,-0.47888],[125,0.19462,0.30141,-0.58204],
  [150,0.19962,0.30921,-0.70471],[175,0.20525,0.31647,-0.84901],[200,0.21142,0.32312,-1.0182],[225,0.21807,0.32909,-1.2168],
  [250,0.22511,0.33439,-1.4512],[275,0.23247,0.33904,-1.7298],[300,0.24010,0.34308,-2.0637],[325,0.24792,0.34655,-2.4681],
  [350,0.25591,0.34951,-2.9641],[375,0.26400,0.35200,-3.5814],[400,0.27218,0.35407,-4.3633],[425,0.28039,0.35577,-5.3762],
  [450,0.28863,0.35714,-6.7262],[475,0.29685,0.35823,-8.5955],[500,0.30505,0.35907,-11.324],[525,0.31320,0.35968,-15.628],
  [550,0.32129,0.36011,-23.325],[575,0.32931,0.36038,-40.770],[600,0.33724,0.36051,-116.45],
];

// CIE 13.3-1995 TCS test-color-sample reflectances (R1-R9, plus the R10-R15
// "special" samples), 5nm steps 380-780nm, 81 values each -- verbatim.
const TCS_5NM: Record<number, number[]> = {
  1: [0.2190,0.2390,0.2520,0.2560,0.2560,0.2540,0.2520,0.2480,0.2440,0.2400,0.2370,0.2320,0.2300,0.2260,0.2250,0.2220,0.2200,0.2180,0.2160,0.2140,0.2140,0.2140,0.2160,0.2180,0.2230,0.2250,0.2260,0.2260,0.2250,0.2250,0.2270,0.2300,0.2360,0.2450,0.2530,0.2620,0.2720,0.2830,0.2980,0.3180,0.3410,0.3670,0.3900,0.4090,0.4240,0.4350,0.4420,0.4480,0.4500,0.4510,0.4510,0.4510,0.4510,0.4510,0.4500,0.4500,0.4510,0.4510,0.4530,0.4540,0.4550,0.4570,0.4580,0.4600,0.4620,0.4630,0.4640,0.4650,0.4660,0.4660,0.4660,0.4660,0.4670,0.4670,0.4670,0.4670,0.4670,0.4670,0.4670,0.4670,0.4670],
  2: [0.0700,0.0790,0.0890,0.1010,0.1110,0.1160,0.1180,0.1200,0.1210,0.1220,0.1220,0.1220,0.1230,0.1240,0.1270,0.1280,0.1310,0.1340,0.1380,0.1430,0.1500,0.1590,0.1740,0.1900,0.2070,0.2250,0.2420,0.2530,0.2600,0.2640,0.2670,0.2690,0.2720,0.2760,0.2820,0.2890,0.2990,0.3090,0.3220,0.3290,0.3350,0.3390,0.3410,0.3410,0.3420,0.3420,0.3420,0.3410,0.3410,0.3390,0.3390,0.3380,0.3380,0.3370,0.3360,0.3350,0.3340,0.3320,0.3320,0.3310,0.3310,0.3300,0.3290,0.3280,0.3280,0.3270,0.3260,0.3250,0.3240,0.3240,0.3240,0.3230,0.3220,0.3210,0.3200,0.3180,0.3160,0.3150,0.3150,0.3140,0.3140],
  3: [0.0650,0.0680,0.0700,0.0720,0.0730,0.0730,0.0740,0.0740,0.0740,0.0730,0.0730,0.0730,0.0730,0.0730,0.0740,0.0750,0.0770,0.0800,0.0850,0.0940,0.1090,0.1260,0.1480,0.1720,0.1980,0.2210,0.2410,0.2600,0.2780,0.3020,0.3390,0.3700,0.3920,0.3990,0.4000,0.3930,0.3800,0.3650,0.3490,0.3320,0.3150,0.2990,0.2850,0.2720,0.2640,0.2570,0.2520,0.2470,0.2410,0.2350,0.2290,0.2240,0.2200,0.2170,0.2160,0.2160,0.2190,0.2240,0.2300,0.2380,0.2510,0.2690,0.2880,0.3120,0.3400,0.3660,0.3900,0.4120,0.4310,0.4470,0.4600,0.4720,0.4810,0.4880,0.4930,0.4970,0.5000,0.5020,0.5050,0.5100,0.5160],
  4: [0.0740,0.0830,0.0930,0.1050,0.1160,0.1210,0.1240,0.1260,0.1280,0.1310,0.1350,0.1390,0.1440,0.1510,0.1610,0.1720,0.1860,0.2050,0.2290,0.2540,0.2810,0.3080,0.3320,0.3520,0.3700,0.3830,0.3900,0.3940,0.3950,0.3920,0.3850,0.3770,0.3670,0.3540,0.3410,0.3270,0.3120,0.2960,0.2800,0.2630,0.2470,0.2290,0.2140,0.1980,0.1850,0.1750,0.1690,0.1640,0.1600,0.1560,0.1540,0.1520,0.1510,0.1490,0.1480,0.1480,0.1480,0.1490,0.1510,0.1540,0.1580,0.1620,0.1650,0.1680,0.1700,0.1710,0.1700,0.1680,0.1660,0.1640,0.1640,0.1650,0.1680,0.1720,0.1770,0.1810,0.1850,0.1890,0.1920,0.1940,0.1970],
  5: [0.2950,0.3060,0.3100,0.3120,0.3130,0.3150,0.3190,0.3220,0.3260,0.3300,0.3340,0.3390,0.3460,0.3520,0.3600,0.3690,0.3810,0.3940,0.4030,0.4100,0.4150,0.4180,0.4190,0.4170,0.4130,0.4090,0.4030,0.3960,0.3890,0.3810,0.3720,0.3630,0.3530,0.3420,0.3310,0.3200,0.3080,0.2960,0.2840,0.2710,0.2600,0.2470,0.2320,0.2200,0.2100,0.2000,0.1940,0.1890,0.1850,0.1830,0.1800,0.1770,0.1760,0.1750,0.1750,0.1750,0.1750,0.1770,0.1800,0.1830,0.1860,0.1890,0.1920,0.1950,0.1990,0.2000,0.1990,0.1980,0.1960,0.1950,0.1950,0.1960,0.1970,0.2000,0.2030,0.2050,0.2080,0.2120,0.2150,0.2170,0.2190],
  6: [0.1510,0.2030,0.2650,0.3390,0.4100,0.4640,0.4920,0.5080,0.5170,0.5240,0.5310,0.5380,0.5440,0.5510,0.5560,0.5560,0.5540,0.5490,0.5410,0.5310,0.5190,0.5040,0.4880,0.4690,0.4500,0.4310,0.4140,0.3950,0.3770,0.3580,0.3410,0.3250,0.3090,0.2930,0.2790,0.2650,0.2530,0.2410,0.2340,0.2270,0.2250,0.2220,0.2210,0.2200,0.2200,0.2200,0.2200,0.2200,0.2230,0.2270,0.2330,0.2390,0.2440,0.2510,0.2580,0.2630,0.2680,0.2730,0.2780,0.2810,0.2830,0.2860,0.2910,0.2960,0.3020,0.3130,0.3250,0.3380,0.3510,0.3640,0.3760,0.3890,0.4010,0.4130,0.4250,0.4360,0.4470,0.4580,0.4690,0.4770,0.4850],
  7: [0.3780,0.4590,0.5240,0.5460,0.5510,0.5550,0.5590,0.5600,0.5610,0.5580,0.5560,0.5510,0.5440,0.5350,0.5220,0.5060,0.4880,0.4690,0.4480,0.4290,0.4080,0.3850,0.3630,0.3410,0.3240,0.3110,0.3010,0.2910,0.2830,0.2730,0.2650,0.2600,0.2570,0.2570,0.2590,0.2600,0.2600,0.2580,0.2560,0.2540,0.2540,0.2590,0.2700,0.2840,0.3020,0.3240,0.3440,0.3620,0.3770,0.3890,0.4000,0.4100,0.4200,0.4290,0.4380,0.4450,0.4520,0.4570,0.4620,0.4660,0.4680,0.4700,0.4730,0.4770,0.4830,0.4890,0.4960,0.5030,0.5110,0.5180,0.5250,0.5320,0.5390,0.5460,0.5530,0.5590,0.5650,0.5700,0.5750,0.5780,0.5810],
  8: [0.1040,0.1290,0.1700,0.2400,0.3190,0.4160,0.4620,0.4820,0.4900,0.4880,0.4820,0.4730,0.4620,0.4500,0.4390,0.4260,0.4130,0.3970,0.3820,0.3660,0.3520,0.3370,0.3250,0.3100,0.2990,0.2890,0.2830,0.2760,0.2700,0.2620,0.2560,0.2510,0.2500,0.2510,0.2540,0.2580,0.2640,0.2690,0.2720,0.2740,0.2780,0.2840,0.2950,0.3160,0.3480,0.3840,0.4340,0.4820,0.5280,0.5680,0.6040,0.6290,0.6480,0.6630,0.6760,0.6850,0.6930,0.7000,0.7050,0.7090,0.7120,0.7150,0.7170,0.7190,0.7210,0.7200,0.7190,0.7220,0.7250,0.7270,0.7290,0.7300,0.7300,0.7300,0.7300,0.7300,0.7300,0.7300,0.7300,0.7300,0.7300],
  9: [0.0660,0.0620,0.0580,0.0550,0.0520,0.0520,0.0510,0.0500,0.0500,0.0490,0.0480,0.0470,0.0460,0.0440,0.0420,0.0410,0.0380,0.0350,0.0330,0.0310,0.0300,0.0290,0.0280,0.0280,0.0280,0.0290,0.0300,0.0300,0.0310,0.0310,0.0320,0.0320,0.0330,0.0340,0.0350,0.0370,0.0410,0.0440,0.0480,0.0520,0.0600,0.0760,0.1020,0.1360,0.1900,0.2560,0.3360,0.4180,0.5050,0.5810,0.6410,0.6820,0.7170,0.7400,0.7580,0.7700,0.7810,0.7900,0.7970,0.8030,0.8090,0.8140,0.8190,0.8240,0.8280,0.8300,0.8310,0.8330,0.8350,0.8360,0.8360,0.8370,0.8380,0.8390,0.8390,0.8390,0.8390,0.8390,0.8390,0.8390,0.8390],
  10: [0.1840,0.1840,0.1840,0.1840,0.1840,0.1840,0.1840,0.1840,0.1840,0.1840,0.1840,0.1840,0.1840,0.1840,0.1840,0.1840,0.1840,0.1840,0.1840,0.1840,0.2000,0.2140,0.3140,0.4560,0.5790,0.6580,0.7130,0.7570,0.7870,0.8100,0.8280,0.8450,0.8580,0.8680,0.8760,0.8840,0.8910,0.8970,0.9010,0.9040,0.9060,0.9080,0.9090,0.9100,0.9110,0.9110,0.9110,0.9120,0.9120,0.9120,0.9120,0.9120,0.9110,0.9100,0.9100,0.9090,0.9090,0.9090,0.9080,0.9070,0.9070,0.9060,0.9060,0.9050,0.9050,0.9050,0.9040,0.9040,0.9030,0.9030,0.9030,0.9020,0.9020,0.9020,0.9010,0.9010,0.9010,0.9010,0.9010,0.9000,0.9000],
  11: [0.0710,0.0710,0.0710,0.0710,0.0720,0.0720,0.0720,0.0720,0.0720,0.0720,0.0720,0.0720,0.0720,0.0710,0.0710,0.0710,0.0700,0.0700,0.0690,0.0680,0.0680,0.0670,0.0660,0.0650,0.0640,0.0650,0.0680,0.0720,0.0790,0.0900,0.1080,0.1370,0.1820,0.2490,0.3360,0.4320,0.5180,0.5800,0.6230,0.6530,0.6770,0.6970,0.7130,0.7260,0.7380,0.7470,0.7540,0.7590,0.7620,0.7640,0.7660,0.7680,0.7700,0.7710,0.7720,0.7720,0.7720,0.7720,0.7720,0.7720,0.7720,0.7720,0.7720,0.7720,0.7720,0.7720,0.7720,0.7720,0.7720,0.7720,0.7720,0.7720,0.7710,0.7710,0.7710,0.7710,0.7710,0.7710,0.7700,0.7700,0.7700],
  12: [0.1200,0.1030,0.0900,0.0820,0.0760,0.0680,0.0640,0.0650,0.0750,0.0930,0.1230,0.1600,0.2070,0.2560,0.3000,0.3310,0.3460,0.3470,0.3410,0.3280,0.3070,0.2820,0.2570,0.2300,0.2040,0.1780,0.1540,0.1290,0.1090,0.0900,0.0750,0.0620,0.0510,0.0410,0.0350,0.0290,0.0250,0.0220,0.0190,0.0170,0.0170,0.0170,0.0160,0.0160,0.0160,0.0160,0.0160,0.0160,0.0160,0.0160,0.0180,0.0180,0.0180,0.0180,0.0190,0.0200,0.0230,0.0240,0.0260,0.0300,0.0350,0.0430,0.0560,0.0740,0.0970,0.1280,0.1660,0.2100,0.2570,0.3050,0.3540,0.4010,0.4460,0.4850,0.5200,0.5510,0.5770,0.5990,0.6180,0.6330,0.6450],
  13: [0.0500,0.0510,0.0510,0.0520,0.0530,0.0540,0.0560,0.0570,0.0590,0.0600,0.0620,0.0630,0.0650,0.0660,0.0680,0.0690,0.0710,0.0730,0.0760,0.0790,0.0840,0.0900,0.0980,0.1090,0.1230,0.1390,0.1570,0.1760,0.1960,0.2160,0.2350,0.2510,0.2660,0.2790,0.2900,0.2990,0.3070,0.3140,0.3200,0.3250,0.3290,0.3330,0.3360,0.3390,0.3410,0.3430,0.3450,0.3450,0.3460,0.3460,0.3470,0.3470,0.3470,0.3470,0.3470,0.3470,0.3470,0.3470,0.3470,0.3470,0.3470,0.3470,0.3470,0.3480,0.3480,0.3490,0.3500,0.3510,0.3520,0.3530,0.3540,0.3550,0.3560,0.3570,0.3580,0.3590,0.3600,0.3610,0.3620,0.3630,0.3640],
  14: [0.0600,0.0600,0.0600,0.0600,0.0600,0.0600,0.0600,0.0600,0.0600,0.0600,0.0600,0.0600,0.0600,0.0600,0.0600,0.0600,0.0600,0.0610,0.0620,0.0640,0.0680,0.0730,0.0820,0.1000,0.1340,0.1800,0.2360,0.2910,0.3380,0.3740,0.3990,0.4180,0.4320,0.4460,0.4580,0.4690,0.4790,0.4880,0.4950,0.5000,0.5030,0.5050,0.5060,0.5060,0.5060,0.5050,0.5040,0.5030,0.5010,0.4990,0.4970,0.4950,0.4930,0.4900,0.4880,0.4860,0.4830,0.4810,0.4780,0.4760,0.4740,0.4710,0.4690,0.4670,0.4650,0.4630,0.4610,0.4590,0.4580,0.4560,0.4550,0.4540,0.4520,0.4510,0.4500,0.4490,0.4480,0.4470,0.4460,0.4460,0.4450],
  15: [0.0760,0.0800,0.0840,0.0900,0.0980,0.1070,0.1170,0.1290,0.1440,0.1610,0.1800,0.2000,0.2200,0.2380,0.2560,0.2710,0.2860,0.2980,0.3090,0.3190,0.3280,0.3360,0.3420,0.3470,0.3510,0.3540,0.3560,0.3580,0.3590,0.3600,0.3600,0.3600,0.3600,0.3590,0.3590,0.3580,0.3580,0.3570,0.3570,0.3560,0.3560,0.3550,0.3540,0.3540,0.3530,0.3520,0.3520,0.3510,0.3500,0.3500,0.3490,0.3490,0.3480,0.3480,0.3470,0.3470,0.3460,0.3460,0.3450,0.3450,0.3440,0.3440,0.3430,0.3430,0.3420,0.3420,0.3410,0.3410,0.3400,0.3400,0.3390,0.3390,0.3380,0.3380,0.3370,0.3370,0.3360,0.3360,0.3350,0.3350,0.3340],
};

// CIE daylight S0/S1/S2 basis functions, 10nm steps, 300-830nm (54 values
// each) -- used to reconstruct a D-series illuminant SPD from its CCT.
const DAYLIGHT_S0 = [0.04,6.0,29.6,55.3,57.3,61.8,61.5,68.8,63.4,65.8,94.8,104.8,105.9,96.8,113.9,125.6,125.5,121.3,121.3,113.5,113.1,110.8,106.5,108.8,105.3,104.4,100.0,96.0,95.1,89.1,90.5,90.3,88.4,84.0,85.1,81.9,82.6,84.9,81.3,71.9,74.3,76.4,63.3,71.7,77.0,65.2,47.7,68.6,65.0,66.0,61.0,53.3,58.9,61.9];
const DAYLIGHT_S1 = [0.02,4.5,22.4,42.0,40.6,41.6,38.0,42.4,38.5,35.0,43.4,46.3,43.9,37.1,36.7,35.9,32.6,27.9,24.3,20.1,16.2,13.2,8.6,6.1,4.2,1.9,0.0,-1.6,-3.5,-3.5,-5.8,-7.2,-8.6,-9.5,-10.9,-10.7,-12.0,-14.0,-13.6,-12.0,-13.3,-12.9,-10.6,-11.6,-12.2,-10.2,-7.8,-11.2,-10.4,-10.6,-9.7,-8.3,-9.3,-9.8];
const DAYLIGHT_S2 = [0.0,2.0,4.0,8.5,7.8,6.7,5.3,6.1,2.0,1.2,-1.1,-0.5,-0.7,-1.2,-2.6,-2.9,-2.8,-2.6,-2.6,-1.8,-1.5,-1.3,-1.2,-1.0,-0.5,-0.3,0.0,0.2,0.5,2.1,3.2,4.1,4.7,5.1,6.7,7.3,8.6,9.8,10.2,8.3,9.6,8.5,7.0,7.6,8.0,6.7,5.2,7.4,6.8,7.0,6.4,5.5,6.1,6.5];

interface UV { u: number; v: number; }
interface XYZ { X: number; Y: number; Z: number; }

/** Linear interpolation of a 5nm-step, 380-780nm table (81 values), flat-clamped past either end -- matches spd.php's inline `$ip` helper used for both the CMF and TCS 1nm upsampling. */
function interp5(table: number[], w: number): number {
  if (w <= 380) return table[0];
  if (w >= 780) return table[80];
  const x = (w - 380) / 5.0;
  const k = Math.floor(x);
  const q = x - k;
  return table[k] * (1 - q) + table[k + 1] * q;
}

let cmf1nmCache: { X: number[]; Y: number[]; Z: number[] } | null = null;
/** CIE 1931 2-degree CMFs upsampled from the 5nm table to 1nm, 380-780nm (401 points) -- matches spd.php's _cmf1nm(). */
function cmf1nm(): { X: number[]; Y: number[]; Z: number[] } {
  if (cmf1nmCache) return cmf1nmCache;
  const X: number[] = [];
  const Y: number[] = [];
  const Z: number[] = [];
  for (let w = 380; w <= 780; w++) {
    X.push(interp5(CMF_X, w));
    Y.push(interp5(CMF_Y, w));
    Z.push(interp5(CMF_Z, w));
  }
  cmf1nmCache = { X, Y, Z };
  return cmf1nmCache;
}

let tcs1nmCache: Record<number, number[]> | null = null;
/** All 15 TCS reflectance curves upsampled from 5nm to 1nm -- matches spd.php's _tcs1nm(). */
function tcs1nm(): Record<number, number[]> {
  if (tcs1nmCache) return tcs1nmCache;
  const out: Record<number, number[]> = {};
  for (const key of Object.keys(TCS_5NM)) {
    const arr5 = TCS_5NM[Number(key)];
    const arr1: number[] = [];
    for (let i = 0; i < 401; i++) arr1.push(interp5(arr5, 380 + i));
    out[Number(key)] = arr1;
  }
  tcs1nmCache = out;
  return tcs1nmCache;
}

/**
 * Linear interpolation of the *measured* spectrum (arbitrary wavelength
 * spacing -- in practice ~1nm here, but this doesn't assume that) at a
 * given wavelength, flat-clamped past either end of the real data. Matches
 * spd.php's _spd_interp_at().
 */
function spdInterpAt(wls: number[], vals: number[], w: number): number {
  const n = wls.length;
  if (n === 0) return 0;
  if (w <= wls[0]) return vals[0];
  if (w >= wls[n - 1]) return vals[n - 1];
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const m = Math.floor((lo + hi) / 2);
    if (wls[m] <= w) lo = m;
    else hi = m;
  }
  const dx = wls[hi] - wls[lo];
  if (dx === 0) return vals[lo];
  const t = (w - wls[lo]) / dx;
  return vals[lo] * (1 - t) + vals[hi] * t;
}

function xyToUv(x: number, y: number): UV {
  const d = -2 * x + 12 * y + 3;
  return { u: (4 * x) / d, v: (6 * y) / d };
}

/** Robertson-table CCT from (x, y) -- matches spd.php's calc_cct(). Used only as the seed the Ohno hires search below refines; not the final reported value. */
function calcCct(x: number, y: number): number {
  const { u, v } = xyToUv(x, y);
  for (let i = 1; i < ROBERTSON.length; i++) {
    const di = (v - ROBERTSON[i][2]) - ROBERTSON[i][3] * (u - ROBERTSON[i][1]);
    const pi = (v - ROBERTSON[i - 1][2]) - ROBERTSON[i - 1][3] * (u - ROBERTSON[i - 1][1]);
    if (pi * di <= 0 || i === ROBERTSON.length - 1) {
      const f = pi / (pi - di);
      return 1e6 / (ROBERTSON[i - 1][0] + f * (ROBERTSON[i][0] - ROBERTSON[i - 1][0]));
    }
  }
  return 6504.0;
}

/** x/y chromaticity integrated at 1nm resolution against the real (interpolated) spectrum -- matches spd.php's _xy_hires(). */
function xyHires(wls: number[], vals: number[]): { x: number; y: number } {
  const cm = cmf1nm();
  let X = 0, Y = 0, Z = 0;
  for (let i = 0; i < 401; i++) {
    const w = 380 + i;
    const val = spdInterpAt(wls, vals, w);
    X += val * cm.X[i];
    Y += val * cm.Y[i];
    Z += val * cm.Z[i];
  }
  const s = X + Y + Z;
  if (s <= 0) return { x: 0.3333, y: 0.3333 };
  return { x: X / s, y: Y / s };
}

/** Planck's law evaluated directly at 1nm (no lookup table) and integrated against the CMFs to get the blackbody locus's u/v at temperature T -- matches spd.php's _planck_uv_hires(). */
function planckUvHires(Tk: number): UV {
  const cm = cmf1nm();
  const h = 6.626e-34, c = 3e8, k = 1.381e-23;
  let X = 0, Y = 0, Z = 0;
  for (let i = 0; i < 401; i++) {
    const m = (380 + i) * 1e-9;
    const val = (2 * h * c * c / m ** 5) / (Math.exp(h * c / (m * k * Tk)) - 1);
    X += val * cm.X[i];
    Y += val * cm.Y[i];
    Z += val * cm.Z[i];
  }
  const s = X + Y + Z;
  const x = X / s, y = Y / s;
  const d = -2 * x + 12 * y + 3;
  return { u: (4 * x) / d, v: (6 * y) / d };
}

/**
 * Ohno-style CCT/Duv: seeds from the closed-form Robertson CCT, then does a
 * coarse-then-fine search over the *spectrally-integrated* Planckian locus
 * (not a closed-form xy approximation of it) for the true nearest point in
 * CIE 1960 u/v space. Matches spd.php's calc_cct_duv_hires() exactly,
 * including its search step sizes and windows.
 */
function calcCctDuvHires(wls: number[], vals: number[]): { x: number; y: number; cct: number; duv: number } {
  const xy = xyHires(wls, vals);
  const { x, y } = xy;
  const d = -2 * x + 12 * y + 3;
  const u = (4 * x) / d;
  const v = (6 * y) / d;

  let seed = calcCct(x, y);
  seed = Math.max(1100.0, Math.min(24000.0, seed));
  let bestT = seed;
  let bestD2 = Infinity;

  for (let T = Math.max(1000.0, seed - 400.0); T <= Math.min(25000.0, seed + 400.0); T += 10.0) {
    const pp = planckUvHires(T);
    const dd = (u - pp.u) ** 2 + (v - pp.v) ** 2;
    if (dd < bestD2) { bestD2 = dd; bestT = T; }
  }

  const lo = Math.max(1000.0, bestT - 12.0);
  const hi = Math.min(25000.0, bestT + 12.0);
  for (let T = lo; T <= hi; T += 0.1) {
    const pp = planckUvHires(T);
    const dd = (u - pp.u) ** 2 + (v - pp.v) ** 2;
    if (dd < bestD2) { bestD2 = dd; bestT = T; }
  }

  const pp = planckUvHires(bestT);
  let duv = Math.sqrt(bestD2);
  if (v - pp.v < 0) duv = -duv;

  return { x, y, cct: bestT, duv };
}

function blackbody1nm(T: number): number[] {
  const h = 6.626e-34, c = 3e8, k = 1.381e-23;
  const out: number[] = [];
  for (let i = 0; i < 401; i++) {
    const m = (380 + i) * 1e-9;
    out.push((2 * h * c * c / m ** 5) / (Math.exp(h * c / (m * k * T)) - 1));
  }
  return out;
}

/** CIE daylight (D-series) illuminant reconstructed from CCT (S0+M1*S1+M2*S2), at 1nm 380-780nm -- matches spd.php's _daylight1nm(). Used as the CRI reference illuminant for CCT >= 5000K (blackbody is used below that). */
function daylight1nm(cct: number): number[] {
  const T = Math.max(4000.0, Math.min(25000.0, cct));
  const xD = T <= 7000.0
    ? -4.6070e9 / (T * T * T) + 2.9678e6 / (T * T) + 0.09911e3 / T + 0.244063
    : -2.0064e9 / (T * T * T) + 1.9018e6 / (T * T) + 0.24748e3 / T + 0.237040;
  const yD = -3.000 * xD * xD + 2.870 * xD - 0.275;
  const M = 0.0241 + 0.2562 * xD - 0.7341 * yD;
  const M1 = (-1.3515 - 1.7703 * xD + 5.9114 * yD) / M;
  const M2 = (0.0300 - 31.4424 * xD + 30.0717 * yD) / M;

  const out: number[] = [];
  for (let i = 0; i < 401; i++) {
    const w = 380 + i;
    const idx = (w - 300) / 10.0;
    let j = Math.floor(idx);
    let f = idx - j;
    if (j < 0) { j = 0; f = 0; }
    if (j >= 53) { j = 52; f = 1; }
    out.push(
      (DAYLIGHT_S0[j] + f * (DAYLIGHT_S0[j + 1] - DAYLIGHT_S0[j])) +
      M1 * (DAYLIGHT_S1[j] + f * (DAYLIGHT_S1[j + 1] - DAYLIGHT_S1[j])) +
      M2 * (DAYLIGHT_S2[j] + f * (DAYLIGHT_S2[j + 1] - DAYLIGHT_S2[j]))
    );
  }
  return out;
}

/** XYZ -> CIE 1960 u/v, with the standard CRI fallback for a degenerate (all-zero) input -- matches spd.php's cri_xyz_to_uv(). */
function criXyzToUv(xyz: XYZ): UV {
  const d = xyz.X + 15 * xyz.Y + 3 * xyz.Z;
  if (d === 0) return { u: 0.2009, v: 0.3220 };
  return { u: (4 * xyz.X) / d, v: (6 * xyz.Y) / d };
}

/**
 * Full CIE 13.3 Ra/R9/Ri calculation at 1nm resolution: reference
 * illuminant (blackbody below 5000K, reconstructed daylight at/above),
 * Von Kries chromatic adaptation in CIE 1960 UCS, CIE 1964 W*U*V* color
 * difference per TCS sample, Ri = 100 - 4.6*dE, Ra = mean(R1..R8). Matches
 * spd.php's calc_cri_hires() exactly.
 */
function calcCriHires(wls: number[], vals: number[], cct: number): { ra: number; r9: number; ri: number[] } {
  const cm = cmf1nm();
  const xyzOf = (v: number[]): XYZ => {
    let X = 0, Y = 0, Z = 0;
    for (let i = 0; i < 401; i++) {
      X += v[i] * cm.X[i];
      Y += v[i] * cm.Y[i];
      Z += v[i] * cm.Z[i];
    }
    return { X, Y, Z };
  };

  const test: number[] = [];
  for (let i = 0; i < 401; i++) test.push(spdInterpAt(wls, vals, 380 + i));

  const Tref = Math.max(1667.0, Math.min(25000.0, cct));
  let ref = Tref >= 5000.0 ? daylight1nm(Tref) : blackbody1nm(Tref);
  const rMax = Math.max(...ref);
  if (rMax > 0) ref = ref.map((v) => v / rMax);

  const TCS = tcs1nm();

  const tW = xyzOf(test);
  const rW = xyzOf(ref);
  const tUV = criXyzToUv(tW);
  const rUV = criXyzToUv(rW);
  const u_t = tUV.u, v_t = tUV.v, u_r = rUV.u, v_r = rUV.v;
  const k_t = tW.Y > 0 ? 100.0 / tW.Y : 1.0;
  const k_r = rW.Y > 0 ? 100.0 / rW.Y : 1.0;

  const c_t = v_t > 0 ? (4.0 - u_t - 10.0 * v_t) / v_t : 0.0;
  const d_t = v_t > 0 ? (1.708 * v_t + 0.404 - 1.481 * u_t) / v_t : 0.0;
  const c_r = v_r > 0 ? (4.0 - u_r - 10.0 * v_r) / v_r : 0.0;
  const d_r = v_r > 0 ? (1.708 * v_r + 0.404 - 1.481 * u_r) / v_r : 0.0;

  const Ri: Record<number, number> = {};

  for (let tcs = 1; tcs <= 15; tcs++) {
    const refl = TCS[tcs];
    const tRefl = refl.map((r, i) => r * test[i]);
    const rRefl = refl.map((r, i) => r * ref[i]);
    const tXYZ = xyzOf(tRefl);
    const rXYZ = xyzOf(rRefl);

    const tY = tXYZ.Y * k_t;
    const rY = rXYZ.Y * k_r;

    const tcsUV = criXyzToUv(tXYZ);
    const u_tcs = tcsUV.u, v_tcs = tcsUV.v;
    const c_tcs = v_tcs > 0 ? (4.0 - u_tcs - 10.0 * v_tcs) / v_tcs : 0.0;
    const d_tcs = v_tcs > 0 ? (1.708 * v_tcs + 0.404 - 1.481 * u_tcs) / v_tcs : 0.0;

    const denom = 16.518 + 1.481 * (c_r / c_t) * c_tcs - (d_r / d_t) * d_tcs;
    let u_a: number, v_a: number;
    if (Math.abs(denom) < 1e-10) {
      u_a = u_tcs; v_a = v_tcs;
    } else {
      u_a = (10.872 + 0.404 * (c_r / c_t) * c_tcs - 4.0 * (d_r / d_t) * d_tcs) / denom;
      v_a = 5.52 / denom;
    }

    const W_t = 25.0 * Math.pow(Math.max(0.001, tY), 1.0 / 3.0) - 17.0;
    const U_t = 13.0 * W_t * (u_a - u_r);
    const V_t = 13.0 * W_t * (v_a - v_r);

    const rcsUV = criXyzToUv(rXYZ);
    const W_r = 25.0 * Math.pow(Math.max(0.001, rY), 1.0 / 3.0) - 17.0;
    const U_r = 13.0 * W_r * (rcsUV.u - u_r);
    const V_r = 13.0 * W_r * (rcsUV.v - v_r);

    const dE = Math.sqrt((W_t - W_r) ** 2 + (U_t - U_r) ** 2 + (V_t - V_r) ** 2);
    Ri[tcs] = Math.round(100.0 - 4.6 * dE);
  }

  let sum = 0;
  for (let i = 1; i <= 8; i++) sum += Ri[i];
  const Ra = Math.round(sum / 8.0);

  const ri: number[] = [];
  for (let i = 1; i <= 15; i++) ri.push(Ri[i]);

  return { ra: Ra, r9: Ri[9], ri };
}

/**
 * The single entry point every tab should call: takes this reading's own
 * spectrum and returns x/y/CCT/Duv/Ra/R9/R1-R15, all computed the same way
 * hCRI.io itself computes them for the identical uploaded spectrum -- never
 * from the device's own onboard fields. Mirrors spd.php's analyze_spd(),
 * minus the instrument-override branches (this app never prefers the
 * instrument's own numbers) and minus Rf/Rg (not ported -- see file header).
 */
export function analyzeSpectrum(spectrum: { nm: number; value: number }[]): SpectralAnalysis {
  if (spectrum.length === 0) {
    return { x: 0.3333, y: 0.3333, cct: 0, duv: 0, ra: 0, r9: 0, ri: new Array(15).fill(0) };
  }

  const wls = spectrum.map((p) => p.nm);
  let vals = spectrum.map((p) => p.value);

  // hCRI.io normalizes the SPD to a 0-1 peak before any computation --
  // harmless for x/y/CCT/Duv (ratios only) but the CRI reference-illuminant
  // matching below assumes a comparable scale, so replicate it exactly.
  const maxVal = Math.max(...vals);
  if (maxVal > 0) vals = vals.map((v) => v / maxVal);

  const cd = calcCctDuvHires(wls, vals);
  const cri = calcCriHires(wls, vals, cd.cct);

  return { x: cd.x, y: cd.y, cct: cd.cct, duv: cd.duv, ra: cri.ra, r9: cri.r9, ri: cri.ri };
}
