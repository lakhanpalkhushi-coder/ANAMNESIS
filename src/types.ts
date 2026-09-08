/* =========================================================================
 * THE GAP SENTINEL
 *
 * NOT_ASSESSED is a first-class value, not an empty string and not a zero.
 * It means: the model omitted this field, or analysis has not run.
 *
 * Every panel that can display a finding must also be able to render this
 * state — grey, unemphasised, no verdict colour, no percentage, and never
 * a green tick. It exists so that deleting an invented constant has
 * somewhere honest to put the gap it leaves behind.
 * ========================================================================= */

export const NOT_ASSESSED = 'NOT_ASSESSED' as const;
export type NotAssessed = typeof NOT_ASSESSED;

/** A value the file or the model supplied, or the explicit absence of one. */
export type Assessable<T> = T | NotAssessed;

/** Narrowing helper: true when a real measurement or model answer is present. */
export function isAssessed<T>(value: Assessable<T>): value is T {
  return value !== NOT_ASSESSED;
}

export interface CaseSummary {
  evidence_id: string;
  primary_hash_sha256: string;
  verdict_summary: string;
}

export interface WhoAnalysis {
  observation: string;
  confidence: number; // 0.00 to 1.00
  entities_detected?: string[];
  synthetic_artifacts?: string[];
}

export interface WhereAnalysis {
  claimed: string;
  observed: string;
  status: 'Consistent' | 'Inconsistent' | 'Needs Verification';
  geolocation_clues?: string[];
  coordinates_estimate?: string;
}

export interface WhenAnalysis {
  claimed: string;
  observed: string;
  status: 'Consistent' | 'Inconsistent' | 'Needs Verification';
  temporal_markers?: string[];
  solar_shadow_analysis?: string;
}

export interface WhatChangedAnalysis {
  mutations_detected: string[]; // e.g. ["Crop", "Compression", "Watermark", "Audio Splice", "Generative Fill"]
  details: string;
  ela_findings?: string;
  sensor_noise_findings?: string;
}

export interface HowItSpreadAnalysis {
  lineage_notes: string;
  estimated_generations: number;
  platforms_detected?: string[];
  virality_pattern?: string;
}

export interface FiveQuestions {
  who: WhoAnalysis;
  where: WhereAnalysis;
  when: WhenAnalysis;
  what_changed: WhatChangedAnalysis;
  how_it_spread: HowItSpreadAnalysis;
}

/* -------------------------------------------------------------------------
 * View-side projections of the five questions.
 *
 * The wire interfaces above are exactly what the Gemini responseSchema
 * produces and must not be altered. These aliases widen only the fields
 * that carry a verdict or a number, so that a case which has not been
 * analysed can render the gap instead of a fabricated zero.
 * ---------------------------------------------------------------------- */

export type AssessedWho = Omit<WhoAnalysis, 'confidence'> & {
  confidence: Assessable<number>;
};
export type AssessedWhere = Omit<WhereAnalysis, 'status'> & {
  status: Assessable<WhereAnalysis['status']>;
};
export type AssessedWhen = Omit<WhenAnalysis, 'status'> & {
  status: Assessable<WhenAnalysis['status']>;
};
export type AssessedHowItSpread = Omit<HowItSpreadAnalysis, 'estimated_generations'> & {
  estimated_generations: Assessable<number>;
};

export interface ForensicTimelineStage {
  stage: number;
  label: string;
  description: string;
  estimated_timestamp?: string;
  platform?: string;
  is_origin_echo?: boolean;
}

export interface ContextIntegrityCheck {
  raw_media_status: '🟢 Consistent' | '🟠 Tampered' | '🔴 Synthetic' | string;
  claimed_location_status: '🟢 Verified' | '🟠 Needs Verification' | '🔴 Inconsistent' | string;
  claimed_time_status: '🟢 Verified' | '🟠 Needs Verification' | '🔴 Inconsistent' | string;
  audio_integrity_status: '🟢 Untampered' | '🟠 Spliced/Manipulated' | '🔴 Out of Sync' | string;
}

export interface TechnicalForensicMetrics {
  synthetic_probability_score: number; // 0-100
  manipulation_confidence: number; // 0-100
  compression_generations: number;
  metadata_tamper_flag: boolean;
  chromatic_aberration_consistency: 'Natural' | 'Synthetic' | 'Distorted';
  lighting_vector_consistency: 'Consistent' | 'Conflicting' | 'Inconclusive';
  shadow_sun_angle_match: 'Matched' | 'Mismatched' | 'Indeterminate';
  exif_anomaly_notes?: string;
}

export interface OriginEchoEstimate {
  is_estimated: true;
  label: 'ESTIMATED — NOT ORIGINAL EVIDENCE';
  original_resolution_estimate?: string;
  earliest_known_timestamp?: string;
  likely_capture_device?: string;
  unmanipulated_scene_description?: string;
  surviving_attributes: string[];
}

export interface AnamnesisForensicReport {
  case_summary: CaseSummary;
  the_five_questions: FiveQuestions;
  forensic_replay_timeline: ForensicTimelineStage[];
  context_integrity_check: ContextIntegrityCheck;
  investigator_notes: string;
  technical_metrics?: TechnicalForensicMetrics;
  origin_echo?: OriginEchoEstimate;
  manipulation_assessment?: ManipulationAssessment;
}

/**
 * The dossier shape handed to the export modal.
 *
 * Mirrors AnamnesisForensicReport but is built from the view model, so it
 * carries gaps rather than zero-filling them. Optional blocks are omitted
 * entirely when nothing in them was assessed.
 */
export interface ExportableDossier {
  case_summary: {
    evidence_id: string;
    primary_hash_sha256: Assessable<string>;
    verdict_summary: Assessable<string>;
  };
  the_five_questions: {
    who: AssessedWho;
    where: AssessedWhere;
    when: AssessedWhen;
    what_changed: WhatChangedAnalysis;
    how_it_spread: AssessedHowItSpread;
  };
  forensic_replay_timeline: ForensicTimelineStage[];
  context_integrity_check: ContextIntegrityCheck;
  investigator_notes: Assessable<string>;
  technical_metrics?: Partial<TechnicalForensicMetrics>;
  origin_echo?: OriginEchoEstimate;
  /* Always present. Unlike the blocks above it carries its own inconclusive
   * state, so omitting it would lose the distinction between "assessed as
   * inconclusive" and "never considered". */
  manipulation_assessment?: ManipulationAssessment;
}

export interface MediaIntakeData {
  evidenceId: string;
  title: string;
  mediaType: 'image' | 'video' | 'audio' | 'document';
  mediaUrl: string;
  previewUrl: string;
  fileName: string;
  fileSize: number;
  fileHashSha256: string;
  fileHashMd5?: string;
  claimedLocation: string;
  claimedDateTime: string;
  claimedNarrative: string;
  sourcePlatform: string;
  sourceUrl?: string;
  exifData?: Record<string, string | number | boolean>;
  uploadTimestamp: string;
  /**
   * True when this intake came from a Demo Mode fixture rather than a file
   * the investigator supplied. The UI must badge it for the whole life of
   * the case, so a reference case is never mistaken for a live result.
   */
  isPrecomputed?: boolean;
}

export interface ForensicFilterMode {
  id: 'raw' | 'ela' | 'noise' | 'sobel' | 'luminance' | 'solarize' | 'inverted' | 'blue_channel';
  label: string;
  description: string;
  icon: string;
}

export type StandardEvidenceStatus =
  | '🟢 OBSERVED / CONSISTENT'
  | '🟠 NEEDS VERIFICATION'
  | '🔴 INCONSISTENT'
  | '🔵 ESTIMATED'
  | '⚪ NOT ASSESSED';

/** The neutral status. Carries no verdict; must never render in a verdict colour. */
export const STATUS_NOT_ASSESSED: StandardEvidenceStatus = '⚪ NOT ASSESSED';

export interface SourceCompletenessData {
  submittedDuration: string;
  completenessAssessment: 'APPEARS COMPLETE' | 'POSSIBLE EXTRACTED CLIP' | 'INSUFFICIENT EVIDENCE';
  possibleExtractedClip: boolean;
  canVerifyFullSource: boolean;
  fullSourceFoundInEvidence: boolean;
  detectedIndicators: string[];
  sourceVerificationStatus: string;
  confidence: number;
  investigativeFlag: boolean;
  investigativeLead: string;
  originalProvided?: boolean;
  comparison?: {
    originalDuration: string;
    submittedClipTiming: string;
    extractedSegment: string;
    omittedPortions: string[];
    matchStatus: string;
  };
}

/* =========================================================================
   MANIPULATION TYPE ASSESSMENT
   Distinguishes AI-based manipulation from conventional / manual editing.
   This is a prototype, AI-assisted assessment layer derived from the
   signals already produced by the ANAMNESIS analysis pipeline. It is NOT a
   validated forensic classifier and must be verified by an investigator.
   ========================================================================= */

export type ManipulationTypeClass =
  | 'AI_BASED'
  | 'CONVENTIONAL'
  | 'MIXED'
  | 'NONE'
  | 'INCONCLUSIVE';

export type ManipulationIndicatorCategory = 'ai' | 'conventional' | 'neutral';

export interface ManipulationIndicator {
  label: string;
  category: ManipulationIndicatorCategory;
  detail: string;
  origin: string; // which analysis signal produced this indicator
}

export interface ManipulationAssessment {
  /** true / false / 'inconclusive' — never an absolute legal conclusion. */
  manipulationDetected: boolean | 'inconclusive';
  likelyType: ManipulationTypeClass;
  likelyTypeLabel: string;
  headline: string;
  summary: string;
  /* Assessable: a case nobody analysed carries NOT_ASSESSED here rather
   * than 0. "We did not measure this" and "we measured this and it was
   * zero" are different claims and must not render alike. */
  confidence: Assessable<number>; // 0-100
  aiSignalStrength: Assessable<number>; // 0-100
  conventionalSignalStrength: Assessable<number>; // 0-100
  indicators: ManipulationIndicator[];
  evidenceSufficient: boolean;
  limitations: string[];
  sourceCompletenessWarning?: string;
  /** Honest capability label shown alongside every result. */
  assessmentLabel: string;
  generatedAt: string;
  /** Which detector produced each number, so an exported dossier is
   *  reproducible months later against the same model and thresholds. */
  detectorProvenance?: DetectorProvenanceEntry[];
}

/* =========================================================================
   DETECTION LAYER
   Two detectors, deliberately independent, because the classifier above
   splits AI-based from conventional manipulation and no single model
   answers both questions.

     Detector A — a pretrained image classifier reached through the Hugging
                  Face Inference API. Produces syntheticProbabilityScore.
     Detector B — signal forensics computed in the browser over the ingested
                  pixels. Produces manipulationConfidence, the mutation list,
                  the compression generation estimate and the metadata flag.

   Neither may return zero on failure. A detector that did not run, could not
   run, or ran and failed contributes NOT_ASSESSED, and the difference
   between "measured as clean" and "not measured" survives to the dossier.
   ========================================================================= */

/** Raw measurements from Detector B. Uncalibrated indicators, not probabilities. */
export interface ForensicStatistics {
  /** False when the file could not be measured. Every field below is then
   *  meaningless and must not be displayed as a finding. */
  usable: boolean;
  unusableReason?: string;
  /** Resolution the statistics were computed at, not the file's own. */
  workingWidth: number;
  workingHeight: number;
  /** Variance of per-block ELA means, normalised by the mean. */
  elaBlockVariance: number;
  /** Fraction of ELA blocks that are robust (median + 2 sigma) outliers. */
  elaOutlierBlockRatio: number;
  /** Mean absolute Laplacian residual, 0-255. The sensor grain floor. */
  noiseResidualMean: number;
  /** Spread of the per-block noise floor relative to its median. */
  noiseUniformity: number;
  /** JPEG qualities at which the ghost curve dips — the file's quantisation history. */
  jpegGhostQualities: number[];
  /** Prominence of the strongest straight row/column edge ridge, 0-1. */
  seamProminence: number;
}

/** One weighted term in the manipulationConfidence sum, kept so the score
 *  can be shown as its parts rather than as an unexplained number. */
export interface SignalComponent {
  id: 'splice' | 'noiseMismatch' | 'noiseFloor' | 'recompression';
  label: string;
  /** The underlying measurement, in words, for display and for the dossier. */
  measurement: string;
  /** 0-1 after the documented ramp. */
  normalised: number;
  /** Fusion weight. All weights sum to 1. */
  weight: number;
}

/** Detector B's output, in the shape the case state consumes. */
export interface SignalFindings {
  mutations: string[];
  /** Explicit category per mutation, parallel to `mutations`. Removes the
   *  need to recover by regex what this codebase already knows. */
  categories: ManipulationIndicatorCategory[];
  manipulationConfidence: number; // 0-100
  compressionGenerations: number;
  metadataTamperFlag: boolean;
  components: SignalComponent[];
  statistics: ForensicStatistics;
}

/** Detector A's output. */
export interface SyntheticDetectorResult {
  /** Hugging Face repository id, e.g. "Organika/sdxl-detector". */
  modelId: string;
  backend: string;
  /** NOT_ASSESSED when the model was unreachable, still loading, or returned
   *  a label vocabulary this build does not recognise. */
  syntheticProbabilityScore: Assessable<number>;
  /** Every label the model returned, unmodified, so an unfamiliar vocabulary
   *  is diagnosable rather than silently discarded. */
  labelScores: Array<{ label: string; score: number }>;
  /** Why the score is absent, when it is. */
  note?: string;
}

export interface DetectorProvenanceEntry {
  id: string;
  role: 'synthetic' | 'signal';
  backend: string;
  score: Assessable<number>;
  /** The value at which this detector's signal becomes a reported finding. */
  threshold?: number;
}

/**
 * What the builder is given about a live detection run.
 *
 * `attempted` is the load-bearing field. When true, this is a live run and
 * the model's own numeric guesses are never consulted — a detector that
 * failed yields NOT_ASSESSED rather than quietly falling back to the
 * language model, which would reinstate exactly the problem the detectors
 * were added to remove. When false (Demo Mode, an empty case), the fixture's
 * technical_metrics are used and are labelled as an estimate.
 */
export interface DetectorEvidence {
  attempted: boolean;
  signal?: SignalFindings;
  synthetic?: SyntheticDetectorResult;
}

export interface PersistentCaseState {
  ingest: MediaIntakeData;
  analysis: {
    visual: {
      frameCharacteristics: Assessable<string>;
      visualIndicators: string[];
      chromaticAberration: Assessable<string>;
      lightingConsistency: Assessable<string>;
      shadowSunAngleMatch: Assessable<string>;
      confidence: Assessable<number>;
    };
    audio: {
      audioCharacteristics: Assessable<string>;
      audioIndicators: string[];
      enfStatus: Assessable<string>;
      acousticEnvelope: Assessable<string>;
      ambientReverbConsistency: Assessable<string>;
      confidence: Assessable<number>;
    };
    structural: {
      streamCharacteristics: Assessable<string>;
      compressionGenerations: Assessable<number>;
      metadataTamperFlag: Assessable<boolean>;
      confidence: Assessable<number>;
    };
    manipulation: {
      mutationsDetected: string[];
      /** Category per mutation, parallel to mutationsDetected, when the
       *  producer knew it. Absent on cases built before the detector layer
       *  and on model-supplied mutation text, which classifyMutation sorts. */
      mutationCategories?: ManipulationIndicatorCategory[];
      syntheticProbabilityScore: Assessable<number>;
      manipulationConfidence: Assessable<number>;
      status: StandardEvidenceStatus;
    };
    /** Detector B's raw measurements, when it ran. */
    forensicStatistics?: ForensicStatistics;
    /** The weighted terms behind manipulationConfidence, when it was measured. */
    signalComponents?: SignalComponent[];
    /** Which detector produced each number in this case. */
    detectorProvenance?: DetectorProvenanceEntry[];
    sourceCompleteness?: SourceCompletenessData;
    manipulationAssessment?: ManipulationAssessment;
  };
  relationships: {
    totalRelatedFound: Assessable<number>;
    nodes: Array<{
      id: string;
      title: string;
      relationshipType: string;
      confidence: Assessable<number>;
      platform: string;
      resolution: Assessable<string>;
      observedTransformations: string[];
      badgeColor: string;
      /* Per-copy lineage detail. The forensic schema returns no per-node
       * label, description, mutation type, generation depth or timestamp,
       * so these are NOT_ASSESSED until a source of them exists. */
      label: Assessable<string>;
      description: Assessable<string>;
      mutationType: Assessable<string>;
      generation: Assessable<number>;
      timestamp: Assessable<string>;
    }>;
    lineageHierarchy: Array<{ label: string; sub: string; type: string }>;
  };
  investigation: {
    forensicReplay: ForensicTimelineStage[];
    originEcho: Assessable<OriginEchoEstimate>;
    contextCheck: {
      rawMediaStatus: StandardEvidenceStatus;
      claimedLocationStatus: StandardEvidenceStatus;
      claimedTimeStatus: StandardEvidenceStatus;
      audioStatus: StandardEvidenceStatus;
      cascade: {
        rawMedia: string;
        claimedDate: string;
        claimedLocation: string;
        claimedCaption: string;
      };
      summary: string;
    };
  };
  report: {
    digitalCrimeScene: {
      who: AssessedWho;
      where: AssessedWhere;
      when: AssessedWhen;
      what: WhatChangedAnalysis;
      how: AssessedHowItSpread;
      source: {
        earliestKnownSource: Assessable<string>;
        platform: Assessable<string>;
      };
    };
    forensicPackage: {
      evidenceId: string;
      sha256: Assessable<string>;
      findings: Assessable<string>;
      confidenceScores: Record<string, number>;
      processingHistory: string[];
      generatedAt: string;
    };
  };
}

export interface InvestigatorProfile {
  id: string;
  name: string;
  officialEmail: string;
  departmentUnit: string;
  activeCasesCount: number;
  completedCasesCount: number;
  recentActivity: Array<{
    id: string;
    caseId: string;
    description: string;
    timestamp: string;
  }>;
}

export interface SavedCase {
  id: string; // e.g. "ANM-0147"
  title: string;
  lastUpdated: string;
  currentStepNumber: number; // 1, 2, 3, 4, 5
  workflowStage: number; // 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 6
  completedSteps: number[];
  expandedCompletedSteps?: { [key: number]: boolean };
  status: 'Investigation in progress' | 'Completed / Dossier Ready' | string;
  caseState: PersistentCaseState;
  investigatorId: string;
}

export interface BenchmarkCase {
  /** Always true. Demo Mode fixtures are never live results. */
  isPrecomputed: true;
  id: string;
  title: string;
  category: 'False Narrative / Recycled' | 'Deepfake / Synthetic AI' | 'Pixel Tampered / Spliced' | 'Audio-Visual Desync';
  badgeColor: string;
  description: string;
  intake: MediaIntakeData;
  precomputedReport: AnamnesisForensicReport;
}

