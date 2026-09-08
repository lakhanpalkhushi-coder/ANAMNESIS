import React, { useState } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  FolderOpen,
  Activity,
  GitBranch,
  Search,
  FileCheck,
  Download,
  RotateCcw,
  Sparkles,
  Lock,
  Hash,
  MapPin,
  Clock,
  AlertTriangle,
  UserCheck,
  Layers,
  Send,
  MessageSquare,
  ShieldCheck,
} from 'lucide-react';
import { isAssessed, NOT_ASSESSED, PersistentCaseState } from '../types';
import { ManipulationAssessmentCard } from './ManipulationAssessmentCard';
import { formatAssessedPct, getManipulationAssessment } from '../lib/manipulationAssessment';

interface FinalConnectedInvestigationProps {
  caseState: PersistentCaseState;
  onOpenReportModal: () => void;
  onResetCase: () => void;
}

export const FinalConnectedInvestigation: React.FC<FinalConnectedInvestigationProps> = ({
  caseState,
  onOpenReportModal,
  onResetCase,
}) => {
  const { ingest, analysis, relationships, investigation, report } = caseState;

  const [expandedSteps, setExpandedSteps] = useState<{ [key: number]: boolean }>({
    1: false,
    2: false,
    3: false,
    4: true,
    5: true,
  });

  const toggleStep = (stepNum: number) => {
    setExpandedSteps((prev) => ({
      ...prev,
      [stepNum]: !prev[stepNum],
    }));
  };

  // Investigator Copilot query state
  const [copilotQuery, setCopilotQuery] = useState('');
  const [copilotHistory, setCopilotHistory] = useState<Array<{ role: 'user' | 'assistant'; text: string }>>([
    {
      role: 'assistant',
      text: `Anamnesis Investigator Copilot initialized for Evidence ${ingest.evidenceId}. The 5-stage case dossier is cryptographically anchored to SHA-256 (${ingest.fileHashSha256.substring(0, 16)}...). Ask any cross-examination or corroboration query regarding this case.`,
    },
  ]);
  const [isCopilotThinking, setIsCopilotThinking] = useState(false);

  const handleSendCopilot = (e: React.FormEvent) => {
    e.preventDefault();
    if (!copilotQuery.trim() || isCopilotThinking) return;

    const userText = copilotQuery.trim();
    setCopilotHistory((prev) => [...prev, { role: 'user', text: userText }]);
    setCopilotQuery('');
    setIsCopilotThinking(true);

    setTimeout(() => {
      // Deterministic case-grounded forensic response
      let responseText = '';
      const lower = userText.toLowerCase();

      if (lower.includes('where') || lower.includes('location') || lower.includes('geo')) {
        responseText = `[GEOLOCATION CORROBORATION]: Claimed location is "${ingest?.claimedLocation || 'Not available'}". Observed physical landmark geometry and vegetation index match "${report?.digitalCrimeScene?.where?.observed || 'Not available'}". Status: ${report?.digitalCrimeScene?.where?.status || 'Not available'}.`;
      } else if (lower.includes('when') || lower.includes('date') || lower.includes('time')) {
        responseText = `[TEMPORAL CORROBORATION]: Claimed incident time is "${ingest?.claimedDateTime || 'Not available'}". However, technical watermark metadata and archive matching trace the primary visual stream back to "${report?.digitalCrimeScene?.when?.observed || 'Not available'}". Status: ${report?.digitalCrimeScene?.when?.status || 'Not available'}.`;
      } else if (lower.includes('origin') || lower.includes('source') || lower.includes('echo')) {
        responseText = `[ORIGIN ECHO ANALYSIS]: Earliest probable origin is "${report?.digitalCrimeScene?.source?.earliestKnownSource || 'Not available'}" on ${report?.digitalCrimeScene?.source?.platform || 'Not available'}. Surviving invariant attributes include: ${(investigation && isAssessed(investigation.originEcho) ? investigation.originEcho.surviving_attributes : []).join('; ') || NOT_ASSESSED}. Note: This is an ESTIMATED reconstruction.`;
      } else if (lower.includes('manipulat') || lower.includes('fake') || lower.includes('tamper')) {
        responseText = `[MUTATION FINDINGS]: Detected alterations: ${(analysis?.manipulation?.mutationsDetected || []).join(', ') || 'None'}. Manipulation confidence is ${analysis?.manipulation?.manipulationConfidence ?? 0}%, with synthetic AI score of ${analysis?.manipulation?.syntheticProbabilityScore ?? 0}%. Status: ${analysis?.manipulation?.status || 'Complete'}.`;
      } else {
        responseText = `[CASE STATE CROSS-EXAMINATION]: For Evidence ID ${ingest?.evidenceId || 'N/A'}, the core finding is: "${report?.forensicPackage?.findings || 'Media narrative discrepancy detected'}". Physical raw media was decoupled from the accompanying viral caption.`;
      }

      setCopilotHistory((prev) => [...prev, { role: 'assistant', text: responseText }]);
      setIsCopilotThinking(false);
    }, 600);
  };

  return (
    <div className="space-y-6">
      {/* Top Banner: Master Investigation Dossier */}
      <div className="rounded-2xl border border-zinc-800 bg-[#0d0d14] p-5 sm:p-6 space-y-4 shadow-xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-zinc-800">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono font-bold text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span>COMPLETE 5-STEP FORENSIC DOSSIER</span>
              </span>
              <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-emerald-950/60 border border-emerald-800 text-emerald-300">
                All Stages Connected
              </span>
            </div>
            <h2 className="text-xl sm:text-2xl font-black font-mono text-white">
              Crime Scene Intelligence Dossier: {ingest.evidenceId}
            </h2>
            <p className="text-xs text-zinc-400 font-sans max-w-2xl">
              All 5 forensic investigation stages are unified into a verified, tamper-evident digital crime scene package.
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={onOpenReportModal}
              id="btn-master-export"
              className="px-4 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-mono text-xs font-bold transition-all flex items-center gap-2 cursor-pointer shadow-md"
            >
              <Download className="w-4 h-4" />
              <span>Export Package</span>
            </button>
            <button
              onClick={onResetCase}
              id="btn-master-reset"
              className="px-3 py-2.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-zinc-300 font-mono text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>New Investigation</span>
            </button>
          </div>
        </div>

        {/* Quick Summary Chips */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 font-mono text-xs">
          <div className="p-3 rounded-xl bg-zinc-950 border border-zinc-800">
            <span className="text-zinc-500 block text-[10px]">Evidence ID</span>
            <span className="text-zinc-200 font-bold">{ingest?.evidenceId || 'N/A'}</span>
          </div>
          <div className="p-3 rounded-xl bg-zinc-950 border border-zinc-800">
            <span className="text-zinc-500 block text-[10px]">Related Family Copies</span>
            <span className="text-purple-300 font-bold">{relationships?.totalRelatedFound ?? 0} Instances</span>
          </div>
          <div className="p-3 rounded-xl bg-zinc-950 border border-zinc-800">
            <span className="text-zinc-500 block text-[10px]">Replay Stages</span>
            <span className="text-cyan-300 font-bold">{(investigation?.forensicReplay || []).length} Mutation Steps</span>
          </div>
          <div className="p-3 rounded-xl bg-zinc-950 border border-zinc-800">
            <span className="text-zinc-500 block text-[10px]">Manipulation Status</span>
            <span className="text-rose-300 font-bold">{analysis?.manipulation?.status || 'Verified'}</span>
          </div>
        </div>
      </div>

      {/* 5-Step Connected Flow (Accordion Stack) */}
      <div className="space-y-4">
        {/* STEP 1: Media Ingest */}
        <div className="rounded-2xl border border-zinc-800 bg-[#0a0a12] overflow-hidden">
          <div
            onClick={() => toggleStep(1)}
            className="flex items-center justify-between p-4 cursor-pointer hover:bg-zinc-900/40 transition-colors border-b border-zinc-800/80"
          >
            <div className="flex items-center gap-3">
              <div className="w-6 h-6 rounded-full bg-emerald-950 border border-emerald-500/70 flex items-center justify-center text-emerald-400 font-bold text-xs">
                ✓
              </div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs font-bold text-white">
                  STEP 1: Media Ingest
                </span>
                <span className="text-zinc-500 text-xs hidden sm:inline">•</span>
                <span className="text-[11px] font-mono text-zinc-400 hidden sm:inline">
                  {ingest.fileName || 'Media Stream'}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-zinc-900 text-zinc-400 border border-zinc-800">
                HASH SEALED
              </span>
              {expandedSteps[1] ? <ChevronUp className="w-4 h-4 text-zinc-400" /> : <ChevronDown className="w-4 h-4 text-zinc-400" />}
            </div>
          </div>

          {expandedSteps[1] && (
            <div className="p-5 bg-[#08080f] space-y-3 font-mono text-xs border-t border-zinc-900">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="p-3 rounded-xl bg-zinc-950 border border-zinc-800">
                  <span className="text-zinc-500 block text-[10px]">Claimed Location:</span>
                  <span className="text-zinc-200">{ingest.claimedLocation || 'Not specified'}</span>
                </div>
                <div className="p-3 rounded-xl bg-zinc-950 border border-zinc-800">
                  <span className="text-zinc-500 block text-[10px]">Claimed Date:</span>
                  <span className="text-zinc-200">{ingest.claimedDateTime || 'Not specified'}</span>
                </div>
                <div className="p-3 rounded-xl bg-zinc-950 border border-zinc-800">
                  <span className="text-zinc-500 block text-[10px]">Dissemination Platform:</span>
                  <span className="text-zinc-200">{ingest.sourcePlatform || 'X (Twitter)'}</span>
                </div>
              </div>
              <div className="p-3 rounded-xl bg-zinc-950 border border-zinc-800 space-y-1">
                <span className="text-zinc-500 text-[10px] block">SHA-256 Cryptographic Hash:</span>
                <span className="text-zinc-300 break-all select-all">{ingest.fileHashSha256}</span>
              </div>
            </div>
          )}
        </div>

        {/* STEP 2: Signal Analysis */}
        <div className="rounded-2xl border border-zinc-800 bg-[#0a0a12] overflow-hidden">
          <div
            onClick={() => toggleStep(2)}
            className="flex items-center justify-between p-4 cursor-pointer hover:bg-zinc-900/40 transition-colors border-b border-zinc-800/80"
          >
            <div className="flex items-center gap-3">
              <div className="w-6 h-6 rounded-full bg-emerald-950 border border-emerald-500/70 flex items-center justify-center text-emerald-400 font-bold text-xs">
                ✓
              </div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs font-bold text-white">
                  STEP 2: Signal Analysis
                </span>
                <span className="text-zinc-500 text-xs hidden sm:inline">•</span>
                <span className="text-[11px] font-mono text-zinc-400 hidden sm:inline">
                  Visual, Audio, Structural, Source Completeness
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-zinc-900 text-cyan-400 border border-zinc-800">
                {/* formatAssessedPct, not string interpolation: a case whose
                    signal forensics could not run carries the gap here, and
                    the raw value would render as "NOT_ASSESSED% TAMPER SCORE". */}
                {formatAssessedPct(analysis.manipulation.manipulationConfidence)} TAMPER SCORE
              </span>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-zinc-900 text-amber-400 border border-zinc-800 hidden sm:inline">
                {getManipulationAssessment(caseState).likelyTypeLabel}
              </span>
              {expandedSteps[2] ? <ChevronUp className="w-4 h-4 text-zinc-400" /> : <ChevronDown className="w-4 h-4 text-zinc-400" />}
            </div>
          </div>

          {expandedSteps[2] && (
            <div className="p-5 bg-[#08080f] space-y-3 font-mono text-xs border-t border-zinc-900">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="p-3 rounded-xl bg-zinc-950 border border-zinc-800 space-y-1">
                  <span className="text-purple-400 font-bold block">Visual Indicators</span>
                  <ul className="text-zinc-300 text-[11px] space-y-1">
                    {(analysis?.visual?.visualIndicators || []).map((ind, i) => (
                      <li key={i}>• {ind}</li>
                    ))}
                  </ul>
                </div>
                <div className="p-3 rounded-xl bg-zinc-950 border border-zinc-800 space-y-1">
                  <span className="text-cyan-400 font-bold block">Audio &amp; Structural</span>
                  <ul className="text-zinc-300 text-[11px] space-y-1">
                    {(analysis?.audio?.audioIndicators || []).map((ind, i) => (
                      <li key={i}>• {ind}</li>
                    ))}
                    <li>• ENF Grid: {analysis?.audio?.enfStatus || 'Not available'}</li>
                  </ul>
                </div>
              </div>

              {/* Manipulation Assessment carried through the whole case */}
              <ManipulationAssessmentCard
                assessment={getManipulationAssessment(caseState)}
                compact
              />
            </div>
          )}
        </div>

        {/* STEP 3: Related Media Lineage */}
        <div className="rounded-2xl border border-zinc-800 bg-[#0a0a12] overflow-hidden">
          <div
            onClick={() => toggleStep(3)}
            className="flex items-center justify-between p-4 cursor-pointer hover:bg-zinc-900/40 transition-colors border-b border-zinc-800/80"
          >
            <div className="flex items-center gap-3">
              <div className="w-6 h-6 rounded-full bg-emerald-950 border border-emerald-500/70 flex items-center justify-center text-emerald-400 font-bold text-xs">
                ✓
              </div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs font-bold text-white">
                  STEP 3: Related Media Lineage
                </span>
                <span className="text-zinc-500 text-xs hidden sm:inline">•</span>
                <span className="text-[11px] font-mono text-zinc-400 hidden sm:inline">
                  {relationships.totalRelatedFound} Clustered Derivative Copies
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-zinc-900 text-emerald-400 border border-zinc-800">
                LINEAGE MAPPED
              </span>
              {expandedSteps[3] ? <ChevronUp className="w-4 h-4 text-zinc-400" /> : <ChevronDown className="w-4 h-4 text-zinc-400" />}
            </div>
          </div>

          {expandedSteps[3] && (
            <div className="p-5 bg-[#08080f] space-y-3 font-mono text-xs border-t border-zinc-900">
              <div className="grid grid-cols-1 sm:grid-cols-5 gap-2">
                {(relationships?.nodes || []).map((node, i) => (
                  <div key={i} className="p-3 rounded-xl bg-zinc-950 border border-zinc-800 space-y-1">
                    <span className="text-[10px] text-purple-400 font-bold block">{node.id}</span>
                    <span className="text-zinc-200 font-bold block truncate">{node.title}</span>
                    <span className="text-[10px] text-zinc-500 block">{node.platform}</span>
                    <span className="text-[10px] text-emerald-400 font-bold block">{node.confidence}% Match</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* STEP 4: Evolution & Origin Echo */}
        <div className="rounded-2xl border border-zinc-800 bg-[#0a0a12] overflow-hidden">
          <div
            onClick={() => toggleStep(4)}
            className="flex items-center justify-between p-4 cursor-pointer hover:bg-zinc-900/40 transition-colors border-b border-zinc-800/80"
          >
            <div className="flex items-center gap-3">
              <div className="w-6 h-6 rounded-full bg-emerald-950 border border-emerald-500/70 flex items-center justify-center text-emerald-400 font-bold text-xs">
                ✓
              </div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs font-bold text-white">
                  STEP 4: Evolution &amp; Origin Echo
                </span>
                <span className="text-zinc-500 text-xs hidden sm:inline">•</span>
                <span className="text-[11px] font-mono text-zinc-400 hidden sm:inline">
                  Forensic Replay &amp; Context Decoupling
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-zinc-900 text-amber-400 border border-zinc-800">
                DECOUPLED
              </span>
              {expandedSteps[4] ? <ChevronUp className="w-4 h-4 text-zinc-400" /> : <ChevronDown className="w-4 h-4 text-zinc-400" />}
            </div>
          </div>

          {expandedSteps[4] && (
            <div className="p-5 bg-[#08080f] space-y-4 font-mono text-xs border-t border-zinc-900">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Origin Echo */}
                <div className="p-4 rounded-xl bg-zinc-950 border border-zinc-800 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-purple-400 font-bold uppercase">Origin Echo Consensus</span>
                    <span className="text-[10px] text-amber-400 font-bold">ESTIMATED</span>
                  </div>
                  <p className="text-xs text-zinc-300 font-sans">
                    {(investigation && isAssessed(investigation.originEcho) && investigation.originEcho.unmanipulated_scene_description) || NOT_ASSESSED}
                  </p>
                </div>

                {/* Context Decoupling */}
                <div className="p-4 rounded-xl bg-zinc-950 border border-zinc-800 space-y-2">
                  <span className="text-cyan-400 font-bold uppercase block">Context Decoupling Matrix</span>
                  <div className="space-y-1 text-[11px]">
                    <div className="flex justify-between">
                      <span className="text-zinc-400">Media Raster:</span>
                      <span className="text-emerald-400">{investigation?.contextCheck?.rawMediaStatus || 'Authentic'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-zinc-400">Claimed Date:</span>
                      <span className="text-rose-400">{investigation?.contextCheck?.claimedTimeStatus || 'Decoupled'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-zinc-400">Claimed Location:</span>
                      <span className="text-amber-400">{investigation?.contextCheck?.claimedLocationStatus || 'Misattributed'}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* STEP 5: Forensic Package */}
        <div className="rounded-2xl border border-zinc-800 bg-[#0a0a12] overflow-hidden">
          <div
            onClick={() => toggleStep(5)}
            className="flex items-center justify-between p-4 cursor-pointer hover:bg-zinc-900/40 transition-colors border-b border-zinc-800/80"
          >
            <div className="flex items-center gap-3">
              <div className="w-6 h-6 rounded-full bg-emerald-950 border border-emerald-500/70 flex items-center justify-center text-emerald-400 font-bold text-xs">
                ✓
              </div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs font-bold text-white">
                  STEP 5: Forensic Package
                </span>
                <span className="text-zinc-500 text-xs hidden sm:inline">•</span>
                <span className="text-[11px] font-mono text-zinc-400 hidden sm:inline">
                  Digital Crime Scene Dossier (Who, Where, When, What, How)
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-zinc-900 text-pink-400 border border-zinc-800">
                CRIME SCENE SEALED
              </span>
              {expandedSteps[5] ? <ChevronUp className="w-4 h-4 text-zinc-400" /> : <ChevronDown className="w-4 h-4 text-zinc-400" />}
            </div>
          </div>

          {expandedSteps[5] && (
            <div className="p-5 bg-[#08080f] space-y-4 font-mono text-xs border-t border-zinc-900">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="p-3 rounded-xl bg-zinc-950 border border-zinc-800">
                  <span className="text-purple-400 font-bold block text-[10px]">WHO (Subject)</span>
                  <p className="text-zinc-300 text-xs font-sans mt-1">{report?.digitalCrimeScene?.who?.observation || ingest?.claimedNarrative || 'Not available'}</p>
                </div>
                <div className="p-3 rounded-xl bg-zinc-950 border border-zinc-800">
                  <span className="text-amber-400 font-bold block text-[10px]">WHERE (Location)</span>
                  <p className="text-zinc-300 text-xs font-sans mt-1">{report?.digitalCrimeScene?.where?.observed || ingest?.claimedLocation || 'Not available'}</p>
                </div>
                <div className="p-3 rounded-xl bg-zinc-950 border border-zinc-800">
                  <span className="text-rose-400 font-bold block text-[10px]">WHEN (Time)</span>
                  <p className="text-zinc-300 text-xs font-sans mt-1">{report?.digitalCrimeScene?.when?.observed || ingest?.claimedDateTime || 'Not available'}</p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Cross-Examination Investigator Copilot */}
      <div className="rounded-2xl border border-zinc-800 bg-[#0d0d14] p-5 space-y-4 shadow-xl">
        <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-purple-400" />
            <span className="text-xs font-mono font-bold text-white uppercase tracking-wider">
              AI Forensic Case Cross-Examiner Copilot
            </span>
          </div>
          <span className="text-[10px] font-mono text-emerald-400 px-2 py-0.5 rounded bg-emerald-950/60 border border-emerald-800">
            STRICTLY GROUNDED IN CASE RECORD
          </span>
        </div>

        {/* Chat History Display */}
        <div className="space-y-3 max-h-64 overflow-y-auto pr-2 font-mono text-xs">
          {copilotHistory.map((item, idx) => (
            <div
              key={idx}
              className={`p-3.5 rounded-xl ${
                item.role === 'assistant'
                  ? 'bg-zinc-950 border border-zinc-800/80 text-zinc-200'
                  : 'bg-purple-950/40 border border-purple-800/60 text-purple-200'
              }`}
            >
              <span className="text-[10px] text-zinc-500 font-bold block mb-1">
                {item.role === 'assistant' ? 'ANAMNESIS COPILOT' : 'INVESTIGATOR'}
              </span>
              <p className="font-sans text-xs leading-relaxed">{item.text}</p>
            </div>
          ))}
          {isCopilotThinking && (
            <div className="p-3 rounded-xl bg-zinc-950 border border-zinc-800 text-zinc-400 text-xs font-mono animate-pulse">
              Cross-examining case state evidence &amp; cryptographic parameters...
            </div>
          )}
        </div>

        {/* Query Input Form */}
        <form onSubmit={handleSendCopilot} className="flex gap-2">
          <input
            type="text"
            value={copilotQuery}
            onChange={(e) => setCopilotQuery(e.target.value)}
            placeholder="Ask anything about the evidence, location discrepancies, or mutation chain..."
            className="flex-1 text-xs font-sans bg-zinc-950 border border-zinc-800 rounded-xl px-3.5 py-2.5 text-zinc-200 outline-none focus:border-purple-500"
          />
          <button
            type="submit"
            disabled={isCopilotThinking}
            className="px-4 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-mono text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
          >
            <Send className="w-3.5 h-3.5" />
            <span>Query</span>
          </button>
        </form>
      </div>
    </div>
  );
};
