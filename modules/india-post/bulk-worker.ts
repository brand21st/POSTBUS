import type { SupabaseClient } from "@supabase/supabase-js";
import { recordIndiaPostBulkMetric } from "@/modules/india-post/bulk-metrics";
import { bulkWorkerMayPost } from "@/modules/india-post/bulk-run";
import {
  persistBulkArticleResults,
  transitionBulkBatch,
  uncertainBulkMustRecoverWithoutPost,
} from "@/modules/india-post/bulk-store";
import type { IndiaPostBulkBatchStatus } from "@/modules/india-post/bulk-state";

export type BulkCeptOutcome = {
  bookedIds: string[];
  failedIds: string[];
  result?: { batch_id?: string | null; correlation_id?: string | null } | null;
};

export type BulkWorkerBatch = { id: string; status: IndiaPostBulkBatchStatus };

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
  if (!bulkWorkerMayPost(bulkBatch.status) || bulkBatch.status !== "READY") {
    throw Object.assign(new Error("Bulk batch is not safe to POST to CEPT."), { code: "CEPT_UNKNOWN" });
  }

  const moved = await deps.transition(input.supabase, bulkBatch.id, "READY", "SUBMITTING", {
    submitted_at: new Date().toISOString(),
  });
  if (!moved) {
    throw Object.assign(new Error("Bulk batch lock/transition lost; not posting to CEPT."), { code: "CEPT_UNKNOWN" });
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

  const next =
    outcome.failedIds.length === 0 ? "SUCCEEDED" : outcome.bookedIds.length ? "PARTIAL_SUCCESS" : "FAILED";
  await deps.transition(input.supabase, bulkBatch.id, "SUBMITTING", "SUBMITTED").catch(() => false);
  bulkBatch.status = "SUBMITTED";
  await deps.transition(input.supabase, bulkBatch.id, "SUBMITTED", "RECONCILING").catch(() => false);
  bulkBatch.status = "RECONCILING";
  await deps.persistArticles(input.supabase, bulkBatch.id, {
    bookedIds: outcome.bookedIds,
    failedIds: outcome.failedIds,
    ceptBatchId: outcome.result?.batch_id,
    correlationId: outcome.result?.correlation_id,
  }).catch(() => undefined);
  await deps.transition(input.supabase, bulkBatch.id, "RECONCILING", next, {
    completed_at: new Date().toISOString(),
  }).catch(() => false);
  bulkBatch.status = next;
  deps.recordMetric(
    next === "SUCCEEDED" ? "bulk_batches_succeeded" : next === "PARTIAL_SUCCESS" ? "bulk_batches_partial" : "bulk_batches_failed",
    { batchId: bulkBatch.id, booked: outcome.bookedIds.length, failed: outcome.failedIds.length }
  );
  return outcome;
}
