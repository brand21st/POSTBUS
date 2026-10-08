import { indiaPostBulkEnabled, indiaPostBulkMaxArticles } from "@/modules/india-post/bulk-config";
import { INDIA_POST_JSON_BOOKING_MAX } from "@/modules/india-post/spec";
import { duplicateWorkerMustSkipPost, type BulkCrashPoint, canSubmitCeptAtCrashPoint } from "@/modules/india-post/bulk-recovery";
import type { IndiaPostBulkBatchStatus } from "@/modules/india-post/bulk-state";

export function assertIndiaPostBulkPostAllowed(articleCount: number) {
  if (articleCount <= 1) return;
  if (!indiaPostBulkEnabled()) {
    throw Object.assign(new Error("India Post bulk booking is disabled."), { code: "VALIDATION_ERROR" });
  }
  if (articleCount > indiaPostBulkMaxArticles()) {
    throw Object.assign(new Error("Bulk article count exceeds INDIA_POST_BULK_MAX_ARTICLES."), {
      code: "VALIDATION_ERROR",
    });
  }
  if (articleCount > INDIA_POST_JSON_BOOKING_MAX) {
    throw Object.assign(new Error("File bulk transport is not enabled until the JSON ceiling is verified."), {
      code: "VALIDATION_ERROR",
    });
  }
}

export function bulkWorkerMayPost(status: IndiaPostBulkBatchStatus, crashPoint?: BulkCrashPoint) {
  if (duplicateWorkerMustSkipPost(status)) return false;
  if (crashPoint) return canSubmitCeptAtCrashPoint(crashPoint, status);
  return status === "READY";
}
