/* Prototype authentication/storage only. Production deployment requires secure departmental identity, encryption, access control and audit logging. */

import React, { useState } from 'react';
import {
  FolderLock,
  PlusCircle,
  User,
  Clock,
  ArrowRight,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  FileCheck,
  ChevronDown,
} from 'lucide-react';
import { InvestigatorProfile, SavedCase } from '../types';
import { soundFx } from '../lib/soundFx';
import { getCaseProgressBadge } from '../lib/statusStyles';

interface InvestigatorHomeProps {
  investigator: InvestigatorProfile;
  cases: SavedCase[];
  onOpenCase: (savedCase: SavedCase) => void;
  onNewInvestigation: () => void;
  onViewProfile: () => void;
}

export const InvestigatorHome: React.FC<InvestigatorHomeProps> = ({
  investigator,
  cases,
  onOpenCase,
  onNewInvestigation,
  onViewProfile,
}) => {
  const [expandedCaseId, setExpandedCaseId] = useState<string | null>(null);

  const toggleCaseExpand = (id: string) => {
    setExpandedCaseId((prev) => (prev === id ? null : id));
  };

  const handleStartNew = () => {
    soundFx.playStartInvestigation();
    onNewInvestigation();
  };
  const getStepName = (stepNum: number) => {
    switch (stepNum) {
      case 1:
        return 'Step 1 — Ingest';
      case 2:
        return 'Step 2 — Analyse';
      case 3:
        return 'Step 3 — Connect';
      case 4:
        return 'Step 4 — Investigate';
      case 5:
        return 'Step 5 — Report';
      default:
        return `Step ${stepNum}`;
    }
  };

  return (
    <div className="space-y-6">
      {/* INVESTIGATOR HEADER CARD */}
      <div className="rounded-2xl border border-zinc-800 bg-[#0d0d14] p-5 sm:p-6 shadow-xl space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-purple-400 block">
              INVESTIGATOR WORKSPACE
            </span>
            <h2 className="text-xl sm:text-2xl font-black font-mono text-white tracking-wide">
              WELCOME, {investigator.name.toUpperCase()}
            </h2>
            <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-xs font-mono text-zinc-400">
              <span className="text-zinc-300">{investigator.officialEmail}</span>
              <span className="text-zinc-600 hidden sm:inline">•</span>
              <span className="text-zinc-400">{investigator.departmentUnit}</span>
            </div>
          </div>

          {/* Quick Actions */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={handleStartNew}
              id="btn-new-investigation-top"
              className="px-4 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-mono text-xs font-bold transition-all flex items-center gap-2 cursor-pointer shadow-md shadow-purple-950/50 hover:scale-[1.02] active:scale-[0.98]"
            >
              <PlusCircle className="w-4 h-4" />
              <span>+ NEW INVESTIGATION</span>
            </button>
            <button
              onClick={onViewProfile}
              id="btn-view-profile-top"
              className="px-3.5 py-2.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-zinc-200 font-mono text-xs font-bold transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              <User className="w-3.5 h-3.5 text-zinc-400" />
              <span>PROFILE</span>
            </button>
          </div>
        </div>
      </div>

      {/* QUICK ACTIONS BAR (TABBED) */}
      <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
        <div className="flex items-center gap-2">
          <button
            className="px-3.5 py-1.5 rounded-lg bg-zinc-900 border border-zinc-700 font-mono text-xs font-bold text-purple-300 flex items-center gap-1.5"
          >
            <FolderLock className="w-3.5 h-3.5" />
            <span>MY CASES ({cases.length})</span>
          </button>
          <button
            onClick={onViewProfile}
            className="px-3.5 py-1.5 rounded-lg hover:bg-zinc-900 border border-transparent hover:border-zinc-800 font-mono text-xs font-bold text-zinc-400 hover:text-zinc-200 transition-colors flex items-center gap-1.5"
          >
            <User className="w-3.5 h-3.5" />
            <span>PROFILE</span>
          </button>
        </div>

        <button
          onClick={handleStartNew}
          className="text-xs font-mono text-purple-400 hover:text-purple-300 flex items-center gap-1 cursor-pointer font-bold"
        >
          <span>+ Create New Case</span>
        </button>
      </div>

      {/* MY CASES SECTION */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-zinc-300 flex items-center gap-2">
            <span>SAVED INVESTIGATIONS</span>
          </h3>
          <span className="text-[11px] font-mono text-zinc-500">
            Click any case to expand or collapse details
          </span>
        </div>

        {cases.length === 0 ? (
          <div className="p-8 rounded-2xl border border-zinc-800 bg-[#0d0d14] text-center space-y-3">
            <FolderLock className="w-8 h-8 text-zinc-600 mx-auto" />
            <div className="space-y-1">
              <span className="font-mono text-sm font-bold text-zinc-300 block">No Active Cases</span>
              <p className="text-xs font-mono text-zinc-500">
                Start your first digital media investigation.
              </p>
            </div>
            <button
              onClick={onNewInvestigation}
              className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-mono text-xs font-bold transition-all inline-flex items-center gap-1.5"
            >
              <PlusCircle className="w-4 h-4" />
              <span>Start Investigation</span>
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 items-start">
            {cases.map((sc) => {
              const isExpanded = expandedCaseId === sc.id;
              const isCompleted = sc.status.includes('Completed');
              return (
                <div
                  key={sc.id}
                  onClick={() => toggleCaseExpand(sc.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      toggleCaseExpand(sc.id);
                    }
                  }}
                  tabIndex={0}
                  role="button"
                  aria-expanded={isExpanded}
                  aria-controls={`case-details-${sc.id}`}
                  className={`group rounded-xl border bg-[#0d0d14] p-4 sm:p-5 transition-all duration-200 cursor-pointer select-none focus-visible:ring-2 focus-visible:ring-purple-500 focus-visible:outline-none shadow-md ${
                    isExpanded
                      ? 'border-purple-500/50 shadow-purple-950/20 ring-1 ring-purple-500/30'
                      : 'border-zinc-800 hover:border-zinc-700 hover:bg-[#11111a] hover:shadow-xl hover:-translate-y-0.5 active:scale-[0.99] active:translate-y-0'
                  }`}
                >
                  {/* Header: ID & Progress Report (Always visible) */}
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs font-bold text-white bg-zinc-950 px-2.5 py-1 rounded-lg border border-zinc-800 group-hover:border-zinc-700 transition-colors">
                      CASE <strong className="text-purple-300">#{sc.id}</strong>
                    </span>

                    <div className="flex items-center gap-2">
                      <span
                        className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-full border transition-colors ${getCaseProgressBadge(
                          sc.status
                        )}`}
                      >
                        {sc.status}
                      </span>
                      <span
                        className={`p-1 rounded-md text-zinc-400 group-hover:text-purple-300 transition-all duration-300 ${
                          isExpanded ? 'rotate-180 text-purple-300 bg-purple-950/40' : ''
                        }`}
                        title={isExpanded ? 'Collapse case details' : 'Expand case details'}
                        aria-hidden="true"
                      >
                        <ChevronDown className="w-4 h-4" />
                      </span>
                    </div>
                  </div>

                  {/* Collapsible Details */}
                  <div
                    id={`case-details-${sc.id}`}
                    className={`case-card-collapse-grid ${isExpanded ? 'is-expanded' : ''}`}
                  >
                    <div className="case-card-collapse-inner">
                      <div className="pt-4 space-y-4 border-t border-zinc-800/80 mt-4">
                        {/* Case Title & Last updated */}
                        <div className="space-y-1">
                          <h4 className="font-mono text-sm font-bold text-zinc-100 line-clamp-2">
                            {sc.title}
                          </h4>
                          <p className="text-[11px] font-mono text-zinc-500 flex items-center gap-1">
                            <Clock className="w-3 h-3 text-zinc-500" />
                            <span>Last updated: {sc.lastUpdated}</span>
                          </p>
                        </div>

                        {/* Progress Indicator */}
                        <div className="p-2.5 rounded-lg bg-zinc-950 border border-zinc-800/80 space-y-1.5">
                          <div className="flex items-center justify-between text-[11px] font-mono">
                            <span className="text-zinc-400">Current Progress:</span>
                            <span className="font-bold text-purple-300">
                              {isCompleted ? 'All 5 Steps Sealed' : getStepName(sc.currentStepNumber)}
                            </span>
                          </div>
                          {/* Step dots */}
                          <div className="flex items-center gap-1.5 pt-0.5">
                            {[1, 2, 3, 4, 5].map((step) => {
                              const isDone = sc.completedSteps.includes(step);
                              const isCurrent = sc.currentStepNumber === step && !isCompleted;
                              return (
                                <div
                                  key={step}
                                  className={`h-1.5 flex-1 rounded-full ${
                                    isDone
                                      ? 'bg-emerald-500'
                                      : isCurrent
                                      ? 'bg-purple-500 animate-pulse'
                                      : 'bg-zinc-800'
                                  }`}
                                  title={`Step ${step}`}
                                />
                              );
                            })}
                          </div>
                        </div>

                        {/* Open Case Action */}
                        <div className="pt-1">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onOpenCase(sc);
                            }}
                            id={`btn-open-case-${sc.id}`}
                            className="group/btn w-full py-2.5 px-4 rounded-xl bg-zinc-900 hover:bg-purple-600 active:bg-purple-700 border border-zinc-700 hover:border-purple-400 text-zinc-200 hover:text-white font-mono text-xs font-bold transition-all duration-200 flex items-center justify-center gap-2 cursor-pointer shadow-sm hover:shadow-lg hover:shadow-purple-600/30 hover:scale-[1.02] hover:-translate-y-0.5 active:scale-[0.98] active:translate-y-0 focus-visible:ring-2 focus-visible:ring-purple-400 focus-visible:outline-none"
                          >
                            <span>{isCompleted ? 'VIEW DOSSIER' : 'OPEN CASE'}</span>
                            <ArrowRight className="w-3.5 h-3.5 transition-transform duration-200 group-hover/btn:translate-x-1" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>


      {/* Unobtrusive Trust Notice */}
      <div className="p-3.5 rounded-xl bg-zinc-950 border border-zinc-800/80 flex items-center justify-between text-[10px] font-mono text-zinc-400">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-3.5 h-3.5 text-purple-400" />
          <span>INVESTIGATOR ASSISTANCE • AI-assisted findings • Human verification</span>
        </div>
        <span className="hidden sm:inline text-zinc-500">
          Cases cryptographically indexed with SHA-256
        </span>
      </div>
    </div>
  );
};
