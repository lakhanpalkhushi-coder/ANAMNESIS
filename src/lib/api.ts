/* =========================================================================
 * THE ONLY PLACE A FETCH MAY LIVE
 *
 * Every call to the Anamnesis server goes through this module. It exists so
 * that three mistakes become impossible to make individually:
 *
 *   G7  A response body is never parsed before res.ok is checked. An error
 *       page or a model rejection can therefore never render as a finding.
 *   G8  Every request carries an AbortController armed at REQUEST_TIMEOUT_MS.
 *       A spinner cannot outlive its request.
 *   G9  Network failure, abort and non-2xx all normalise to one ApiError
 *       that callers can render without inspecting anything.
 *
 * Nothing here formats for display and nothing here invents a fallback.
 * A failed call throws; it never returns a plausible-looking empty result.
 * ========================================================================= */

import {
  AnamnesisForensicReport,
  MediaIntakeData,
  NOT_ASSESSED,
  SyntheticDetectorResult,
} from '../types';

/**
 * Requests are abandoned after this long.
 *
 * Must not be shorter than GEMINI_TIMEOUT_MS in server.ts, or the browser
 * gives up on a request the server is still working on and the investigator
 * never sees the answer that arrives. Raised from the specification's 30s
 * after measuring real photographs against the live model: good attempts
 * land near 18s, but timeouts at 32s were routine.
 */
export const REQUEST_TIMEOUT_MS = 60_000;

/* Compiled in by vite from API_SHARED_SECRET. Declared in vite.config.ts so
 * one variable serves both sides. Empty in a build made without it, in which
 * case the server decides whether to allow the request. */
declare const __API_SHARED_SECRET__: string;
const SHARED_SECRET =
  typeof __API_SHARED_SECRET__ === 'string' ? __API_SHARED_SECRET__ : '';

/** Headers for a POST. The secret is omitted entirely when there isn't one. */
function requestHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (SHARED_SECRET) headers['x-anamnesis-key'] = SHARED_SECRET;
  return headers;
}

export type ApiFailureKind = 'timeout' | 'offline' | 'http' | 'malformed';

/**
 * The single error type every caller sees.
 *
 * `message` is safe to render to an investigator: it says what failed and,
 * where it helps, what to do about it. Server diagnostics are not included
 * because the server does not send them.
 */
export class ApiError extends Error {
  readonly kind: ApiFailureKind;
  readonly status?: number;

  constructor(kind: ApiFailureKind, message: string, status?: number) {
    super(message);
    this.name = 'ApiError';
    this.kind = kind;
    this.status = status;
  }

  /** True when trying again is a reasonable thing for the user to do. */
  get isRetryable(): boolean {
    if (this.kind === 'malformed') return true;
    if (this.kind !== 'http') return true; // timeout, offline
    const status = this.status ?? 0;
    return status === 408 || status === 429 || status >= 500;
  }

  /**
   * True when the request failed because the model was busy rather than
   * because anything is wrong with the evidence or the configuration.
   * Worth distinguishing: it is the one failure a demonstration recovers
   * from by simply trying again.
   */
  get isTransientCapacity(): boolean {
    return this.kind === 'http' && (this.status === 429 || this.status === 503);
  }
}

/**
 * Fallback wording, used only when the server sends no message of its own.
 *
 * The server maps upstream failures to honest statuses and safe prose, so its
 * message is preferred wherever present. These strings exist for the cases it
 * cannot speak to — a proxy, a dev server, a 404 on a bad path.
 */
function describeHttpFailure(status: number): string {
  if (status === 400) {
    return 'The forensics engine rejected this evidence as unreadable.';
  }
  if (status === 401 || status === 403) {
    return 'The server rejected this request as unauthorised. Check API_SHARED_SECRET.';
  }
  if (status === 413) {
    return 'The evidence file is too large for the analysis endpoint.';
  }
  if (status === 429) {
    return 'Too many requests in a short window. Wait a few seconds and retry, or use Demo Mode.';
  }
  if (status === 503) {
    return 'The model is busy and refused the request. This is usually temporary — retry in a moment.';
  }
  if (status >= 500) {
    return 'The forensics engine could not complete the analysis. Retrying often succeeds.';
  }
  return `The forensics engine rejected the request (HTTP ${status}).`;
}

/**
 * Read the server's own error message, if it sent one.
 *
 * The server is the only party that knows *why* an upstream call failed, and
 * it has already stripped anything unsafe. Reading the body here is not a
 * violation of the res.ok rule: it is used solely to explain a failure, and
 * never as a result.
 */
async function readServerMessage(res: Response): Promise<string | null> {
  try {
    const body = await res.json();
    const message = (body as { error?: unknown })?.error;
    return typeof message === 'string' && message.trim() ? message : null;
  } catch {
    return null;
  }
}

/**
 * POST JSON, get typed JSON back, or throw ApiError.
 *
 * The response body is read only after res.ok passes. There is deliberately
 * no `fallback` parameter: a caller that cannot proceed without a result
 * must handle the throw, not receive a substitute.
 */
export async function postJson<TResponse>(
  path: string,
  body: unknown,
  options: { timeoutMs?: number; signal?: AbortSignal } = {}
): Promise<TResponse> {
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  // Let a caller-supplied signal (a Cancel button) abort us too.
  const onExternalAbort = () => controller.abort();
  options.signal?.addEventListener('abort', onExternalAbort);

  let res: Response;
  try {
    res = await fetch(path, {
      method: 'POST',
      headers: requestHeaders(),
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    if (controller.signal.aborted) {
      throw new ApiError(
        'timeout',
        `The analysis did not respond within ${Math.round(timeoutMs / 1000)} seconds and was cancelled.`
      );
    }
    throw new ApiError(
      'offline',
      'Could not reach the forensics engine. Check the connection and try again.'
    );
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onExternalAbort);
  }

  // G7: status first. Nothing below this line may run as a result.
  if (!res.ok) {
    const serverMessage = await readServerMessage(res);
    throw new ApiError('http', serverMessage ?? describeHttpFailure(res.status), res.status);
  }

  try {
    return (await res.json()) as TResponse;
  } catch {
    throw new ApiError(
      'malformed',
      'The forensics engine returned a response that could not be read.'
    );
  }
}

/* ---------------------------------------------------------------------------
 * Typed route wrappers. The four routes in the API surface, and no others.
 * ------------------------------------------------------------------------ */

export interface HealthResponse {
  status: string;
  engine: string;
  model?: string;
  timestamp: string;
}

/** GET /api/health — reports the resolved model ID so a bad config is visible. */
export async function getHealth(): Promise<HealthResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch('/api/health', { signal: controller.signal });
    if (!res.ok) {
      const serverMessage = await readServerMessage(res);
      throw new ApiError('http', serverMessage ?? describeHttpFailure(res.status), res.status);
    }
    return (await res.json()) as HealthResponse;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if (controller.signal.aborted) {
      throw new ApiError('timeout', 'The health check timed out.');
    }
    throw new ApiError('offline', 'Could not reach the forensics engine.');
  } finally {
    clearTimeout(timer);
  }
}

/** The claimed context and measurements sent with an analysis request. */
export interface AnalyzeRequest {
  imageBase64: string;
  mimeType: string;
  fileName: string;
  fileHash: string;
  exifData: Record<string, string | number | boolean>;
  claimedLocation: string;
  claimedDateTime: string;
  claimedNarrative: string;
  sourcePlatform: string;
  customNotes?: string;
}

/** POST /api/forensics/analyze — the one interpretive call in the ingest flow. */
export function analyzeMedia(
  request: AnalyzeRequest,
  options?: { signal?: AbortSignal }
): Promise<AnamnesisForensicReport> {
  return postJson<AnamnesisForensicReport>('/api/forensics/analyze', request, options);
}

/* ---------------------------------------------------------------------------
 * Detector A.
 *
 * The wire shape carries `null` for an absent score because JSON has no
 * NOT_ASSESSED. It is converted at this boundary and nowhere else, so no
 * caller downstream ever has to remember which representation it is holding.
 * ------------------------------------------------------------------------ */
interface DetectWireResponse {
  modelId: string;
  backend: string;
  syntheticProbabilityScore: number | null;
  labelScores: Array<{ label: string; score: number }>;
  note?: string;
}

/**
 * POST /api/forensics/detect — one forward pass through a pretrained
 * classifier. Throws ApiError on failure; it never returns a substitute
 * score, because a fabricated 0 and a measured 0 must not look alike.
 */
export async function detectSynthetic(
  request: { imageBase64: string; mimeType: string },
  options?: { signal?: AbortSignal }
): Promise<SyntheticDetectorResult> {
  const wire = await postJson<DetectWireResponse>('/api/forensics/detect', request, options);
  return {
    modelId: wire.modelId,
    backend: wire.backend,
    syntheticProbabilityScore:
      typeof wire.syntheticProbabilityScore === 'number'
        ? wire.syntheticProbabilityScore
        : NOT_ASSESSED,
    labelScores: Array.isArray(wire.labelScores) ? wire.labelScores : [],
    note: wire.note,
  };
}

/** POST /api/forensics/chat — one investigator question, one reply. */
export function askCrossExaminer(
  request: {
    message: string;
    reportContext: AnamnesisForensicReport | null;
    imageBase64?: string;
    mimeType?: string;
  },
  options?: { signal?: AbortSignal }
): Promise<{ reply: string }> {
  return postJson<{ reply: string }>('/api/forensics/chat', request, options);
}

/**
 * Assemble an analyse request from a completed intake.
 *
 * Always sends mimeType alongside the bytes (G17): the server must not have
 * to guess. An SVG preview labelled image/jpeg is rejected by the model, and
 * with G7 in place that rejection surfaces as an error rather than as a
 * fabricated all-clear.
 */
export function mimeTypeFromDataUrl(dataUrl: string): string | undefined {
  const match = /^data:([a-zA-Z0-9!#$&^_.+-]+\/[a-zA-Z0-9!#$&^_.+-]+);/.exec(dataUrl);
  return match?.[1];
}

export function toAnalyzeRequest(
  intake: MediaIntakeData,
  imageBase64: string,
  mimeType: string
): AnalyzeRequest {
  return {
    imageBase64,
    mimeType,
    fileName: intake.fileName,
    fileHash: intake.fileHashSha256,
    exifData: intake.exifData ?? {},
    claimedLocation: intake.claimedLocation,
    claimedDateTime: intake.claimedDateTime,
    claimedNarrative: intake.claimedNarrative,
    sourcePlatform: intake.sourcePlatform,
  };
}
