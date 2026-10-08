export const INDIA_POST_BULK_BATCH_STATUSES = [
  "PENDING",
  "BUILDING",
  "READY",
  "SUBMITTING",
  "SUBMITTED",
  "RECONCILING",
  "SUCCEEDED",
  "PARTIAL_SUCCESS",
  "FAILED",
  "RECOVERY_REQUIRED",
] as const;

export type IndiaPostBulkBatchStatus = (typeof INDIA_POST_BULK_BATCH_STATUSES)[number];

export const INDIA_POST_BULK_ARTICLE_RESULTS = [
  "PENDING",
  "SUBMITTED",
  "SUCCEEDED",
  "FAILED",
  "RECOVERY_REQUIRED",
] as const;

export type IndiaPostBulkArticleResult = (typeof INDIA_POST_BULK_ARTICLE_RESULTS)[number];

export const INDIA_POST_BULK_ACTIVE_BATCH_STATUSES = new Set<IndiaPostBulkBatchStatus>([
  "PENDING",
  "BUILDING",
  "READY",
  "SUBMITTING",
  "SUBMITTED",
  "RECONCILING",
  "RECOVERY_REQUIRED",
]);

const TRANSITIONS: Record<IndiaPostBulkBatchStatus, IndiaPostBulkBatchStatus[]> = {
  PENDING: ["BUILDING", "FAILED"],
  BUILDING: ["READY", "FAILED"],
  READY: ["SUBMITTING", "FAILED"],
  SUBMITTING: ["SUBMITTED", "RECOVERY_REQUIRED", "FAILED"],
  SUBMITTED: ["RECONCILING", "RECOVERY_REQUIRED"],
  RECONCILING: ["SUCCEEDED", "PARTIAL_SUCCESS", "FAILED", "RECOVERY_REQUIRED"],
  SUCCEEDED: [],
  PARTIAL_SUCCESS: [],
  FAILED: [],
  RECOVERY_REQUIRED: ["RECONCILING"],
};

export function canTransitionIndiaPostBulkBatch(
  from: IndiaPostBulkBatchStatus,
  to: IndiaPostBulkBatchStatus
) {
  return TRANSITIONS[from].includes(to);
}

export function fingerprintRetryPolicy(status: IndiaPostBulkBatchStatus) {
  if (status === "SUCCEEDED" || status === "PARTIAL_SUCCESS") return "forbidden" as const;
  if (status === "FAILED") return "new_batch_allowed" as const;
  if (status === "RECOVERY_REQUIRED") return "reconciliation_only" as const;
  return "forbidden" as const;
}

/** After a CEPT POST may have left the provider, never POST the same membership again. */
export function bulkBatchMustNotResubmit(status: IndiaPostBulkBatchStatus) {
  return (
    status === "SUBMITTING" ||
    status === "SUBMITTED" ||
    status === "RECONCILING" ||
    status === "RECOVERY_REQUIRED" ||
    status === "SUCCEEDED" ||
    status === "PARTIAL_SUCCESS"
  );
}
