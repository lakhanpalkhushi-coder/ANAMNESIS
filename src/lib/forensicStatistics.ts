/* =========================================================================
 * DETECTOR B — SIGNAL FORENSICS
 *
 * The measuring half of ANAMNESIS detection. Everything in this module is
 * arithmetic over the ingested pixels, computed in this browser, with no
 * network call and no model of any kind.
 *
 * WHY IT EXISTS
 *
 * imageForensics.ts already computed Error Level Analysis, sensor-noise
 * residual and Sobel edges — and then threw the numbers away, painting them
 * to a canvas for a human to eyeball. The manipulation verdict meanwhile
 * came from a number a language model wrote down. This module closes that
 * gap: the same physics, reduced to statistics, fused into the
 * manipulationConfidence the classifier actually consumes.
 *
 * WHAT IT IS NOT
 *
 * The thresholds below are provisional. They were chosen from the published
 * behaviour of each technique and from inspection, NOT fitted to a labelled
 * corpus. Until they are calibrated against known-authentic and
 * known-manipulated sets, every number this module produces is an indicator
 * and not a probability — which is why the classifier downstream still caps
 * confidence and still labels the whole layer a prototype.
 *
 * A statistic that cannot be computed is never zero. An image too small to
 * tile, a canvas that will not encode, a decode that fails — all return
 * `usable: false`, and the caller maps that to NOT_ASSESSED.
 * ========================================================================= */

import { computeELA } from './imageForensics';
import {
  ForensicStatistics,
  ManipulationIndicatorCategory,
  SignalComponent,
  SignalFindings,
} from '../types';

/* -------------------------------------------------------------------------
   Working resolution

   Every statistic here is scale-relative: block variance, noise floor and
   edge density all shift with resolution, so a 12 MP phone photo and a
   640px screenshot would land on different sides of a fixed threshold for
   no forensic reason. Normalising to a common longest edge makes one set of
   thresholds meaningful across both.

   1024 is the smallest edge that still leaves a 64x64 grid of 16px blocks —
   enough tiles for the outlier statistics to mean anything — while keeping
   the nine-pass JPEG ghost sweep inside about a second.

   The original bytes are untouched. The SHA-256, the EXIF and the Forensic
   Canvas all continue to read the file exactly as submitted.
   ------------------------------------------------------------------------- */
const WORKING_MAX_EDGE = 1024;

/** Below this the block grid is too coarse for the statistics to be honest. */
const MIN_WORKING_EDGE = 96;

/** Tile size for every block statistic. 16px spans two JPEG MCUs. */
const BLOCK = 16;

/** ELA re-save quality. Matches the Forensic Canvas, so the numbers and the
 *  picture an investigator sees describe the same measurement. */
const ELA_QUALITY = 0.75;

/** Qualities swept for the JPEG ghost curve. */
const GHOST_QUALITIES = [55, 60, 65, 70, 75, 80, 85, 90, 95];

/* -------------------------------------------------------------------------
   Thresholds — provisional, uncalibrated, documented.

   Each REPORT constant is the point at which an indicator is worth stating
   as a finding. The RAMP pairs start lower and saturate higher, so a
   marginal image contributes proportionally rather than all or nothing.
   ------------------------------------------------------------------------- */

/** Fraction of ELA blocks that are robust outliers. Clean single-compression
 *  images sit near 0.01-0.03; a pasted region lifts its own blocks clear of
 *  the median. */
const ELA_OUTLIER_REPORT = 0.08;
const ELA_OUTLIER_RAMP: [number, number] = [0.03, 0.15];

/** Spread of the per-block noise floor, relative to its median. One sensor
 *  at one ISO produces a broadly uniform floor; two composited sources do
 *  not. */
const NOISE_UNIFORMITY_REPORT = 0.62;
const NOISE_UNIFORMITY_RAMP: [number, number] = [0.35, 0.9];

/** Mean absolute Laplacian residual on a 0-255 scale. Camera capture retains
 *  a sensor grain floor; generative output and heavy denoising fall below
 *  it. Inverted ramp — lower is more suspicious.
 *
 *  Probed against synthetic frames: grain-bearing captures landed at 18-25,
 *  a grain-free render of the same scene at 1.71. The original 1.15 report
 *  threshold sat below even the grain-free case and could not have fired.
 *  These values separate those probes with margin, but they were set from
 *  generated images rather than from a labelled corpus of real photographs
 *  and real generative output — they are a starting point for calibration,
 *  not a calibrated result. */
const NOISE_FLOOR_REPORT = 2.5;
const NOISE_FLOOR_RAMP: [number, number] = [6.0, 1.0];

/** Quantisation points in the ghost curve beyond the first. */
const GHOST_GENERATION_RAMP: [number, number] = [0, 3];

/* SEAM PROMINENCE IS MEASURED BUT DOES NOT SCORE.
 *
 * It was built to catch rectangular pastes and screen-recording borders, and
 * it does. It also cannot tell them from a window frame. Probed against a
 * clean scene containing one ordinary hard-edged rectangle it saturated at
 * 1.0 and produced a "composite boundary" mutation on an unedited image,
 * carrying 12 points of manipulation confidence with it — while the same
 * scene without the rectangle scored 0. Raising the sigma band did not
 * separate the two cases, because a real architectural edge is genuinely as
 * sharp as a paste boundary.
 *
 * A false composite finding on an authentic photograph is the most expensive
 * error this tool can make, so the measurement stays in ForensicStatistics
 * for an investigator to read against the Forensic Canvas, and contributes
 * neither a mutation nor a weight. Separating an optical edge from a pasted
 * one needs gradient-profile analysis across the ridge — how the transition
 * falls off, not merely how sharp it is — which this build does not do.
 */

/* Fusion weights, summing to 1.0. Ordered by how specific each signal is to
 * deliberate editing rather than to redistribution or to subject matter. */
const WEIGHTS = {
  splice: 0.34,
  noiseMismatch: 0.25,
  noiseFloor: 0.21,
  recompression: 0.2,
} as const;

/* -------------------------------------------------------------------------
   Numeric helpers
   ------------------------------------------------------------------------- */

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

/** Linear ramp from lo to hi, clamped to 0..1. Handles hi < lo (inverted). */
function ramp(value: number, [lo, hi]: [number, number]): number {
  if (hi === lo) return value >= hi ? 1 : 0;
  return clamp01((value - lo) / (hi - lo));
}

function median(values: number[] | Float32Array): number {
  const arr = Array.from(values).sort((a, b) => a - b);
  if (arr.length === 0) return 0;
  const mid = arr.length >> 1;
  return arr.length % 2 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
}

/** Median absolute deviation — a spread estimate that a few bright blocks
 *  cannot inflate, which is precisely how a standard deviation fails here. */
function medianAbsoluteDeviation(values: Float32Array, med: number): number {
  const deviations = new Float32Array(values.length);
  for (let i = 0; i < values.length; i++) deviations[i] = Math.abs(values[i] - med);
  return median(deviations);
}

function meanOf(values: Float32Array): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < values.length; i++) sum += values[i];
  return sum / values.length;
}

function varianceOf(values: Float32Array, mean: number): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    const d = values[i] - mean;
    sum += d * d;
  }
  return sum / values.length;
}

/* -------------------------------------------------------------------------
   Canvas plumbing
   ------------------------------------------------------------------------- */

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('The image could not be decoded for analysis.'));
    image.src = dataUrl;
  });
}

function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Cannot acquire a 2D context.');
  return ctx;
}

/** Scale the decoded image onto a canvas bounded by WORKING_MAX_EDGE. */
function buildWorkingCanvas(image: HTMLImageElement): HTMLCanvasElement {
  const srcW = image.naturalWidth || image.width;
  const srcH = image.naturalHeight || image.height;
  const longest = Math.max(srcW, srcH);
  const scale = longest > WORKING_MAX_EDGE ? WORKING_MAX_EDGE / longest : 1;

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(srcW * scale));
  canvas.height = Math.max(1, Math.round(srcH * scale));
  context2d(canvas).drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** Rec.601 luma plane. Every statistic below works on one channel: the
 *  chroma planes are subsampled by the codec and carry the weaker signal. */
function lumaPlane(data: Uint8ClampedArray, width: number, height: number): Float32Array {
  const luma = new Float32Array(width * height);
  for (let i = 0; i < luma.length; i++) {
    const p = i * 4;
    luma[i] = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
  }
  return luma;
}

/** Mean of each BLOCK x BLOCK tile. Partial tiles at the right and bottom
 *  edges are dropped rather than averaged over fewer pixels, which would
 *  give them a different noise scale to every other tile. */
function blockMeans(plane: Float32Array, width: number, height: number): Float32Array {
  const cols = Math.floor(width / BLOCK);
  const rows = Math.floor(height / BLOCK);
  const out = new Float32Array(Math.max(0, cols * rows));

  for (let by = 0; by < rows; by++) {
    for (let bx = 0; bx < cols; bx++) {
      let sum = 0;
      for (let y = 0; y < BLOCK; y++) {
        const rowStart = (by * BLOCK + y) * width + bx * BLOCK;
        for (let x = 0; x < BLOCK; x++) sum += plane[rowStart + x];
      }
      out[by * cols + bx] = sum / (BLOCK * BLOCK);
    }
  }
  return out;
}

/* -------------------------------------------------------------------------
   1. ELA block statistics — localised recompression inconsistency

   A region pasted in from another image has been through a different number
   of JPEG cycles than its surroundings, so it responds differently to one
   more. computeELA is reused at scaleMultiplier 1: the display path
   multiplies by 20 and clamps at 255, which saturates and destroys exactly
   the magnitudes being measured here.
   ------------------------------------------------------------------------- */
async function elaStatistics(
  working: HTMLCanvasElement
): Promise<{ blockVariance: number; outlierRatio: number }> {
  const ela = await computeELA(working, { quality: ELA_QUALITY, scaleMultiplier: 1 });
  const plane = lumaPlane(ela.data, working.width, working.height);
  const blocks = blockMeans(plane, working.width, working.height);
  if (blocks.length < 16) return { blockVariance: 0, outlierRatio: 0 };

  const med = median(blocks);
  const mad = medianAbsoluteDeviation(blocks, med);

  /* 1.4826 rescales a MAD to a standard-deviation equivalent for normally
   * distributed data. The floor keeps a near-flat error field — a synthetic
   * gradient, a blank scan — from turning every trivial fluctuation into an
   * outlier by dividing through an almost-zero spread. */
  const robustSigma = Math.max(1.4826 * mad, 0.5);
  const cutoff = 2 * robustSigma;

  /* TWO-SIDED, and this is the whole correctness of the measurement.
   *
   * A pasted region is not reliably noisier than its surroundings — very
   * often it is quieter. A patch that has already been through a heavier
   * compression than the frame around it is closer to its own quantisation
   * grid, so one more pass moves it LESS, not more.
   *
   * Measured on a controlled splice: the pasted region's mean block error
   * was 0.87 against 3.88 for the surrounding frame. A one-sided test for
   * high outliers found zero blocks; the two-sided test finds 163 of 1024,
   * against a paste occupying 13.7% of the frame. The signal was never
   * weak — it was on the other side of the median. */
  let outliers = 0;
  for (let i = 0; i < blocks.length; i++) {
    if (Math.abs(blocks[i] - med) > cutoff) outliers++;
  }

  const mean = meanOf(blocks);
  /* Normalised so the figure compares across images of different overall
   * error magnitude: a dark, heavily compressed photo carries a larger
   * absolute variance than a bright clean one without being less authentic. */
  const blockVariance = mean > 0 ? varianceOf(blocks, mean) / (mean * mean) : 0;

  return { blockVariance, outlierRatio: outliers / blocks.length };
}

/* -------------------------------------------------------------------------
   2. Noise residual statistics — the sensor floor and its uniformity

   A 3x3 Laplacian high-pass, unclamped. computeNoiseAnalysis applies a gain
   of 6 and clamps at 255 for visibility; the gain is harmless but the clamp
   would flatten the top of the distribution, and how the floor varies across
   the frame is the entire question here.
   ------------------------------------------------------------------------- */
function noiseStatistics(working: HTMLCanvasElement): {
  residualMean: number;
  uniformity: number;
} {
  const { width, height } = working;
  const data = context2d(working).getImageData(0, 0, width, height).data;
  const luma = lumaPlane(data, width, height);

  const residual = new Float32Array(width * height);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      residual[i] = Math.abs(
        4 * luma[i] - luma[i - width] - luma[i + width] - luma[i - 1] - luma[i + 1]
      );
    }
  }

  const residualMean = meanOf(residual);
  const blocks = blockMeans(residual, width, height);
  if (blocks.length < 16) return { residualMean, uniformity: 0 };

  /* A ratio, not a raw spread: a detailed scene has a higher noise floor
   * everywhere, and it is the difference between regions — not the absolute
   * level — that separates one sensor from two sources.
   *
   * Measured against the median, because one legitimately busy corner of an
   * otherwise flat frame drags a mean far further than it should. */
  const med = median(blocks);
  if (med <= 0.01) return { residualMean, uniformity: 0 };
  const mad = medianAbsoluteDeviation(blocks, med);
  return { residualMean, uniformity: (1.4826 * mad) / med };
}

/* -------------------------------------------------------------------------
   3. Seam statistics — straight composite boundaries

   A rectangular paste, a screen-recording border and a stitched panel all
   leave a full-width or full-height ridge of edge energy on one row or
   column. So does a door frame — so this signal is weak by construction. It
   is reported only at high prominence, carries the smallest fusion weight,
   and its wording asks for visual confirmation rather than asserting a cut.
   ------------------------------------------------------------------------- */
function seamStatistics(working: HTMLCanvasElement): number {
  const { width, height } = working;
  if (width < 8 || height < 8) return 0;

  const data = context2d(working).getImageData(0, 0, width, height).data;
  const luma = lumaPlane(data, width, height);

  const rowEnergy = new Float32Array(height);
  const colEnergy = new Float32Array(width);

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const gx =
        -luma[i - width - 1] +
        luma[i - width + 1] -
        2 * luma[i - 1] +
        2 * luma[i + 1] -
        luma[i + width - 1] +
        luma[i + width + 1];
      const gy =
        -luma[i - width - 1] -
        2 * luma[i - width] -
        luma[i - width + 1] +
        luma[i + width - 1] +
        2 * luma[i + width] +
        luma[i + width + 1];
      const mag = Math.sqrt(gx * gx + gy * gy);
      rowEnergy[y] += mag;
      colEnergy[x] += mag;
    }
  }

  return Math.max(ridgeProminence(rowEnergy, width), ridgeProminence(colEnergy, height));
}

/**
 * How far the single strongest line stands above its own neighbourhood, as a
 * 0..1 figure. A gradual scene has no ridge; a hard paste boundary is a
 * spike one pixel wide.
 */
function ridgeProminence(energy: Float32Array, span: number): number {
  if (energy.length < 8 || span <= 0) return 0;
  const normalised = new Float32Array(energy.length);
  for (let i = 0; i < energy.length; i++) normalised[i] = energy[i] / span;

  const med = median(normalised);
  const mad = medianAbsoluteDeviation(normalised, med);
  const robustSigma = Math.max(1.4826 * mad, 1e-3);

  let peak = 0;
  /* Interior only. The first and last rows of a Sobel pass are structurally
   * zero and would otherwise read as a ridge in the opposite direction. */
  for (let i = 2; i < normalised.length - 2; i++) {
    const local = Math.max(normalised[i - 2], normalised[i + 2]);
    const z = (normalised[i] - Math.max(local, med)) / robustSigma;
    if (z > peak) peak = z;
  }
  /* The band is deliberately high. Probed against a scene containing one
   * ordinary hard-edged rectangle — a window, a sign, a door frame — a 3
   * sigma floor saturated this metric at 1.0, which would have made every
   * photograph of a building report a composite boundary. 6 sigma clears
   * ordinary scene geometry; 20 is saturation. Even so this stays the
   * weakest signal here, at the smallest weight, worded as a prompt to look
   * rather than as a finding. */
  return clamp01((peak - 6) / 14);
}

/* -------------------------------------------------------------------------
   4. JPEG ghost curve — how many times this file has been compressed

   A simplified whole-image variant of Farid's JPEG ghost technique (2009).
   Re-encode at a sweep of qualities and measure the distance back to the
   image in hand. The curve falls as quality rises, but a quality the file
   has previously been saved at produces a local dip: the codec is
   reproducing a quantisation it has already applied.

   The second difference isolates those dips from the underlying trend. Each
   dip is a quantisation point in the file's history, which makes the count
   an ESTIMATE of generation depth — not a proven count, and reported as one.
   ------------------------------------------------------------------------- */
async function jpegGhostQualities(working: HTMLCanvasElement): Promise<number[]> {
  const { width, height } = working;
  const reference = lumaPlane(
    context2d(working).getImageData(0, 0, width, height).data,
    width,
    height
  );

  const probe = document.createElement('canvas');
  probe.width = width;
  probe.height = height;
  const probeCtx = context2d(probe);

  const errors: number[] = [];
  for (const quality of GHOST_QUALITIES) {
    const url = working.toDataURL('image/jpeg', quality / 100);
    const decoded = await loadImage(url);
    probeCtx.clearRect(0, 0, width, height);
    probeCtx.drawImage(decoded, 0, 0, width, height);
    const candidate = lumaPlane(probeCtx.getImageData(0, 0, width, height).data, width, height);

    let sum = 0;
    for (let i = 0; i < reference.length; i++) sum += Math.abs(reference[i] - candidate[i]);
    errors.push(sum / reference.length);
  }

  const range = Math.max(...errors) - Math.min(...errors);
  /* A curve with no dynamic range carries no history to read. A lossless
   * source re-encoded once produces a smooth monotone fall and lands here. */
  if (range < 1e-3) return [];

  /* Dip prominence as a fraction of the curve's own range, so the test does
   * not depend on the absolute error scale of the image. 4% is the point at
   * which single-compression curves stopped registering dips on the images
   * this was built against — provisional, and a calibration target. */
  const DIP_PROMINENCE = 0.04;

  const found: number[] = [];
  for (let i = 1; i < errors.length - 1; i++) {
    const trend = (errors[i - 1] + errors[i + 1]) / 2;
    if ((trend - errors[i]) / range > DIP_PROMINENCE) found.push(GHOST_QUALITIES[i]);
  }
  return found;
}

/* -------------------------------------------------------------------------
   Orchestration
   ------------------------------------------------------------------------- */

/**
 * Measure the submitted bytes.
 *
 * Never throws: a failure returns an unusable result carrying its reason,
 * and the caller maps that to NOT_ASSESSED. A detector that cannot run must
 * not be indistinguishable from a detector that found nothing.
 */
export async function computeForensicStatistics(dataUrl: string): Promise<ForensicStatistics> {
  const unusable = (reason: string): ForensicStatistics => ({
    usable: false,
    unusableReason: reason,
    workingWidth: 0,
    workingHeight: 0,
    elaBlockVariance: 0,
    elaOutlierBlockRatio: 0,
    noiseResidualMean: 0,
    noiseUniformity: 0,
    jpegGhostQualities: [],
    seamProminence: 0,
  });

  try {
    const image = await loadImage(dataUrl);
    const working = buildWorkingCanvas(image);

    if (Math.max(working.width, working.height) < MIN_WORKING_EDGE) {
      return unusable(
        `Image is ${working.width}x${working.height}; signal forensics needs a longest edge of at least ${MIN_WORKING_EDGE}px.`
      );
    }

    const ela = await elaStatistics(working);
    const noise = noiseStatistics(working);
    const seamProminence = seamStatistics(working);
    const ghost = await jpegGhostQualities(working);

    return {
      usable: true,
      workingWidth: working.width,
      workingHeight: working.height,
      elaBlockVariance: ela.blockVariance,
      elaOutlierBlockRatio: ela.outlierRatio,
      noiseResidualMean: noise.residualMean,
      noiseUniformity: noise.uniformity,
      jpegGhostQualities: ghost,
      seamProminence,
    };
  } catch (err) {
    return unusable(err instanceof Error ? err.message : 'Signal forensics failed on this file.');
  }
}

/* -------------------------------------------------------------------------
   Statistics -> findings

   The mutation strings are written so classifyMutation() in
   manipulationAssessment.ts still sorts them correctly on its own, but each
   also ships an explicit category alongside it. The regex layer remains the
   fallback for stored cases and for model-supplied text; nothing measured
   here has to be recovered by pattern-matching prose this codebase wrote.
   ------------------------------------------------------------------------- */

export interface SignalDerivationOptions {
  /** EXIF as parsed from the original bytes in the browser. */
  exifData?: Record<string, string | number | boolean>;
  /** Container type, used only to decide whether absent EXIF means anything. */
  mimeType?: string;
}

/** Editing suites that announce themselves in the metadata they leave behind. */
const EDITOR_SOFTWARE =
  /photoshop|lightroom|gimp|affinity|pixelmator|snapseed|facetune|luminar|topaz|midjourney|stable ?diffusion|dall-?e|firefly/i;

function assessMetadata(options: SignalDerivationOptions): { tampered: boolean; note?: string } {
  const exif = options.exifData ?? {};
  const keys = Object.keys(exif);
  const software = String(exif['Software'] ?? exif['ProcessingSoftware'] ?? '');

  if (EDITOR_SOFTWARE.test(software)) {
    return { tampered: true, note: `editing software recorded in metadata (${software})` };
  }

  /* Absent EXIF is a real observation but a weak one — every major platform
   * strips it on upload — so it is recorded without being called tampering
   * on its own. The classifier treats a metadata flag as supporting evidence
   * that cannot flip a verdict, which is the correct weight for it. */
  const isJpeg = /jpe?g/i.test(options.mimeType ?? '');
  const capturedTags = keys.filter((k) => k !== 'Format' && k !== 'JFIF_Standard');
  if (isJpeg && capturedTags.length === 0) {
    return { tampered: true, note: 'no EXIF tags survive in this JPEG' };
  }

  return { tampered: false };
}

/**
 * Fuse the statistics into the values the classifier consumes.
 *
 * Monotonic by construction: every component is a clamped ramp with a
 * non-negative weight, so no measurement can lower a confidence that another
 * one raised. Per-component contributions are returned so the figure can be
 * shown as a sum of its parts rather than as a bare number.
 *
 * Returns null when the statistics are unusable — the caller must then leave
 * manipulationConfidence at NOT_ASSESSED rather than at zero.
 */
export function deriveSignalFindings(
  stats: ForensicStatistics,
  options: SignalDerivationOptions = {}
): SignalFindings | null {
  if (!stats.usable) return null;

  const metadata = assessMetadata(options);
  const priorQualities = stats.jpegGhostQualities.length;
  const compressionGenerations = Math.max(1, Math.min(priorQualities, 6));

  const components: SignalComponent[] = [
    {
      id: 'splice',
      label: 'Localised recompression inconsistency',
      measurement: `${(stats.elaOutlierBlockRatio * 100).toFixed(1)}% of ELA blocks are robust outliers`,
      normalised: ramp(stats.elaOutlierBlockRatio, ELA_OUTLIER_RAMP),
      weight: WEIGHTS.splice,
    },
    {
      id: 'noiseMismatch',
      label: 'Sensor noise floor varies across the frame',
      measurement: `noise uniformity ${stats.noiseUniformity.toFixed(2)}`,
      normalised: ramp(stats.noiseUniformity, NOISE_UNIFORMITY_RAMP),
      weight: WEIGHTS.noiseMismatch,
    },
    {
      id: 'noiseFloor',
      label: 'Noise floor below sensor baseline',
      measurement: `mean residual ${stats.noiseResidualMean.toFixed(2)}`,
      normalised: ramp(stats.noiseResidualMean, NOISE_FLOOR_RAMP),
      weight: WEIGHTS.noiseFloor,
    },
    {
      id: 'recompression',
      label: 'Multiple quantisation points in the compression history',
      measurement:
        priorQualities > 0
          ? `ghost dips at quality ${stats.jpegGhostQualities.join(', ')}`
          : 'no quantisation history recovered',
      normalised: ramp(Math.max(0, priorQualities - 1), GHOST_GENERATION_RAMP),
      weight: WEIGHTS.recompression,
    },
  ];

  const fused = components.reduce((sum, c) => sum + c.weight * c.normalised, 0);
  const manipulationConfidence = Math.round(clamp01(fused) * 100);

  /* Only measurements that crossed their own reporting threshold become
   * mutations. The rest stay in `components`, visible as a contribution,
   * without being asserted as findings. */
  const mutations: string[] = [];
  const categories: ManipulationIndicatorCategory[] = [];
  const push = (text: string, category: ManipulationIndicatorCategory) => {
    mutations.push(text);
    categories.push(category);
  };

  if (stats.elaOutlierBlockRatio >= ELA_OUTLIER_REPORT) {
    push(
      `Localised recompression inconsistency — possible splice (${(stats.elaOutlierBlockRatio * 100).toFixed(1)}% of blocks)`,
      'conventional'
    );
  }
  if (stats.noiseUniformity >= NOISE_UNIFORMITY_REPORT) {
    push(
      `Sensor noise mismatch across regions (uniformity ${stats.noiseUniformity.toFixed(2)})`,
      'conventional'
    );
  }
  if (stats.noiseResidualMean <= NOISE_FLOOR_REPORT) {
    /* Ambiguous by nature. Generative output carries no sensor grain, and
     * neither does an aggressively denoised or upscaled camera capture — so
     * this is recorded as neutral and left to corroborate rather than to
     * decide. Detector A is the one qualified to call this AI. */
    push(
      `Noise floor below sensor baseline — generative smoothing or heavy denoising (residual ${stats.noiseResidualMean.toFixed(2)})`,
      'neutral'
    );
  }
  /* Re-encoding depth and the metadata flag are deliberately NOT mutations.
   *
   * They travel to the classifier as structural.compressionGenerations and
   * structural.metadataTamperFlag, where the existing rule already treats
   * them as supporting evidence that can strengthen an observed edit but can
   * never establish one on its own.
   *
   * Emitting them here as conventional mutations would route them around
   * that rule, because a mutation IS a demonstrated editing operation to the
   * classifier. Measured consequence: a clean capture with its EXIF stripped
   * — which describes almost every image ever downloaded from a social
   * platform — came back CONVENTIONAL at 40% confidence. Re-encoding and a
   * missing metadata block are redistribution, not editing, and they are
   * reported as such.
   */

  return {
    mutations,
    categories,
    manipulationConfidence,
    compressionGenerations,
    metadataTamperFlag: metadata.tampered,
    components,
    statistics: stats,
  };
}
