/* Prototype authentication/storage only. Production deployment requires secure departmental identity, encryption, access control and audit logging. */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Lock,
} from 'lucide-react';
import { Navbar } from './components/Navbar';
import { StartScreen } from './components/StartScreen';
import { LoginScreen } from './components/LoginScreen';
import { InvestigatorHome } from './components/InvestigatorHome';
import { InvestigatorProfileView } from './components/InvestigatorProfileView';
import { Step1Ingest } from './components/Step1Ingest';
import { Step2Analyse } from './components/Step2Analyse';
import { Step3Connect } from './components/Step3Connect';
import { Step4Investigate } from './components/Step4Investigate';
import { Step5Report } from './components/Step5Report';
import { FinalConnectedInvestigation } from './components/FinalConnectedInvestigation';
import { CompactStepIndicator } from './components/CompactStepIndicator';
import { DossierExportModal } from './components/DossierExportModal';
import { ManipulationAssessmentCard } from './components/ManipulationAssessmentCard';
import { InvestigationCompleteMoment } from './components/InvestigationCompleteMoment';
import { BENCHMARK_CASES } from './data/benchmarkCases';
import { buildCaseState } from './lib/caseStateBuilder';
import {
  formatAssessedPct,
  getManipulationAssessment,
  MANIPULATION_TYPE_SHORT,
} from './lib/manipulationAssessment';
import {
  DEMO_INVESTIGATOR,
  loadSavedCasesFromStorage,
  saveCasesToStorage,
} from './data/mockInvestigator';
import {
  AnamnesisForensicReport,
  DetectorEvidence,
  ExportableDossier,
  InvestigatorProfile,
  isAssessed,
  MediaIntakeData,
  NOT_ASSESSED,
  PersistentCaseState,
  SavedCase,
  TechnicalForensicMetrics,
} from './types';
import { soundFx } from './lib/soundFx';
import { ThemeProvider } from './lib/themeContext';
import { analyzeMedia, ApiError, detectSynthetic, toAnalyzeRequest } from './lib/api';
import { prepareImageForModel } from './lib/imagePrep';
import { computeForensicStatistics, deriveSignalFindings } from './lib/forensicStatistics';

/** The zero state of an intake: no file, no claims, no measurements. */
const EMPTY_INTAKE: MediaIntakeData = {
  evidenceId: '',
  title: '',
  mediaType: 'image',
  mediaUrl: '',
  previewUrl: '',
  fileName: '',
  fileSize: 0,
  fileHashSha256: '',
  claimedLocation: '',
  claimedDateTime: '',
  claimedNarrative: '',
  sourcePlatform: '',
  exifData: {},
  uploadTimestamp: '',
};

type AppView = 'welcome' | 'login' | 'home' | 'profile' | 'investigation';

function AppContent() {
  // Application-Level Navigation View
  // Initialize from URL hash if present (e.g. #home, #login)
  const getInitialView = (): AppView => {
    const hash = window.location.hash.replace('#', '') as AppView;
    const validViews: AppView[] = ['welcome', 'login', 'home', 'profile', 'investigation'];
    // Only restore non-auth views from hash; auth-gated views need investigator state
    if (hash === 'welcome' || hash === 'login') return hash;
    return 'welcome';
  };
  const [appView, setAppView] = useState<AppView>(getInitialView);

  // Authenticated Investigator State
  const [investigator, setInvestigator] = useState<InvestigatorProfile | null>(null);

  // Saved Cases for currently logged in investigator
  const [savedCases, setSavedCases] = useState<SavedCase[]>([]);

  // Active Case Identifier
  const [activeCaseId, setActiveCaseId] = useState<string>('ANM-0147');

  // =========================================================================
  // STRICT 5-STEP SEQUENTIAL WORKFLOW STATE MACHINE FOR ACTIVE CASE
  // Phase Progression:
  // 1: Step 1 active
  // 1.5: Step 1 completed, "CONTINUE TO NEXT STEP →" button available
  // 2: Step 2 active
  // 2.5: Step 2 completed, "CONTINUE TO NEXT STEP →" button available
  // 3: Step 3 active
  // 3.5: Step 3 completed, "CONTINUE TO NEXT STEP →" button available
  // 4: Step 4 active
  // 4.5: Step 4 completed, "CONTINUE TO NEXT STEP →" button available
  // 5: Step 5 active
  // 6: Final Case Summary (All 5 steps completed & expandable)
  // =========================================================================
  const [workflowStage, setWorkflowStage] = useState<number>(1);
  const [completedSteps, setCompletedSteps] = useState<number[]>([]);
  const [expandedCompletedSteps, setExpandedCompletedSteps] = useState<{ [key: number]: boolean }>({});

  // Persistent Case State (accumulated across steps)
  /* G2: the application used to open already displaying a benchmark case,
   * so the very first render showed findings nobody had ingested. It now
   * opens on an empty, honestly-labelled case. */
  const [caseState, setCaseState] = useState<PersistentCaseState>(() =>
    buildCaseState(EMPTY_INTAKE, null)
  );

  // Set while the analyse request is in flight, so Step 1 can show a real,
  // cancellable spinner rather than an instant transition to fabricated data.
  const [isAnalysing, setIsAnalysing] = useState(false);
  const analyseAbortRef = useRef<AbortController | null>(null);
  /* Distinguishes "the investigator pressed Cancel" from "the context call
   * failed on its own". Both surface as an aborted fetch, but only the
   * second may proceed on detector evidence alone — advancing a workflow
   * somebody just cancelled would be its own kind of dishonesty. */
  const analyseCancelledRef = useRef(false);

  /* The last submitted intake, kept so the error card's Retry button can
   * re-fire the exact same request. A retry that made the investigator
   * re-enter the claimed context would not get used during a demonstration. */
  const lastAttemptRef = useRef<{
    intake: MediaIntakeData;
    imageBase64: string;
    mimeType: string;
  } | null>(null);
  const [canRetryAnalysis, setCanRetryAnalysis] = useState(false);

  // Modal State
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Subtle Step Completion Feedback Toast (1-2s notification)
  const [stepFeedbackToast, setStepFeedbackToast] = useState<string | null>(null);

  const triggerStepFeedback = (msg: string) => {
    setStepFeedbackToast(msg);
    setTimeout(() => {
      setStepFeedbackToast((current) => (current === msg ? null : current));
    }, 2200);
  };

  // =========================================================================
  // BROWSER HISTORY NAVIGATION
  // Syncs appView state with browser history for Back/Forward button support.
  // =========================================================================
  const isPopStateNavigation = useRef(false);

  // Navigate to a new view, pushing a browser history entry
  const navigate = useCallback((view: AppView, extraState?: Record<string, unknown>) => {
    setAppView(view);
    const state = { view, ...extraState };
    window.history.pushState(state, '', `#${view}`);
  }, []);

  // Navigate back using browser history (used for "Back" buttons)
  const navigateBack = useCallback(() => {
    window.history.back();
  }, []);

  // Replace current history entry (used for logout to prevent forward-nav)
  const navigateReplace = useCallback((view: AppView) => {
    setAppView(view);
    window.history.replaceState({ view }, '', `#${view}`);
  }, []);

  // Listen for browser Back/Forward button
  useEffect(() => {
    const handlePopState = (event: PopStateEvent) => {
      isPopStateNavigation.current = true;
      const state = event.state as { view?: AppView; activeCaseId?: string } | null;
      if (state?.view) {
        // For auth-gated views, check if investigator is still logged in
        const authGatedViews: AppView[] = ['home', 'profile', 'investigation'];
        if (authGatedViews.includes(state.view) && !investigator) {
          // Can't restore auth-gated view without login, go to welcome
          setAppView('welcome');
          window.history.replaceState({ view: 'welcome' }, '', '#welcome');
        } else {
          setAppView(state.view);
        }
      } else {
        // Fallback: parse from hash
        const hash = window.location.hash.replace('#', '') as AppView;
        const validViews: AppView[] = ['welcome', 'login', 'home', 'profile', 'investigation'];
        if (validViews.includes(hash)) {
          const authGatedViews: AppView[] = ['home', 'profile', 'investigation'];
          if (authGatedViews.includes(hash) && !investigator) {
            setAppView('welcome');
            window.history.replaceState({ view: 'welcome' }, '', '#welcome');
          } else {
            setAppView(hash);
          }
        } else {
          setAppView('welcome');
        }
      }
      isPopStateNavigation.current = false;
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [investigator]);

  // Set initial history entry on mount
  useEffect(() => {
    window.history.replaceState({ view: appView }, '', `#${appView}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync state changes to current investigator's saved cases
  const syncActiveCase = (
    updatedState: PersistentCaseState,
    stage: number,
    doneSteps: number[],
    caseId: string
  ) => {
    if (!investigator) return;
    setSavedCases((prevCases) => {
      const currentStepNum = Math.min(5, Math.max(1, Math.floor(stage)));
      const isComplete = stage >= 6 || doneSteps.length === 5;
      const status = isComplete ? 'Completed / Dossier Ready' : 'Investigation in progress';
      const existingIndex = prevCases.findIndex((c) => c.id === caseId);

      const title =
        updatedState.ingest.title && updatedState.ingest.title !== 'Unassigned Media Ingest'
          ? updatedState.ingest.title
          : updatedState.ingest.fileName || `Case #${caseId}`;

      const updatedSavedCase: SavedCase = {
        id: caseId,
        title,
        lastUpdated: 'Just now',
        currentStepNumber: currentStepNum,
        workflowStage: stage,
        completedSteps: doneSteps,
        expandedCompletedSteps: {},
        status,
        caseState: updatedState,
        investigatorId: investigator.id,
      };

      let nextCases: SavedCase[];
      if (existingIndex >= 0) {
        nextCases = [...prevCases];
        nextCases[existingIndex] = updatedSavedCase;
      } else {
        nextCases = [updatedSavedCase, ...prevCases];
      }
      // G18: a failed write is surfaced, never logged and forgotten.
      const failure = saveCasesToStorage(investigator.id, nextCases);
      if (failure) setErrorMessage(failure);
      return nextCases;
    });
  };

  const toggleExpandedStep = (stepNumber: number) => {
    setExpandedCompletedSteps((prev) => ({
      ...prev,
      [stepNumber]: !prev[stepNumber],
    }));
  };

  // --- NAVIGATION & AUTH ACTIONS ---

  const handleStartFromWelcome = () => {
    navigate('login');
  };

  const handleLogin = (email: string, name?: string) => {
    const profile: InvestigatorProfile = {
      id: `INV-${Math.floor(1000 + Math.random() * 9000)}`,
      name: name || email.split('@')[0].toUpperCase(),
      officialEmail: email,
      departmentUnit: 'Special Cyber Forensics & Media Integrity Unit',
      activeCasesCount: 1,
      completedCasesCount: 0,
      recentActivity: [
        {
          id: 'ACT-INIT',
          caseId: 'ANM-0147',
          description: `Investigator session initialized for ${email}`,
          timestamp: 'Just now',
        },
      ],
    };
    setInvestigator(profile);
    const initialCases = loadSavedCasesFromStorage(profile.id);
    setSavedCases(initialCases);
    navigate('home');
  };

  const handleContinueDemo = () => {
    setInvestigator(DEMO_INVESTIGATOR);
    const initialCases = loadSavedCasesFromStorage(DEMO_INVESTIGATOR.id);
    setSavedCases(initialCases);
    navigate('home');
  };

  const handleLogout = () => {
    setInvestigator(null);
    // Use replaceState to prevent forward-navigating back to auth pages
    navigateReplace('welcome');
  };

  // --- CASE WORKSPACE ACTIONS ---

  const handleOpenCase = (savedCase: SavedCase) => {
    setActiveCaseId(savedCase.id);
    setCaseState(savedCase.caseState);
    setWorkflowStage(savedCase.workflowStage);
    setCompletedSteps(savedCase.completedSteps);
    setExpandedCompletedSteps(savedCase.expandedCompletedSteps || {});
    navigate('investigation', { activeCaseId: savedCase.id });
  };

  const handleNewInvestigation = () => {
    if (!investigator) return;
    const newIdNum = Math.floor(100 + Math.random() * 900);
    const newId = `ANM-0${newIdNum}`;

    const newIntake: MediaIntakeData = {
      evidenceId: newId,
      title: `Case #${newId} (New Intake)`,
      mediaType: 'video',
      mediaUrl: '',
      previewUrl: '',
      fileName: '',
      fileSize: 0,
      fileHashSha256: '',
      claimedLocation: '',
      claimedDateTime: '',
      claimedNarrative: '',
      sourcePlatform: 'X (Twitter)',
      uploadTimestamp: new Date().toISOString(),
    };

    /* A new case has no media and no analysis, so it is exactly what the
     * adapter's null branch describes. Hand-rolling it here previously
     * fabricated a set of findings for an empty case — including a green
     * "audio consistent" tick on a case with no audio in it. */
    const newEmptyCaseState: PersistentCaseState = buildCaseState(newIntake, null);

    const newSavedCase: SavedCase = {
      id: newId,
      title: `Case #${newId}`,
      lastUpdated: 'Just now',
      currentStepNumber: 1,
      workflowStage: 1,
      completedSteps: [],
      status: 'Investigation in progress',
      caseState: newEmptyCaseState,
      investigatorId: investigator.id,
    };

    const updatedList = [newSavedCase, ...savedCases];
    setSavedCases(updatedList);
    const failure = saveCasesToStorage(investigator.id, updatedList);
    if (failure) setErrorMessage(failure);

    // Update active investigation state
    setActiveCaseId(newId);
    setCaseState(newEmptyCaseState);
    setWorkflowStage(1);
    setCompletedSteps([]);
    setExpandedCompletedSteps({});
    navigate('investigation', { activeCaseId: newId });
  };

  // --- STEP COMPLETE HANDLERS ---

  /* STEP 1 COMPLETE HANDLER — the ingest path.
   *
   * G22: the second argument is consumed. Step1Ingest has always passed the
   *      base64 payload; this handler used to declare one parameter and drop
   *      it, which is why no image ever reached the model.
   * G1:  the analyse route is actually called.
   * G2:  there is no fallback report and no benchmark lookup. A failure
   *      produces a visible error and a case carrying only real local
   *      measurements — never a stored report about someone else's file.
   */
  const handleStep1Complete = async (
    intake: MediaIntakeData,
    imageBase64?: string,
    mimeType?: string
  ) => {
    setErrorMessage(null);
    setCanRetryAnalysis(false);

    // Demo Mode: a precomputed reference case, entered deliberately and
    // badged as such in Step 1. It performs no network call by design.
    const precomputed = BENCHMARK_CASES.find((b) => b.intake.evidenceId === intake.evidenceId);
    if (precomputed && !imageBase64) {
      const demoState = buildCaseState(intake, precomputed.precomputedReport);
      const done = Array.from(new Set([...completedSteps, 1]));
      setCaseState(demoState);
      setCompletedSteps(done);
      setWorkflowStage(1.5);
      soundFx.playStepCompletion();
      triggerStepFeedback('STEP 1: Reference case loaded (precomputed).');
      syncActiveCase(demoState, 1.5, done, activeCaseId);
      return;
    }

    if (!imageBase64 || !mimeType) {
      setErrorMessage(
        'No media was read from the file. Re-select it and wait for the hash to finish computing.'
      );
      return;
    }

    lastAttemptRef.current = { intake, imageBase64, mimeType };

    const controller = new AbortController();
    analyseAbortRef.current = controller;
    analyseCancelledRef.current = false;
    setIsAnalysing(true);

    /* Declared out here so the failure path below can keep whatever the
     * detectors managed to measure. A case that loses its context call
     * should not also lose its measurements. */
    let evidence: DetectorEvidence = { attempted: true };

    try {
      /* A full-resolution phone photograph does not fit the request
        * deadline: measured at 32.1s for a 1.73 MB payload against 16.2s
        * for the same scene bounded to 1568px. Only this copy is resized —
        * the hash, the EXIF and the forensic canvas all use the original
        * bytes. */
      const prepared = await prepareImageForModel(imageBase64, mimeType);

      /* THREE INDEPENDENT MEASUREMENTS, RUN TOGETHER.
       *
       *   Detector B  signal forensics, in this browser, over the ORIGINAL
       *               bytes. Its statistics are the whole point and must not
       *               describe a resized copy.
       *   Detector A  a pretrained classifier via the server proxy, on the
       *               bounded copy, which is all it needs.
       *   Gemini      the context questions and the narrative. It no longer
       *               supplies a number that reaches the classifier.
       *
       * allSettled, not all: these three fail for entirely unrelated
       * reasons, and one failing must not discard the other two. */
      const [signalOutcome, syntheticOutcome, reportOutcome] = await Promise.allSettled([
        computeForensicStatistics(imageBase64),
        detectSynthetic(
          { imageBase64: prepared.dataUrl, mimeType: prepared.mimeType },
          { signal: controller.signal }
        ),
        analyzeMedia(toAnalyzeRequest(intake, prepared.dataUrl, prepared.mimeType), {
          signal: controller.signal,
        }),
      ]);

      const statistics = signalOutcome.status === 'fulfilled' ? signalOutcome.value : null;
      evidence = {
        attempted: true,
        signal: statistics
          ? deriveSignalFindings(statistics, {
              exifData: intake.exifData,
              mimeType,
            }) ?? undefined
          : undefined,
        synthetic: syntheticOutcome.status === 'fulfilled' ? syntheticOutcome.value : undefined,
      };

      /* A detector that could not run is stated, not hidden. The case is
       * still usable — it simply carries NOT_ASSESSED where that detector's
       * number would have been. */
      const detectorGaps: string[] = [];
      if (!evidence.signal) {
        detectorGaps.push(
          `Signal forensics could not measure this file${
            statistics?.unusableReason ? ` (${statistics.unusableReason})` : ''
          }.`
        );
      }
      if (!evidence.synthetic) {
        const reason =
          syntheticOutcome.status === 'rejected' && syntheticOutcome.reason instanceof ApiError
            ? ` (${syntheticOutcome.reason.message})`
            : '';
        detectorGaps.push(`The synthetic-image detector did not return a score${reason}.`);
      } else if (!isAssessed(evidence.synthetic.syntheticProbabilityScore)) {
        detectorGaps.push(
          evidence.synthetic.note ?? 'The synthetic-image detector returned no usable score.'
        );
      }

      if (reportOutcome.status === 'rejected') {
        /* The context call failed. If the investigator cancelled, or the
         * detectors have nothing either, this is an ordinary failure and
         * goes to the catch below. */
        if (analyseCancelledRef.current || !evidence.signal) {
          throw reportOutcome.reason;
        }

        /* Otherwise: detection succeeded and only the interpretation is
         * missing. This is the case the split was built for — the numbers on
         * screen are measured, and the panels the model would have filled
         * show the gap. The workflow may advance, because a real analysis
         * did run; the message says exactly which half is absent. */
        const partialState = buildCaseState(intake, null, evidence);
        const donePartial = Array.from(new Set([...completedSteps, 1]));
        const contextError =
          reportOutcome.reason instanceof ApiError
            ? reportOutcome.reason.message
            : 'The context analysis could not be completed.';

        setCaseState(partialState);
        setCompletedSteps(donePartial);
        setWorkflowStage(1.5);
        setCanRetryAnalysis(true);
        setErrorMessage(
          [
            `Context analysis unavailable: ${contextError}`,
            'Detection completed. The manipulation confidence, compression history and metadata flag on this case were measured in this browser. The location, date and narrative checks are NOT ASSESSED — retry to fill them in.',
            ...detectorGaps,
          ].join(' ')
        );
        soundFx.playStepCompletion();
        triggerStepFeedback('STEP 1: Detection complete; context unavailable.');
        syncActiveCase(partialState, 1.5, donePartial, activeCaseId);
        return;
      }

      const analysedState = buildCaseState(intake, reportOutcome.value, evidence);
      const done = Array.from(new Set([...completedSteps, 1]));
      setCaseState(analysedState);
      setCompletedSteps(done);
      setWorkflowStage(1.5);
      if (detectorGaps.length) {
        setErrorMessage(detectorGaps.join(' '));
        setCanRetryAnalysis(true);
      }
      soundFx.playStepCompletion();
      triggerStepFeedback('STEP 1: Media ingested and analysed.');
      syncActiveCase(analysedState, 1.5, done, activeCaseId);
    } catch (err) {
      /* The honest failure state. The hash, the EXIF tags and the claimed
       * context are real and are kept; everything interpretive is
       * NOT_ASSESSED. The workflow does NOT advance — an un-analysed case
       * must not present itself as a completed step. */
      const apiError = err instanceof ApiError ? err : null;
      const message = apiError?.message ?? 'The analysis could not be completed.';

      /* The local measurements survive a failed call, and saying so matters:
       * the investigator still has a real hash and real EXIF, which is a
       * usable result rather than a dead end. */
      setErrorMessage(
        apiError?.isRetryable
          ? `${message} The SHA-256 and metadata were measured in this browser and are unaffected.`
          : message
      );
      setCanRetryAnalysis(Boolean(apiError?.isRetryable));

      const localOnlyState = buildCaseState(intake, null, evidence);
      setCaseState(localOnlyState);
      syncActiveCase(localOnlyState, workflowStage, completedSteps, activeCaseId);
    } finally {
      setIsAnalysing(false);
      analyseAbortRef.current = null;
      analyseCancelledRef.current = false;
    }
  };

  const handleCancelAnalysis = () => {
    analyseCancelledRef.current = true;
    analyseAbortRef.current?.abort();
  };

  /** Re-run the last analysis with the identical payload. */
  const handleRetryAnalysis = () => {
    const attempt = lastAttemptRef.current;
    if (!attempt || isAnalysing) return;
    void handleStep1Complete(attempt.intake, attempt.imageBase64, attempt.mimeType);
  };

  // STEP 2 COMPLETE HANDLER
  const handleStep2Complete = () => {
    const updatedDone = Array.from(new Set([...completedSteps, 2]));
    setCompletedSteps(updatedDone);
    setWorkflowStage(2.5);
    soundFx.playStepCompletion();
    triggerStepFeedback('STEP 2: Analysis complete.');
    syncActiveCase(caseState, 2.5, updatedDone, activeCaseId);
  };

  // STEP 3 COMPLETE HANDLER
  const handleStep3Complete = () => {
    const updatedDone = Array.from(new Set([...completedSteps, 3]));
    setCompletedSteps(updatedDone);
    setWorkflowStage(3.5);
    soundFx.playStepCompletion();
    triggerStepFeedback('STEP 3: Media family identified.');
    syncActiveCase(caseState, 3.5, updatedDone, activeCaseId);
  };

  // STEP 4 COMPLETE HANDLER
  const handleStep4Complete = () => {
    const updatedDone = Array.from(new Set([...completedSteps, 4]));
    setCompletedSteps(updatedDone);
    setWorkflowStage(4.5);
    soundFx.playStepCompletion();
    triggerStepFeedback('STEP 4: Investigation complete.');
    syncActiveCase(caseState, 4.5, updatedDone, activeCaseId);
  };

  // STEP 5 FINALIZE HANDLER
  const handleStep5Finalize = () => {
    const updatedDone = Array.from(new Set([...completedSteps, 5]));
    setCompletedSteps(updatedDone);
    setWorkflowStage(5.5); // Show Investigation Complete Moment
    soundFx.playStepCompletion();
    triggerStepFeedback('STEP 5: Forensic package ready.');
    syncActiveCase(caseState, 5.5, updatedDone, activeCaseId);
  };

  // Step progression update with sync
  const handleAdvanceWorkflowStage = (nextStage: number) => {
    setWorkflowStage(nextStage);
    syncActiveCase(caseState, nextStage, completedSteps, activeCaseId);
  };

  /* Adapter for the Dossier Export Modal: view model back out to the dossier
   * shape. Every value is copied from caseState; nothing is authored here.
   * Optional blocks are omitted when nothing in them was assessed, so the
   * exported PDF shows a gap rather than a default. */
  const exportedMetrics: Partial<TechnicalForensicMetrics> = {};
  if (isAssessed(caseState.analysis.manipulation.syntheticProbabilityScore)) {
    exportedMetrics.synthetic_probability_score = caseState.analysis.manipulation.syntheticProbabilityScore;
  }
  if (isAssessed(caseState.analysis.manipulation.manipulationConfidence)) {
    exportedMetrics.manipulation_confidence = caseState.analysis.manipulation.manipulationConfidence;
  }
  if (isAssessed(caseState.analysis.structural.compressionGenerations)) {
    exportedMetrics.compression_generations = caseState.analysis.structural.compressionGenerations;
  }
  if (isAssessed(caseState.analysis.structural.metadataTamperFlag)) {
    exportedMetrics.metadata_tamper_flag = caseState.analysis.structural.metadataTamperFlag;
  }

  const scene = caseState.report.digitalCrimeScene;
  const exportReport: ExportableDossier = {
    case_summary: {
      evidence_id: caseState.ingest.evidenceId,
      primary_hash_sha256: caseState.ingest.fileHashSha256 || NOT_ASSESSED,
      verdict_summary: caseState.investigation.contextCheck.summary,
    },
    // The wire key names matter: the modal reads what_changed and
    // how_it_spread. Passing `what` and `how` silently dropped questions
    // 4 and 5 from every exported dossier.
    the_five_questions: {
      who: scene.who,
      where: scene.where,
      when: scene.when,
      what_changed: scene.what,
      how_it_spread: scene.how,
    },
    forensic_replay_timeline: caseState.investigation.forensicReplay,
    context_integrity_check: {
      raw_media_status: caseState.investigation.contextCheck.rawMediaStatus,
      claimed_location_status: caseState.investigation.contextCheck.claimedLocationStatus,
      claimed_time_status: caseState.investigation.contextCheck.claimedTimeStatus,
      audio_integrity_status: caseState.investigation.contextCheck.audioStatus,
    },
    investigator_notes: caseState.investigation.contextCheck.summary,
    ...(Object.keys(exportedMetrics).length > 0 ? { technical_metrics: exportedMetrics } : {}),
    ...(isAssessed(caseState.investigation.originEcho)
      ? { origin_echo: caseState.investigation.originEcho }
      : {}),
    /* Always present. The assessment reports its own inconclusive state
     * rather than being omitted, so the dossier never goes silent about
     * whether manipulation type was considered. */
    manipulation_assessment: getManipulationAssessment(caseState),
  };

  return (
    <div className="min-h-screen bg-[#06060a] text-zinc-100 font-sans selection:bg-purple-600 selection:text-white flex flex-col relative overflow-x-hidden transition-colors duration-200">
      {/* Ambient background glow */}
      <div className="ambient-glow-purple fixed top-0 left-1/4 w-[600px] h-[350px] bg-purple-900/10 rounded-full blur-[140px] pointer-events-none -z-10" />
      <div className="ambient-glow-blue fixed bottom-0 right-10 w-[450px] h-[300px] bg-blue-900/10 rounded-full blur-[140px] pointer-events-none -z-10" />

      {/* COMPACT APPLICATION HEADER (Always shown with top-right theme changer) */}
      <Navbar
        isWelcome={appView === 'welcome'}
        caseId={appView === 'investigation' ? activeCaseId : undefined}
        hasStartedCase={appView === 'investigation'}
        onGoToCases={investigator ? () => navigate('home') : undefined}
        onNewCase={investigator ? handleNewInvestigation : undefined}
        onGoToProfile={investigator ? () => navigate('profile') : undefined}
        onLogout={investigator ? handleLogout : undefined}
      />

      {/* MAIN CONTAINER */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* VIEW 1: WELCOME SCREEN */}
        {appView === 'welcome' && (
          <StartScreen onStart={handleStartFromWelcome} />
        )}

        {/* VIEW 2: INVESTIGATOR LOGIN */}
        {appView === 'login' && (
          <LoginScreen
            onLogin={handleLogin}
            onContinueDemo={handleContinueDemo}
          />
        )}

        {/* VIEW 3: INVESTIGATOR HOME (MY CASES WORKSPACE) */}
        {appView === 'home' && investigator && (
          <InvestigatorHome
            investigator={investigator}
            cases={savedCases}
            onOpenCase={handleOpenCase}
            onNewInvestigation={handleNewInvestigation}
            onViewProfile={() => navigate('profile')}
          />
        )}

        {/* VIEW 4: INVESTIGATOR PROFILE */}
        {appView === 'profile' && investigator && (
          <InvestigatorProfileView
            investigator={investigator}
            cases={savedCases}
            onBackToCases={() => navigateBack()}
            onNewInvestigation={handleNewInvestigation}
            onOpenCase={handleOpenCase}
          />
        )}

        {/* VIEW 5: 5-STEP INVESTIGATION */}
        {appView === 'investigation' && (
          <div className="space-y-4">
            {/* Header info bar for active case */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 rounded-xl bg-zinc-950/80 border border-zinc-800/80 font-mono text-xs">
              <div className="flex items-center gap-2">
                <span className="text-zinc-400">ACTIVE INVESTIGATION:</span>
                <span className="font-bold text-purple-300">CASE #{activeCaseId}</span>
                <span className="text-zinc-600">•</span>
                <span className="text-zinc-400 truncate max-w-xs">{caseState.ingest.title || caseState.ingest.fileName || 'Pending Ingest'}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-[11px] text-zinc-500">
                  {workflowStage >= 6 ? 'Dossier Sealed' : `Step ${Math.min(5, Math.floor(workflowStage))} in progress`}
                </span>
                <button
                  onClick={() => navigateBack()}
                  className="text-purple-400 hover:text-purple-300 font-bold underline cursor-pointer"
                >
                  ← Back to My Cases
                </button>
              </div>
            </div>

            {/* Error Alert Banner if any */}
            {errorMessage && (
              <div className="rounded-2xl border border-rose-500/50 bg-rose-950/60 p-4 flex items-center gap-3 text-rose-300 font-mono text-xs shadow-lg">
                <AlertCircle className="w-5 h-5 text-rose-400 shrink-0" />
                <div className="flex-1">
                  <strong className="block text-rose-200">ALERT:</strong>
                  <span>{errorMessage}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {canRetryAnalysis && (
                    <button
                      onClick={handleRetryAnalysis}
                      disabled={isAnalysing}
                      className="px-3 py-1 rounded-lg bg-rose-100 hover:bg-white text-rose-950 border border-rose-200 font-bold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      RETRY
                    </button>
                  )}
                  <button
                    onClick={() => {
                      setErrorMessage(null);
                      setCanRetryAnalysis(false);
                    }}
                    className="px-3 py-1 rounded-lg bg-rose-900/80 hover:bg-rose-800 text-rose-100 border border-rose-700/60 font-bold cursor-pointer"
                  >
                    DISMISS
                  </button>
                </div>
              </div>
            )}

            {/* Demo Mode. A precomputed reference case is labelled wherever
                it is shown, not just on the step that loaded it. */}
            {caseState.ingest.isPrecomputed && (
              <div className="rounded-2xl border border-amber-500/50 bg-amber-950/40 p-3 flex items-center gap-3 text-amber-200 font-mono text-xs shadow-lg">
                <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
                <div className="flex-1">
                  <strong className="block text-amber-100">PRECOMPUTED REFERENCE CASE</strong>
                  <span className="text-amber-300/90 font-sans">
                    These findings are a stored fixture used to demonstrate the
                    workflow offline. They were not produced by analysing a file
                    you supplied.
                  </span>
                </div>
              </div>
            )}

            {/* Analysis in flight. Real request, real 30s abort, cancellable. */}
            {isAnalysing && (
              <div className="rounded-2xl border border-purple-500/50 bg-purple-950/40 p-4 flex items-center gap-3 text-purple-200 font-mono text-xs shadow-lg">
                <span className="w-4 h-4 rounded-full border-2 border-purple-400 border-t-transparent animate-spin shrink-0" />
                <div className="flex-1">
                  <strong className="block text-purple-100">ANALYSING EVIDENCE</strong>
                  <span className="text-purple-300 font-sans">
                    The image and your claimed context have been sent for interpretation. Times out after 30 seconds.
                  </span>
                </div>
                <button
                  onClick={handleCancelAnalysis}
                  className="px-3 py-1 rounded-lg bg-purple-900/80 hover:bg-purple-800 text-purple-100 border border-purple-700/60 font-bold cursor-pointer"
                >
                  CANCEL
                </button>
              </div>
            )}

            {/* Active Workflow Stage */}
            {workflowStage < 6 && (
              <div className="space-y-3">
                {/* Collapsed Step 1 */}
                {completedSteps.includes(1) && (
                  <CompactStepIndicator
                    stepNumber={1}
                    stepTitle="Media Ingested"
                    subtitle={`${caseState.ingest.fileName || 'Ingested Media'} (${caseState.ingest.evidenceId})`}
                    badgeText={`SHA-256: ${caseState.ingest.fileHashSha256 ? caseState.ingest.fileHashSha256.substring(0, 8) + '...' : 'SEALED'}`}
                    isExpanded={expandedCompletedSteps[1]}
                    onToggleExpand={() => toggleExpandedStep(1)}
                  >
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 font-mono text-xs">
                      <div className="p-2.5 rounded-lg bg-zinc-950 border border-zinc-800">
                        <span className="text-zinc-500 block text-[10px]">Location:</span>
                        <span className="text-zinc-200">{caseState.ingest.claimedLocation || 'Not specified'}</span>
                      </div>
                      <div className="p-2.5 rounded-lg bg-zinc-950 border border-zinc-800">
                        <span className="text-zinc-500 block text-[10px]">Date:</span>
                        <span className="text-zinc-200">{caseState.ingest.claimedDateTime || 'Not specified'}</span>
                      </div>
                      <div className="p-2.5 rounded-lg bg-zinc-950 border border-zinc-800">
                        <span className="text-zinc-500 block text-[10px]">Platform:</span>
                        <span className="text-zinc-200">{caseState.ingest.sourcePlatform || 'Not specified'}</span>
                      </div>
                    </div>
                  </CompactStepIndicator>
                )}

                {/* Active Step 1 */}
                {workflowStage === 1 && (
                  <Step1Ingest
                    isAnalysing={isAnalysing}
                    onComplete={handleStep1Complete}
                    initialIntake={caseState.ingest}
                  />
                )}

                {/* Step 1.5: Continue to Step 2 */}
                {workflowStage === 1.5 && (
                  <div className="p-4 rounded-xl bg-[#0d0d14] border border-purple-500/40 bg-purple-950/20 flex flex-col sm:flex-row items-center justify-between gap-3 shadow-md animate-fade-in font-mono text-xs">
                    <div className="flex items-center gap-2.5 text-purple-300">
                      <div className="w-6 h-6 rounded-full bg-purple-900 border border-purple-500 flex items-center justify-center text-purple-300 shrink-0">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                      </div>
                      <div>
                        <span className="font-bold text-white block">Step 1 Complete</span>
                        <span className="text-[10px] text-zinc-400">Media &amp; SHA-256 digest sealed into case state.</span>
                      </div>
                    </div>
                    <button
                      onClick={() => handleAdvanceWorkflowStage(2)}
                      id="btn-continue-step2"
                      className="py-2.5 px-5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold transition-all flex items-center gap-2 cursor-pointer shadow-md shrink-0"
                    >
                      <span>CONTINUE TO NEXT STEP →</span>
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>
                )}

                {/* Collapsed Step 2 */}
                {completedSteps.includes(2) && (
                  <CompactStepIndicator
                    stepNumber={2}
                    stepTitle="Analysis Complete"
                    subtitle="Signals, Indicators &amp; Completeness Logged"
                    badgeText={`${MANIPULATION_TYPE_SHORT[getManipulationAssessment(caseState).likelyType]} • ${formatAssessedPct(getManipulationAssessment(caseState).confidence)}`}
                    isExpanded={expandedCompletedSteps[2]}
                    onToggleExpand={() => toggleExpandedStep(2)}
                  >
                    <div className="space-y-3 font-mono text-xs">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div className="p-2.5 rounded-lg bg-zinc-950 border border-zinc-800">
                          <span className="text-purple-400 font-bold block text-[10px]">Visual Signals</span>
                          <span className="text-zinc-300 text-xs">
                            Lighting: {caseState.analysis.visual.lightingConsistency} | Chromatic: {caseState.analysis.visual.chromaticAberration}
                          </span>
                        </div>
                        <div className="p-2.5 rounded-lg bg-zinc-950 border border-zinc-800">
                          <span className="text-cyan-400 font-bold block text-[10px]">Structural &amp; Tampering</span>
                          <span className="text-zinc-300 text-xs">
                            {caseState.analysis.structural.compressionGenerations}x compression | Status: {caseState.analysis.manipulation.status}
                          </span>
                        </div>
                      </div>
                      <ManipulationAssessmentCard
                        assessment={getManipulationAssessment(caseState)}
                        compact
                      />
                    </div>
                  </CompactStepIndicator>
                )}

                {/* Active Step 2 */}
                {workflowStage === 2 && (
                  <Step2Analyse
                    caseState={caseState}
                    onUpdateCaseState={(updated) => {
                      setCaseState(updated);
                      syncActiveCase(updated, workflowStage, completedSteps, activeCaseId);
                    }}
                    onComplete={handleStep2Complete}
                  />
                )}

                {/* Step 2.5: Continue to Step 3 */}
                {workflowStage === 2.5 && (
                  <div className="p-4 rounded-xl bg-[#0d0d14] border border-cyan-500/40 bg-cyan-950/20 flex flex-col sm:flex-row items-center justify-between gap-3 shadow-md animate-fade-in font-mono text-xs">
                    <div className="flex items-center gap-2.5 text-cyan-300">
                      <div className="w-6 h-6 rounded-full bg-cyan-900 border border-cyan-500 flex items-center justify-center text-cyan-300 shrink-0">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                      </div>
                      <div>
                        <span className="font-bold text-white block">Step 2 Complete</span>
                        <span className="text-[10px] text-zinc-400">Forensic signals &amp; completeness assessment logged.</span>
                      </div>
                    </div>
                    <button
                      onClick={() => handleAdvanceWorkflowStage(3)}
                      id="btn-continue-step3"
                      className="py-2.5 px-5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold transition-all flex items-center gap-2 cursor-pointer shadow-md shrink-0"
                    >
                      <span>CONTINUE TO NEXT STEP →</span>
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>
                )}

                {/* Collapsed Step 3 */}
                {completedSteps.includes(3) && (
                  <CompactStepIndicator
                    stepNumber={3}
                    stepTitle="Lineage Connected"
                    subtitle={`${caseState.relationships.totalRelatedFound} Related Copies & Lineage Hierarchy`}
                    badgeText="LINEAGE MAPPED"
                    isExpanded={expandedCompletedSteps[3]}
                    onToggleExpand={() => toggleExpandedStep(3)}
                  >
                    <div className="p-2.5 rounded-lg bg-zinc-950 border border-zinc-800 font-mono text-xs text-zinc-300">
                      Sequence: Source (01) ➔ Crop (02) ➔ Watermark (03) ➔ Compression (04) ➔ <strong className="text-purple-300">Screen Record (05)</strong>
                    </div>
                  </CompactStepIndicator>
                )}

                {/* Active Step 3 */}
                {workflowStage === 3 && (
                  <Step3Connect
                    caseState={caseState}
                    onComplete={handleStep3Complete}
                  />
                )}

                {/* Step 3.5: Continue to Step 4 */}
                {workflowStage === 3.5 && (
                  <div className="p-4 rounded-xl bg-[#0d0d14] border border-emerald-500/40 bg-emerald-950/20 flex flex-col sm:flex-row items-center justify-between gap-3 shadow-md animate-fade-in font-mono text-xs">
                    <div className="flex items-center gap-2.5 text-emerald-300">
                      <div className="w-6 h-6 rounded-full bg-emerald-900 border border-emerald-500 flex items-center justify-center text-emerald-300 shrink-0">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                      </div>
                      <div>
                        <span className="font-bold text-white block">Step 3 Complete</span>
                        <span className="text-[10px] text-zinc-400">Derivative media family graph connected.</span>
                      </div>
                    </div>
                    <button
                      onClick={() => handleAdvanceWorkflowStage(4)}
                      id="btn-continue-step4"
                      className="py-2.5 px-5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold transition-all flex items-center gap-2 cursor-pointer shadow-md shrink-0"
                    >
                      <span>CONTINUE TO NEXT STEP →</span>
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>
                )}

                {/* Collapsed Step 4 */}
                {completedSteps.includes(4) && (
                  <CompactStepIndicator
                    stepNumber={4}
                    stepTitle="Investigation Complete"
                    subtitle="Replay, Origin Echo &amp; Context Decoupling Verified"
                    badgeText="CONTEXT DECOUPLED"
                    isExpanded={expandedCompletedSteps[4]}
                    onToggleExpand={() => toggleExpandedStep(4)}
                  >
                    <div className="p-2.5 rounded-lg bg-zinc-950 border border-zinc-800 font-mono text-xs text-zinc-300">
                      {caseState.investigation.contextCheck.summary}
                    </div>
                  </CompactStepIndicator>
                )}

                {/* Active Step 4 */}
                {workflowStage === 4 && (
                  <Step4Investigate
                    caseState={caseState}
                    onComplete={handleStep4Complete}
                  />
                )}

                {/* Step 4.5: Continue to Step 5 */}
                {workflowStage === 4.5 && (
                  <div className="p-4 rounded-xl bg-[#0d0d14] border border-amber-500/40 bg-amber-950/20 flex flex-col sm:flex-row items-center justify-between gap-3 shadow-md animate-fade-in font-mono text-xs">
                    <div className="flex items-center gap-2.5 text-amber-300">
                      <div className="w-6 h-6 rounded-full bg-amber-900 border border-amber-500 flex items-center justify-center text-amber-300 shrink-0">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                      </div>
                      <div>
                        <span className="font-bold text-white block">Step 4 Complete</span>
                        <span className="text-[10px] text-zinc-400">Forensic Replay, Origin Echo &amp; Decoupling verified.</span>
                      </div>
                    </div>
                    <button
                      onClick={() => handleAdvanceWorkflowStage(5)}
                      id="btn-continue-step5"
                      className="py-2.5 px-5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold transition-all flex items-center gap-2 cursor-pointer shadow-md shrink-0"
                    >
                      <span>CONTINUE TO NEXT STEP →</span>
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>
                )}

                {/* Active Step 5 */}
                {workflowStage === 5 && (
                  <Step5Report
                    caseState={caseState}
                    onOpenReportModal={() => setIsExportModalOpen(true)}
                    onFinalize={handleStep5Finalize}
                  />
                )}

                {/* Step 5.5: Final Investigation Complete Moment */}
                {workflowStage === 5.5 && (
                  <InvestigationCompleteMoment
                    caseId={activeCaseId}
                    onViewCompleteCase={() => handleAdvanceWorkflowStage(6)}
                  />
                )}
              </div>
            )}

            {/* Step 6: Full Connected Investigation View (Shown ONLY after Step 5 finalize) */}
            {workflowStage === 6 && (
              <FinalConnectedInvestigation
                caseState={caseState}
                onOpenReportModal={() => setIsExportModalOpen(true)}
                onResetCase={handleNewInvestigation}
              />
            )}
          </div>
        )}
      </main>

      {/* Subtle Step Completion Toast (1-2s confirmation) */}
      {stepFeedbackToast && (
        <div className="fixed top-16 right-6 z-50 animate-bounce duration-300">
          <div className="px-4 py-2.5 rounded-xl bg-zinc-950/95 border border-purple-500/80 text-white font-mono text-xs font-bold shadow-2xl shadow-purple-950/80 flex items-center gap-2.5 backdrop-blur-md">
            <div className="w-4 h-4 rounded-full bg-purple-900 border border-purple-400 flex items-center justify-center text-purple-200 text-[10px]">
              ✓
            </div>
            <span>{stepFeedbackToast}</span>
          </div>
        </div>
      )}

      {/* Compact Forensic Footer */}
      <footer className="border-t border-zinc-900 bg-[#06060a] px-6 py-3 mt-auto">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2 text-[11px] font-mono text-zinc-400">
          <div className="flex items-center gap-2">
            <span className="font-bold text-white">ANAMNESIS</span>
            <span className="text-zinc-400">| Digital Crime-Scene Intelligence</span>
          </div>
          <div className="flex items-center gap-2 text-zinc-400">
            <Lock className="w-3 h-3 text-purple-400" />
            <span>INVESTIGATOR ASSISTANCE • AI-assisted findings • Human verification</span>
          </div>
        </div>
      </footer>

      {/* Dossier Export Modal */}
      <DossierExportModal
        isOpen={isExportModalOpen}
        onClose={() => setIsExportModalOpen(false)}
        report={exportReport}
        intake={caseState.ingest}
      />
    </div>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AppContent />
    </ThemeProvider>
  );
}
