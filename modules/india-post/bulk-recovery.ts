import { bulkBatchMustNotResubmit, type IndiaPostBulkBatchStatus } from "@/modules/india-post/bulk-state";
import { bulkCanRetryCeptPost } from "@/modules/india-post/bulk-classify";

export type BulkCrashPoint =
  | "before_batch_creation"
  | "after_batch_creation"
  | "after_membership_creation"
  | "before_lock"
  | "after_lock"
  | "immediately_before_cept_post"
  | "during_cept_post"
  | "immediately_after_cept_post"
  | "after_cept_before_db_commit"
  | "after_partial_article_reconciliation"
  | "before_label_generation";

export function canSubmitCeptAtCrashPoint(point: BulkCrashPoint, status: IndiaPostBulkBatchStatus) {
  if (point === "before_batch_creation") return status === "PENDING" || status === "READY";
  if (point === "after_batch_creation" || point === "after_membership_creation") {
    return status === "READY";
  }
  if (point === "before_lock" || point === "after_lock" || point === "immediately_before_cept_post") {
    return status === "READY" && !bulkBatchMustNotResubmit(status);
  }
  return false;
}

export function duplicateWorkerMustSkipPost(status: IndiaPostBulkBatchStatus) {
  return bulkBatchMustNotResubmit(status) || !bulkCanRetryCeptPost(status !== "READY");
}

export type ArticleBookingEvidence = {
  shipmentId: string;
  bookedAtProvider: boolean | null;
};

/**
 * Only retry an article when evidence proves it was NOT booked.
 * Timeout/unknown is not evidence of "not booked".
 */
export function articlesAllowedToRetryIndividually(rows: ArticleBookingEvidence[]) {
  return rows.filter((row) => row.bookedAtProvider === false).map((row) => row.shipmentId);
}
