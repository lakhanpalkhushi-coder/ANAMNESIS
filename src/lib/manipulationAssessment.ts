/*
 * MANIPULATION TYPE ASSESSMENT — PROTOTYPE LAYER
 *
 * ANAMNESIS does not ship a validated, trained forensic classifier that can
 * separate AI manipulation from conventional editing. This module is an
 * AI-assisted *assessment* layer: it reasons over the signals the existing
 * analysis pipeline already produces (declared mutations, synthetic
 * probability, tamper confidence, compression generations, metadata tamper
 * flag and source-completeness indicators) and reports a likely manipulation
 * type with explicit confidence and explicit limitations.
 *
 * It deliberately does NOT claim to know who edited the media, what software
 * was used, or the complete editing history.
 *
 * It also never manufactures a reading out of a gap. Every numeric input is
 * Assessable<number>: when analysis has not run, or ran and failed, the case
 * state carries NOT_ASSESSED rather than a number. Those cases resolve to
 * INCONCLUSIVE with no confidence figure attached to a measurement nobody
 * made. `Number(NOT_ASSESSED)` would be NaN, and a NaN percentage rendered
 * as a verdict is precisely the failure this codebase is built to avoid.
 *
 * Pure, because buildCaseState calls it and buildCaseState is documented as
 * pure: the timestamp is taken from the intake rather than the clock.
 */

import {
  Assessable,
  isAssessed,
  NOT_ASSESSED,
  ManipulationAssessment,
  ManipulationIndicator,
  ManipulationIndicatorCategory,
  ManipulationTypeClass,
  PersistentCaseState,
} from '../types';

export const PROTOTYPE_ASSESSMENT_LABEL =
  'Prototype forensic assessment — requires investigator verification.';

export const MANIPULATION_SCOPE_NOTE =
  'Not all manipulated media is AI-generated. ANAMNESIS analyses available evidence for both AI-based and conventional editing indicators.';

const clamp = (n: number, min: number, max: number) =>
  Math.max(min, Math.min(max, Math.round(n)));

/**
 * Formats an assessable percentage for display. A gap renders as
 * "NOT ASSESSED", never as "NOT_ASSESSED%" or "0%".
 */
export const formatAssessedPct = (value: Assessable<number>): string =>
  isAssessed(value) ? `${value}%` : 'NOT ASSESSED';

/* -------------------------------------------------------------------------
   1. Mutation taxonomy
   Ordered rules — the first match wins. Order matters because some terms are
   ambiguous ("clone stamp" is a manual retouching tool, "voice clone" is not).
   ------------------------------------------------------------------------- */

const CONVENTIONAL_FIRST = /clone stamp|copy-?move|rubber ?stamp/i;

const AI_PATTERN =
  /generative|gen-?ai|\bai\b|deepfake|face ?swap|synthes|synthetic|inpaint|outpaint|diffusion|\bgan\b|neural|latent|prompt|text-to-|\btts\b|voice clone|cloned voice|upscaler model/i;

const CONVENTIONAL_PATTERN =
  /crop|cut|trim|splic|watermark|overlay|stamp|insert|compress|transcode|re-?encode|downsampl|resolution|strip|speed|retouch|aging filter|colou?r|brightness|contrast|mask|rearrang|segment|blur|filter|remov|deleti|montage|rotat|mirror|flip|caption|subtitle|ducking|fade/i;

export function classifyMutation(mutation: string): ManipulationIndicatorCategory {
  if (CONVENTIONAL_FIRST.test(mutation)) return 'conventional';
  if (AI_PATTERN.test(mutation)) return 'ai';
  if (CONVENTIONAL_PATTERN.test(mutation)) return 'conventional';
  return 'neutral';
}

const MUTATION_DETAIL: Array<[RegExp, string]> = [
  [/face ?swap|deepfake/i, 'Facial region statistics differ from the surrounding frame.'],
  [/generative|gen-?ai|inpaint|outpaint/i, 'Regions consistent with generative fill rather than camera capture.'],
  [/synthes|synthetic/i, 'Content characteristics consistent with generated, not captured, media.'],
  [/voice clone|\btts\b|cloned voice/i, 'Speech envelope consistent with synthesised or cloned voice.'],
  [/crop/i, 'Framing narrowed — surrounding scene context is no longer present.'],
  [/splic|cut|trim|segment|remov|deleti/i, 'Discontinuity consistent with removed or rejoined segments.'],
  [/watermark/i, 'Channel or platform marking added or removed after capture.'],
  [/overlay|stamp|insert|caption|subtitle/i, 'Elements composited on top of the original frame.'],
  [/compress|transcode|re-?encode|downsampl|resolution/i, 'Repeated re-encoding typical of redistribution.'],
  [/strip/i, 'Stream or metadata content removed from the container.'],
  [/speed/i, 'Playback rate differs from the apparent capture rate.'],
  [/retouch|aging filter|blur|filter|colou?r|brightness|contrast/i, 'Manual grading or retouching applied to the image.'],
];

function detailFor(mutation: string): string {
  const hit = MUTATION_DETAIL.find(([re]) => re.test(mutation));
  return hit ? hit[1] : 'Transformation observed in the submitted media.';
}

/* -------------------------------------------------------------------------
   2. Type labels & headlines
   ------------------------------------------------------------------------- */

export const MANIPULATION_TYPE_LABEL: Record<ManipulationTypeClass, string> = {
  AI_BASED: 'AI-assisted manipulation',
  CONVENTIONAL: 'Conventional / Manual Editing',
  MIXED: 'Mixed — conventional editing + AI-assisted alteration',
  NONE: 'No significant manipulation indicators',
  INCONCLUSIVE: 'Inconclusive — additional evidence required',
};

export const MANIPULATION_TYPE_ICON: Record<ManipulationTypeClass, string> = {
  AI_BASED: '🤖',
  CONVENTIONAL: '✂️',
  MIXED: '🧩',
  NONE: '🟢',
  INCONCLUSIVE: '⚪',
};

/** Short label used in badges, the reveal sequence and the PDF dossier. */
export const MANIPULATION_TYPE_SHORT: Record<ManipulationTypeClass, string> = {
  AI_BASED: 'AI-ASSISTED MANIPULATION',
  CONVENTIONAL: 'CONVENTIONAL EDITING',
  MIXED: 'MIXED (CONVENTIONAL + AI)',
  NONE: 'NO SIGNIFICANT MANIPULATION',
  INCONCLUSIVE: 'INCONCLUSIVE',
};

/** Tailwind accent classes, matching the existing ANAMNESIS status palette. */
export function manipulationTypeTheme(type: ManipulationTypeClass) {
  switch (type) {
    case 'AI_BASED':
      return {
        text: 'text-rose-300',
        accent: 'text-rose-400',
        border: 'border-rose-500/50',
        panel: 'bg-rose-950/30',
        badge: 'bg-rose-950 border-rose-600 text-rose-300',
      };
    case 'CONVENTIONAL':
      return {
        text: 'text-amber-300',
        accent: 'text-amber-400',
        border: 'border-amber-500/50',
        panel: 'bg-amber-950/30',
        badge: 'bg-amber-950 border-amber-600 text-amber-300',
      };
    case 'MIXED':
      return {
        text: 'text-purple-300',
        accent: 'text-purple-400',
        border: 'border-purple-500/50',
        panel: 'bg-purple-950/30',
        badge: 'bg-purple-950 border-purple-600 text-purple-300',
      };
    case 'NONE':
      return {
        text: 'text-emerald-300',
        accent: 'text-emerald-400',
        border: 'border-emerald-500/50',
        panel: 'bg-emerald-950/30',
        badge: 'bg-emerald-950 border-emerald-600 text-emerald-300',
      };
    default:
      return {
        text: 'text-zinc-300',
        accent: 'text-zinc-400',
        border: 'border-zinc-700',
        panel: 'bg-zinc-950',
        badge: 'bg-zinc-950 border-zinc-700 text-zinc-300',
      };
  }
}

/* -------------------------------------------------------------------------
   3. Derivation
   ------------------------------------------------------------------------- */

export function deriveManipulationAssessment(
  caseState: PersistentCaseState
): ManipulationAssessment {
  const analysis = caseState?.analysis;
  const manipulation = analysis?.manipulation;
  const structural = analysis?.structural;
  const visual = analysis?.visual;
  const sc = analysis?.sourceCompleteness;

  const mutations = manipulation?.mutationsDetected ?? [];

  /* Where a mutation's category is known at the point of measurement, use it.
   * classifyMutation stays the fallback for stored cases, for Demo Mode
   * fixtures and for model-supplied prose — but a detector that already
   * knows it measured a splice should not have that fact recovered from its
   * own wording by regular expression.
   *
   * Indexed rather than zipped: the arrays are parallel by construction, and
   * a short or absent category array degrades to the regex per element
   * instead of failing. */
  const declaredCategories = manipulation?.mutationCategories;
  const categories: ManipulationIndicatorCategory[] = mutations.map(
    (m, i) => declaredCategories?.[i] ?? classifyMutation(m)
  );
  const mutationOrigin = declaredCategories?.length
    ? 'Signal forensics (measured)'
    : 'Transformation analysis';

  /* The two numbers the whole classification rests on. Both are gaps until
   * an analysis produces them, and a gap is not a zero. */
  const rawSynthetic = manipulation?.syntheticProbabilityScore;
  const rawManipConfidence = manipulation?.manipulationConfidence;
  const hasSynthetic = rawSynthetic !== undefined && isAssessed(rawSynthetic);
  const hasManipConfidence =
    rawManipConfidence !== undefined && isAssessed(rawManipConfidence);

  const syntheticScore = hasSynthetic ? Number(rawSynthetic) : 0;
  const manipConfidence = hasManipConfidence ? Number(rawManipConfidence) : 0;

  /* Without a manipulation confidence there is no analysis to reason over.
   * Mutations alone cannot be weighed, so the honest answer is the gap. */
  if (!hasManipConfidence) {
    return buildUnassessedAssessment(caseState);
  }

  const indicators: ManipulationIndicator[] = [];

  // --- Declared mutations -------------------------------------------------
  mutations.forEach((m, i) => {
    indicators.push({
      label: m,
      category: categories[i],
      detail: detailFor(m),
      origin: mutationOrigin,
    });
  });

  // --- Synthetic / generative signal --------------------------------------
  if (hasSynthetic && syntheticScore >= 55) {
    indicators.push({
      label: 'Synthetic visual artifacts',
      category: 'ai',
      detail: `Synthetic probability signal at ${Math.round(syntheticScore)}% for the submitted frames.`,
      origin: 'Synthetic probability score',
    });
  }

  const chromatic = visual?.chromaticAberration;
  if (chromatic !== undefined && isAssessed(chromatic) && /synthetic|distort/i.test(chromatic)) {
    indicators.push({
      label: 'Chromatic aberration inconsistency',
      category: 'ai',
      detail: `Lens dispersion reported as ${chromatic} rather than natural optics.`,
      origin: 'Visual signal analysis',
    });
  }

  const lighting = visual?.lightingConsistency;
  if (lighting !== undefined && isAssessed(lighting) && /conflict|inconsist/i.test(lighting)) {
    indicators.push({
      label: 'Lighting vector conflict',
      category: 'neutral',
      detail:
        'Lighting directions conflict across the frame — possible compositing or generative insertion.',
      origin: 'Visual signal analysis',
    });
  }

  // --- Structural / redistribution signal ---------------------------------
  const rawGenerations = structural?.compressionGenerations;
  const generations =
    rawGenerations !== undefined && isAssessed(rawGenerations) ? Number(rawGenerations) : 0;
  if (generations > 1) {
    indicators.push({
      label: 'Multiple re-encode generations',
      category: 'conventional',
      detail: `${generations} compression generations observed — media was re-saved after capture.`,
      origin: 'Structural analysis',
    });
  }

  const rawTamperFlag = structural?.metadataTamperFlag;
  const metadataTampered =
    rawTamperFlag !== undefined && isAssessed(rawTamperFlag) && rawTamperFlag === true;
  if (metadataTampered) {
    indicators.push({
      label: 'Metadata inconsistency',
      category: 'conventional',
      detail: 'Container metadata was stripped or rewritten after capture.',
      origin: 'Structural analysis',
    });
  }

  // --- Source completeness signal -----------------------------------------
  const extractedClip = Boolean(sc?.possibleExtractedClip) && !sc?.originalProvided;
  if (extractedClip) {
    (sc?.detectedIndicators ?? []).slice(0, 3).forEach((ind) => {
      indicators.push({
        label: ind,
        category: 'conventional',
        detail: 'Boundary discontinuity consistent with a clip extracted from a longer recording.',
        origin: 'Source completeness check',
      });
    });
  }

  // --- Signal strengths ---------------------------------------------------
  // Only the transformations the pipeline actually reported can establish that
  // a manipulation *type* is present. Derived signals (re-encoding, stripped
  // metadata, an incomplete source) are recorded and they modulate strength,
  // but on their own they describe redistribution or missing context — not a
  // demonstrated editing operation — so they never flip the classification.
  const mutationAiCount = categories.filter((c) => c === 'ai').length;
  const mutationConvCount = categories.filter((c) => c === 'conventional').length;
  const classifiedMutations = mutationAiCount + mutationConvCount;

  const aiRatio = classifiedMutations > 0 ? mutationAiCount / classifiedMutations : 0;
  const convRatio = classifiedMutations > 0 ? mutationConvCount / classifiedMutations : 0;
  const tamperBase = 0.6 * manipConfidence + 40;

  const aiSignalStrength = clamp(
    Math.max(hasSynthetic ? syntheticScore : 0, aiRatio * tamperBase),
    0,
    100
  );

  let conventionalRaw = convRatio * tamperBase;
  const hasSupportingConventional = extractedClip || generations > 1 || metadataTampered;

  if (mutationConvCount > 0) {
    // Supporting evidence reinforces an already-observed manual edit.
    if (extractedClip) conventionalRaw = Math.max(conventionalRaw, 60);
    if (generations > 1 || metadataTampered) {
      conventionalRaw = Math.max(conventionalRaw, 45);
    }
  } else if (hasSupportingConventional) {
    // Re-encoding, stripped metadata or an incomplete source are real but weak
    // signals. They are reported below the reporting threshold so the reading
    // stays honest without changing the classification.
    conventionalRaw = Math.max(conventionalRaw, 15);
  }
  const conventionalSignalStrength = clamp(conventionalRaw, 0, 100);

  const aiPresent =
    (hasSynthetic && syntheticScore >= 55) ||
    (mutationAiCount > 0 && aiSignalStrength >= 25);
  const convPresent = mutationConvCount > 0 && conventionalSignalStrength >= 20;

  // --- Evidence sufficiency ------------------------------------------------
  // Insufficient evidence: the pipeline flagged possible tampering but produced
  // no transformation that can be attributed to either manipulation family.
  const ambiguous = !aiPresent && !convPresent && manipConfidence >= 35;
  const evidenceSufficient = !ambiguous && indicators.length > 0;

  // --- Classification ------------------------------------------------------
  let likelyType: ManipulationTypeClass;
  if (ambiguous) {
    likelyType = 'INCONCLUSIVE';
  } else if (aiPresent && convPresent) {
    likelyType = 'MIXED';
  } else if (aiPresent) {
    likelyType = 'AI_BASED';
  } else if (convPresent) {
    likelyType = 'CONVENTIONAL';
  } else {
    likelyType = 'NONE';
  }

  const manipulationDetected: boolean | 'inconclusive' =
    likelyType === 'INCONCLUSIVE' ? 'inconclusive' : likelyType !== 'NONE';

  // --- Confidence ----------------------------------------------------------
  let confidence: number;
  switch (likelyType) {
    case 'AI_BASED':
      confidence =
        0.5 * manipConfidence +
        0.5 * Math.max(hasSynthetic ? syntheticScore : 0, aiSignalStrength);
      break;
    case 'CONVENTIONAL':
      confidence = 0.6 * manipConfidence + 0.4 * conventionalSignalStrength;
      break;
    case 'MIXED':
      confidence =
        0.55 * manipConfidence + 0.45 * ((aiSignalStrength + conventionalSignalStrength) / 2) - 4;
      break;
    case 'NONE':
      confidence = 100 - manipConfidence * 0.9;
      break;
    default:
      confidence = manipConfidence * 0.5;
      break;
  }

  // A prototype layer must not present near-certainty.
  confidence =
    likelyType === 'INCONCLUSIVE'
      ? clamp(confidence, 20, 55)
      : clamp(confidence, 40, 95);

  // Source completeness limits how far any conclusion can be pushed. It
  // constrains reasoning about cuts and structure most of all, so the penalty
  // is larger for conventional / mixed / clean findings than for AI findings.
  let sourceCompletenessWarning: string | undefined;
  if (extractedClip) {
    confidence = clamp(confidence - (likelyType === 'AI_BASED' ? 4 : 8), 30, 95);
    sourceCompletenessWarning =
      'Available media may be an extracted segment. Full source was not provided, therefore conclusions are limited to the submitted clip.';
  }

  // --- Narrative -----------------------------------------------------------
  const headline =
    manipulationDetected === 'inconclusive'
      ? 'Inconclusive — additional evidence required'
      : manipulationDetected
      ? 'Manipulation detected'
      : 'No significant manipulation detected';

  let summary: string;
  switch (likelyType) {
    case 'AI_BASED':
      summary =
        'Based on available evidence, the indicators are most consistent with generative or AI-assisted alteration of the media.';
      break;
    case 'CONVENTIONAL':
      summary =
        'Based on available evidence, the indicators are most consistent with conventional editing — cutting, cropping, splicing or overlays — rather than generative AI.';
      break;
    case 'MIXED':
      summary =
        'Based on available evidence, indicators of both conventional editing and AI-assisted alteration are present. The media may have been manually edited and separately altered using generative tools.';
      break;
    case 'NONE':
      summary = 'No significant indicators identified in the available evidence.';
      break;
    default:
      summary =
        'The available evidence does not support a manipulation type determination. Additional evidence — ideally the full original source — is required.';
      break;
  }

  // --- Limitations ---------------------------------------------------------
  const limitations: string[] = [
    'ANAMNESIS cannot determine who edited the media, what software was used, or the complete editing history.',
    'Findings describe indicators observed in the submitted file only, and are an AI-assisted forensic assessment — not a legal conclusion.',
  ];

  if (sourceCompletenessWarning) limitations.push(sourceCompletenessWarning);
  if (!evidenceSufficient) limitations.push('Inconclusive — additional evidence required.');
  if (aiSignalStrength > 0 && aiSignalStrength < 55 && likelyType !== 'AI_BASED') {
    limitations.push(
      'Weak generative-AI signal present but below the reporting threshold; AI involvement can neither be confirmed nor excluded.'
    );
  }
  if (!hasSynthetic) {
    limitations.push(
      'No synthetic-probability measurement is available for this media, so AI involvement is assessed from reported transformations alone.'
    );
  }
  /* Naming the detector matters as much as the number. A reader has to be
   * able to tell a measured score from a language model's estimate, and the
   * two are indistinguishable once rendered as a percentage. */
  const provenance = analysis?.detectorProvenance;
  const syntheticDetector = provenance?.find((d) => d.role === 'synthetic');
  if (syntheticDetector && !isAssessed(syntheticDetector.score)) {
    limitations.push(
      `The synthetic-image detector (${syntheticDetector.id}) returned no score for this media; AI involvement can neither be confirmed nor excluded.`
    );
  }
  if (provenance?.some((d) => d.backend === 'language-model')) {
    limitations.push(
      'These figures are a language-model estimate rather than a detector measurement, and are not a forensic measurement of this file.'
    );
  }
  if (!isAssessed(analysis?.structural?.compressionGenerations ?? NOT_ASSESSED)) {
    limitations.push(
      'No compression history was recovered, so redistribution depth is unknown.'
    );
  }
  const originEcho = caseState?.investigation?.originEcho;
  if (originEcho !== undefined && isAssessed(originEcho) && originEcho.is_estimated) {
    limitations.push(
      'Origin Echo attributes remain ESTIMATED — NOT ORIGINAL EVIDENCE. No original file has been recovered.'
    );
  }

  return {
    manipulationDetected,
    likelyType,
    likelyTypeLabel: MANIPULATION_TYPE_LABEL[likelyType],
    headline,
    summary,
    confidence,
    aiSignalStrength,
    conventionalSignalStrength,
    indicators,
    evidenceSufficient,
    limitations,
    sourceCompletenessWarning,
    assessmentLabel: PROTOTYPE_ASSESSMENT_LABEL,
    generatedAt: caseState?.ingest?.uploadTimestamp ?? '',
    detectorProvenance: provenance,
  };
}

/**
 * The assessment for a case nothing has analysed.
 *
 * Not a verdict and not a zero score: the type is INCONCLUSIVE, no
 * confidence figure is offered, and the limitations say why. A failed or
 * unrun analysis must land here rather than on a fabricated percentage.
 */
function buildUnassessedAssessment(caseState: PersistentCaseState): ManipulationAssessment {
  const sc = caseState?.analysis?.sourceCompleteness;
  const extractedClip = Boolean(sc?.possibleExtractedClip) && !sc?.originalProvided;

  const limitations = [
    'No analysis has produced a manipulation measurement for this media, so no manipulation type can be assessed.',
    'ANAMNESIS cannot determine who edited the media, what software was used, or the complete editing history.',
  ];
  if (extractedClip) {
    limitations.push(
      'Available media may be an extracted segment. Full source was not provided, therefore conclusions are limited to the submitted clip.'
    );
  }

  return {
    manipulationDetected: 'inconclusive',
    likelyType: 'INCONCLUSIVE',
    likelyTypeLabel: MANIPULATION_TYPE_LABEL.INCONCLUSIVE,
    headline: 'Inconclusive — additional evidence required',
    summary:
      'No analysis result is available for this media. The hash and any metadata shown elsewhere were measured locally; a manipulation type assessment requires a completed analysis.',
    confidence: NOT_ASSESSED,
    aiSignalStrength: NOT_ASSESSED,
    conventionalSignalStrength: NOT_ASSESSED,
    indicators: [],
    evidenceSufficient: false,
    limitations,
    sourceCompletenessWarning: extractedClip
      ? 'Available media may be an extracted segment. Full source was not provided, therefore conclusions are limited to the submitted clip.'
      : undefined,
    assessmentLabel: PROTOTYPE_ASSESSMENT_LABEL,
    generatedAt: caseState?.ingest?.uploadTimestamp ?? '',
    /* Carried even here. Which detector was asked and came back empty is
     * itself a finding, and it is the difference between "not attempted"
     * and "attempted and inconclusive". */
    detectorProvenance: caseState?.analysis?.detectorProvenance,
  };
}

/**
 * Reads the stored assessment, re-deriving it when a case predates the
 * feature or when upstream signals (e.g. source completeness) have changed.
 */
export function getManipulationAssessment(
  caseState: PersistentCaseState
): ManipulationAssessment {
  return (
    caseState?.analysis?.manipulationAssessment ?? deriveManipulationAssessment(caseState)
  );
}
