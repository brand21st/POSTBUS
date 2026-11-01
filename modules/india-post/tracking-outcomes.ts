import type { BulkTrackingArticle } from "@/modules/india-post/apply-tracking";
import { isConfirmedIndiaPostLoginAuthFailure, isIndiaPostLoginError } from "@/modules/india-post/login-auth";
import {
  classifyRequestedArticles,
  normalizeArticleNumber,
  type RequestedArticleClassification,
} from "@/modules/india-post/tracking-response";

/**
 * Internal classifications for bulk tracking. These are not CEPT status values.
 * An accepted HTTP 200 with no scans stays distinct from a rejected HTTP response.
 */
export type TrackingChunkOutcome =
  | "SUCCESS_WITH_EVENTS"
  | "SUCCESS_WITH_EMPTY_HISTORY"
  | "SUCCESS_WITH_UNMATCHED_ARTICLE"
  | "SUCCESS_WITH_PARTIAL_RESULTS"
  | "CHUNK_HTTP_400"
  | "CHUNK_HTTP_401"
  | "CHUNK_HTTP_403"
  | "CHUNK_HTTP_404"
  | "CHUNK_HTTP_429"
  | "CHUNK_HTTP_5XX"
  | "NETWORK_TIMEOUT"
  | "INVALID_RESPONSE"
  | "PARSE_FAILURE"
  | "AUTHENTICATION_FAILURE";

export type TrackingArticleClassification = RequestedArticleClassification | "REJECTED";

export type ProviderSyncOutcome = "SUCCEEDED" | "PARTIAL" | "EMPTY_ACCEPTED" | "REJECTED" | "NO_WORK";

export type TrackingArticleDecision = {
  barcode: string;
  classification: TrackingArticleClassification;
  article?: BulkTrackingArticle;
};

export type TrackingHardFailure = {
  status?: number;
  code?: string;
  name?: string;
  retryAfterMs?: number;
};

export type TrackingSyncMetadata = {
  providerSyncOutcome: ProviderSyncOutcome;
  batchesAttempted: number;
  batchesSucceeded: number;
  batchesFailed: number;
  chunkOutcomes: TrackingChunkOutcome[];
  articles: TrackingArticleDecision[];
};

export type TrackShipmentResult = {
  success?: boolean;
  message?: string;
  data: BulkTrackingArticle[];
  tracking: TrackingSyncMetadata;
  hardFailure?: TrackingHardFailure;
};

export type TrackingJobProgress = {
  awbsEligible: number;
  awbsAttempted: number;
  awbsMatched: number;
  awbsWithEvents: number;
  awbsWithoutEvents: number;
  awbsUnmatched: number;
  awbsAmbiguous: number;
  awbsRejected: number;
  eventsInserted: number;
  eventsDuplicate: number;
  eventsSkippedUntimed: number;
  batchesAttempted: number;
  batchesSucceeded: number;
  batchesFailed: number;
  noWork: boolean;
  providerSyncOutcome: ProviderSyncOutcome;
  /**
   * last_tracked_at is still the polling due-clock. It is updated on accepted
   * empty lookups and on non-retryable rejections so the scheduler does not
   * immediately call CEPT again. It is not proof of a successful scan sync.
   */
  timestampSemantics: "attempt_clock";
};

export function emptyTrackingJobProgress(): TrackingJobProgress {
  return {
    awbsEligible: 0,
    awbsAttempted: 0,
    awbsMatched: 0,
    awbsWithEvents: 0,
    awbsWithoutEvents: 0,
    awbsUnmatched: 0,
    awbsAmbiguous: 0,
    awbsRejected: 0,
    eventsInserted: 0,
    eventsDuplicate: 0,
    eventsSkippedUntimed: 0,
    batchesAttempted: 0,
    batchesSucceeded: 0,
    batchesFailed: 0,
    noWork: false,
    providerSyncOutcome: "NO_WORK",
    timestampSemantics: "attempt_clock",
  };
}

export function chunkOutcomeForHttpStatus(status: number): TrackingChunkOutcome {
  if (status === 400) return "CHUNK_HTTP_400";
  if (status === 401) return "CHUNK_HTTP_401";
  if (status === 403) return "CHUNK_HTTP_403";
  if (status === 404) return "CHUNK_HTTP_404";
  if (status === 429) return "CHUNK_HTTP_429";
  if (status >= 500) return "CHUNK_HTTP_5XX";
  return "INVALID_RESPONSE";
}

export function acceptedChunkOutcome(rows: Array<{ classification: RequestedArticleClassification }>): TrackingChunkOutcome {
  if (!rows.length) return "SUCCESS_WITH_EMPTY_HISTORY";
  const kinds = new Set(rows.map((row) => row.classification));
  if (kinds.size === 1 && kinds.has("WITH_EVENTS")) return "SUCCESS_WITH_EVENTS";
  if (kinds.size === 1 && kinds.has("EMPTY_HISTORY")) return "SUCCESS_WITH_EMPTY_HISTORY";
  if (kinds.size === 1 && (kinds.has("UNMATCHED") || kinds.has("AMBIGUOUS"))) return "SUCCESS_WITH_UNMATCHED_ARTICLE";
  return "SUCCESS_WITH_PARTIAL_RESULTS";
}

export function isTimeoutError(error: unknown) {
  const row = error as { name?: string; code?: string } | null;
  return row?.name === "AbortError" || row?.name === "TimeoutError" || row?.code === "ABORT_ERR" || row?.code === "ETIMEDOUT";
}

export function trackingHttpError(status: number, retryAfterMs?: number | null) {
  const error = new Error(`India Post tracking request failed (HTTP ${status}).`) as Error & {
    status: number;
    code: string;
    retryAfterMs?: number;
  };
  error.status = status;
  error.code = `HTTP_${status}`;
  if (retryAfterMs != null && Number.isFinite(retryAfterMs)) error.retryAfterMs = retryAfterMs;
  return error;
}

export function hardFailureError(failure: TrackingHardFailure) {
  if (failure.name === "AbortError" || failure.code === "ETIMEDOUT") {
    const error = new Error("India Post tracking request timed out.") as Error & {
      name: string;
      code?: string;
      status?: number;
    };
    error.name = "AbortError";
    error.code = "ETIMEDOUT";
    return error;
  }
  const status = failure.status ?? 502;
  const error = trackingHttpError(status, failure.retryAfterMs);
  if (failure.code === "TEMPORARY_PROVIDER_FAILURE") error.code = "TEMPORARY_PROVIDER_FAILURE";
  return error;
}

export function classifyAcceptedChunk(requested: string[], articles: BulkTrackingArticle[] | undefined) {
  const classified = classifyRequestedArticles(articles, requested);
  return {
    outcome: acceptedChunkOutcome(classified.rows),
    articles: classified.articles,
    rows: classified.rows.map((row) => ({
      barcode: row.barcode,
      classification: row.classification,
      article: row.article,
    })) satisfies TrackingArticleDecision[],
  };
}

export function rejectedChunkRows(requested: string[]): TrackingArticleDecision[] {
  return requested.map((barcode) => ({ barcode, classification: "REJECTED" as const }));
}

export function summarizeTrackingSync(input: {
  chunkOutcomes: TrackingChunkOutcome[];
  articles: TrackingArticleDecision[];
  batchesAttempted: number;
  batchesSucceeded: number;
  batchesFailed: number;
  hardFailure?: TrackingHardFailure | null;
}): TrackingSyncMetadata {
  const failedChunks = input.chunkOutcomes.filter((outcome) => !outcome.startsWith("SUCCESS_")).length;
  const withEvents = input.articles.some((row) => row.classification === "WITH_EVENTS");
  let providerSyncOutcome: ProviderSyncOutcome;
  if (!input.chunkOutcomes.length || input.batchesSucceeded === 0) providerSyncOutcome = "REJECTED";
  else if (failedChunks > 0 || input.hardFailure) providerSyncOutcome = "PARTIAL";
  else if (!withEvents) providerSyncOutcome = "EMPTY_ACCEPTED";
  else providerSyncOutcome = "SUCCEEDED";
  return {
    providerSyncOutcome,
    batchesAttempted: input.batchesAttempted,
    batchesSucceeded: input.batchesSucceeded,
    batchesFailed: input.batchesFailed,
    chunkOutcomes: input.chunkOutcomes,
    articles: input.articles,
  };
}

export function combineProviderSyncOutcome(
  current: ProviderSyncOutcome,
  next: ProviderSyncOutcome
): ProviderSyncOutcome {
  if (current === "NO_WORK") return next;
  if (next === "NO_WORK") return current;
  if (current === next) return current;
  if (current === "REJECTED" && next === "REJECTED") return "REJECTED";
  if (current === "REJECTED" || next === "REJECTED") return "PARTIAL";
  if (current === "PARTIAL" || next === "PARTIAL") return "PARTIAL";
  if (current === "SUCCEEDED" || next === "SUCCEEDED") return "SUCCEEDED";
  return "EMPTY_ACCEPTED";
}

/**
 * Non-retryable tracking HTTP rejections stamp the attempt clock so the next
 * scheduler pass does not call CEPT immediately. Retryable 429/5xx/timeouts
 * do not stamp, so the same job retry can still see those shipments as due.
 * Login authentication failures are excluded so Patch 1 holds stay in control.
 */
export function trackingFailureStampsAttemptClock(error: unknown) {
  if (isIndiaPostLoginError(error) || isConfirmedIndiaPostLoginAuthFailure(error)) return false;
  if (isTimeoutError(error)) return false;
  const status = (error as { status?: number }).status;
  if (status === 429 || (typeof status === "number" && status >= 500)) return false;
  return status === 400 || status === 401 || status === 403 || status === 404;
}

export function trackingLogMessage(error: unknown) {
  const status = (error as { status?: number }).status;
  if (isIndiaPostLoginError(error)) return "India Post login failed.";
  if (typeof status === "number") return `India Post tracking request failed (HTTP ${status}).`;
  if (isTimeoutError(error)) return "India Post tracking request timed out.";
  return "India Post tracking request failed.";
}

export type TrackingPagePlan<T> = {
  ingest: Array<{ shipment: T; article: BulkTrackingArticle }>;
  stampIds: string[];
  matched: number;
  withEvents: number;
  withoutEvents: number;
  unmatched: number;
  ambiguous: number;
  rejected: number;
};

export function planTrackingPageActions<T extends { id: string; barcode: string | null }>(
  shipments: T[],
  tracking: TrackingSyncMetadata,
  hardFailure?: TrackingHardFailure | null
): TrackingPagePlan<T> {
  const byKey = new Map(tracking.articles.map((row) => [normalizeArticleNumber(row.barcode), row]));
  const plan: TrackingPagePlan<T> = {
    ingest: [],
    stampIds: [],
    matched: 0,
    withEvents: 0,
    withoutEvents: 0,
    unmatched: 0,
    ambiguous: 0,
    rejected: 0,
  };
  const retryableHardFailure =
    Boolean(hardFailure) &&
    (hardFailure?.name === "AbortError" ||
      hardFailure?.code === "ETIMEDOUT" ||
      hardFailure?.status === 429 ||
      (typeof hardFailure?.status === "number" && hardFailure.status >= 500) ||
      hardFailure?.code === "TEMPORARY_PROVIDER_FAILURE");

  for (const shipment of shipments) {
    if (!shipment.barcode) continue;
    const row = byKey.get(normalizeArticleNumber(shipment.barcode));
    const classification = row?.classification ?? "UNMATCHED";
    if ((classification === "WITH_EVENTS" || classification === "EMPTY_HISTORY") && row?.article) {
      plan.ingest.push({ shipment, article: row.article });
      plan.matched += 1;
      if (classification === "WITH_EVENTS") plan.withEvents += 1;
      else plan.withoutEvents += 1;
      continue;
    }
    if (classification === "AMBIGUOUS") plan.ambiguous += 1;
    else if (classification === "REJECTED") plan.rejected += 1;
    else plan.unmatched += 1;
    if (classification === "REJECTED" && retryableHardFailure) continue;
    plan.stampIds.push(shipment.id);
  }
  return plan;
}
