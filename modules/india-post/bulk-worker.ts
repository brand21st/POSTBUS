import type { SupabaseClient } from "@supabase/supabase-js";
import { recordIndiaPostBulkMetric } from "@/modules/india-post/bulk-metrics";
import { bulkWorkerMayPost } from "@/modules/india-post/bulk-run";
import {
  persistBulkArticleResults,
  transitionBulkBatch,
  uncertainBulkMustRecoverWithoutPost,
} from "@/modules/india-post/bulk-store";
import type { IndiaPostBulkBatchStatus } from "@/modules/india-post/bulk-state";
import { failedBeforeCeptCall } from "@/modules/india-post/booking-failure-state";
import { classifyProviderError } from "@/lib/jobs/retry";

/** A bulk batch closed before India Post was called. In NEVER_SUBMITTED_CODES, so its barcodes may be reused. */
export const BULK_NOT_SUBMITTED = "BULK_NOT_SUBMITTED";

export type BulkCeptOutcome = {
  bookedIds: string[];
  failedIds: string[];
  /** Posted articles the CEPT response did not prove either way. */
  recoveryIds?: string[];
  result?: { batch_id?: string | null; correlation_id?: string | null } | null;
};

export type BulkWorkerBatch = { id: string; status: IndiaPostBulkBatchStatus };

/**
 * This job did not post and must not report anything: another job owns the batch, or the batch
 * already finished. Callers end the job without touching shipments.
 */
export const BULK_BATCH_SUPERSEDED = "BULK_BATCH_SUPERSEDED";

const FINISHED_BULK_STATUSES = new Set<IndiaPostBulkBatchStatus>(["SUCCEEDED", "PARTIAL_SUCCESS", "FAILED"]);

function superseded(message: string) {
  return Object.assign(new Error(message), { code: BULK_BATCH_SUPERSEDED });
}

export function isBulkBatchSuperseded(error: unknown) {
  return (error as { code?: string } | null)?.code === BULK_BATCH_SUPERSEDED;
}

export type BulkWorkerDeps = {
  transition: (
    supabase: SupabaseClient,
    batchId: string,
    from: IndiaPostBulkBatchStatus,
    to: IndiaPostBulkBatchStatus,
    fields?: Record<string, unknown>
  ) => Promise<boolean>;
  persistArticles: typeof persistBulkArticleResults;
  recordMetric: typeof recordIndiaPostBulkMetric;
};

const defaultDeps: BulkWorkerDeps = {
  transition: transitionBulkBatch,
  persistArticles: persistBulkArticleResults,
  recordMetric: recordIndiaPostBulkMetric,
};

export async function runIndiaPostBulkWorkerAttempt(
  input: {
    supabase: SupabaseClient;
    organizationId: string;
    shipmentIds: string[];
    bulkBatch: BulkWorkerBatch | null;
    post: () => Promise<BulkCeptOutcome>;
    crashAfterPost?: boolean;
  },
  deps: BulkWorkerDeps = defaultDeps
): Promise<BulkCeptOutcome> {
  const { bulkBatch, shipmentIds } = input;
  if (!bulkBatch) return input.post();

  if (uncertainBulkMustRecoverWithoutPost(bulkBatch.status)) {
    if (bulkBatch.status !== "RECOVERY_REQUIRED") {
      await deps.transition(input.supabase, bulkBatch.id, bulkBatch.status, "RECOVERY_REQUIRED", {
        last_error: "Worker restarted after an uncertain CEPT boundary",
        last_error_code: "RECOVERY_REQUIRED",
      }).catch(() => false);
      bulkBatch.status = "RECOVERY_REQUIRED";
    }
    throw Object.assign(new Error("Bulk batch is not safe to POST to CEPT."), { code: "CEPT_UNKNOWN" });
  }
  if (FINISHED_BULK_STATUSES.has(bulkBatch.status)) {
    throw superseded("Bulk batch already finished; this job has nothing to post.");
  }
  if (!bulkWorkerMayPost(bulkBatch.status) || bulkBatch.status !== "READY") {
    throw Object.assign(new Error("Bulk batch is not safe to POST to CEPT."), { code: "CEPT_UNKNOWN" });
  }

  const moved = await deps.transition(input.supabase, bulkBatch.id, "READY", "SUBMITTING", {
    submitted_at: new Date().toISOString(),
  });
  if (!moved) {
    // Another job moved the batch out of READY first. It owns the POST and the results.
    throw superseded("Another job owns this bulk batch; not posting to CEPT.");
  }
  bulkBatch.status = "SUBMITTING";

  let outcome: BulkCeptOutcome;
  try {
    deps.recordMetric("bulk_cept_posts", {
      batchId: bulkBatch.id,
      organizationId: input.organizationId,
      articleCount: shipmentIds.length,
    });
    outcome = await input.post();
    if (input.crashAfterPost) {
      throw Object.assign(new Error("Injected crash after CEPT POST"), { code: "CEPT_UNKNOWN" });
    }
  } catch (error) {
    if (failedBeforeCeptCall(error)) {
      // Nothing reached India Post, so this is not an unknown outcome. Close the batch as FAILED
      // (a new batch may be built) and leave each shipment retryable instead of in review.
      const message = error instanceof Error ? error.message : "Bulk booking stopped before India Post was called.";
      await deps.transition(input.supabase, bulkBatch.id, "SUBMITTING", "FAILED", {
        last_error: message,
        last_error_code: BULK_NOT_SUBMITTED,
        completed_at: new Date().toISOString(),
      }).catch(() => false);
      bulkBatch.status = "FAILED";
      await deps.persistArticles(input.supabase, bulkBatch.id, {
        bookedIds: [],
        failedIds: shipmentIds,
        recoveryIds: [],
      }).catch(() => undefined);
      deps.recordMetric("bulk_batches_failed_before_post", {
        batchId: bulkBatch.id,
        organizationId: input.organizationId,
      });
      // A permanent error keeps its own code. A temporary one becomes BULK_NOT_SUBMITTED: the
      // batch is closed, so a job retry would find nothing to post; "Retry booking" requeues it.
      const classified = classifyProviderError(error);
      if (!classified.retryable) throw error;
      throw Object.assign(new Error(`Bulk booking did not reach India Post (${message}) Retry booking to submit again.`), {
        code: BULK_NOT_SUBMITTED,
        ceptNotCalled: true,
        shipmentIds,
      });
    }
    await deps.transition(input.supabase, bulkBatch.id, "SUBMITTING", "RECOVERY_REQUIRED", {
      last_error: error instanceof Error ? error.message : "CEPT bulk POST failed",
      last_error_code: "RECOVERY_REQUIRED",
    }).catch(() => false);
    bulkBatch.status = "RECOVERY_REQUIRED";
    await deps.persistArticles(input.supabase, bulkBatch.id, {
      bookedIds: [],
      failedIds: [],
      recoveryIds: shipmentIds,
    }).catch(() => undefined);
    deps.recordMetric("bulk_batches_recovery_required", {
      batchId: bulkBatch.id,
      organizationId: input.organizationId,
    });
    throw error;
  }

  const recoveryIds = outcome.recoveryIds ?? [];
  const next: IndiaPostBulkBatchStatus = recoveryIds.length
    ? "RECOVERY_REQUIRED"
    : outcome.failedIds.length === 0
      ? "SUCCEEDED"
      : outcome.bookedIds.length
        ? "PARTIAL_SUCCESS"
        : "FAILED";
  await deps.transition(input.supabase, bulkBatch.id, "SUBMITTING", "SUBMITTED").catch(() => false);
  bulkBatch.status = "SUBMITTED";
  await deps.transition(input.supabase, bulkBatch.id, "SUBMITTED", "RECONCILING").catch(() => false);
  bulkBatch.status = "RECONCILING";
  await deps.persistArticles(input.supabase, bulkBatch.id, {
    bookedIds: outcome.bookedIds,
    failedIds: outcome.failedIds,
    recoveryIds,
    ceptBatchId: outcome.result?.batch_id,
    correlationId: outcome.result?.correlation_id,
  }).catch(() => undefined);
  await deps.transition(input.supabase, bulkBatch.id, "RECONCILING", next, {
    completed_at: new Date().toISOString(),
  }).catch(() => false);
  bulkBatch.status = next;
  deps.recordMetric(
    next === "SUCCEEDED"
      ? "bulk_batches_succeeded"
      : next === "PARTIAL_SUCCESS"
        ? "bulk_batches_partial"
        : next === "RECOVERY_REQUIRED"
          ? "bulk_batches_recovery_required"
          : "bulk_batches_failed",
    {
      batchId: bulkBatch.id,
      booked: outcome.bookedIds.length,
      failed: outcome.failedIds.length,
      recovery: recoveryIds.length,
    }
  );
  return outcome;
}
