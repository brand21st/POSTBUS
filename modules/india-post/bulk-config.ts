import { INDIA_POST_FILE_BOOKING_MAX, INDIA_POST_JSON_BOOKING_MAX } from "@/modules/india-post/spec";
import { indiaPostBookingBatchSize } from "@/modules/india-post/booking-batch";

/**
 * Approach Document: JSON bulk is "below 1000 articles"; file bulk is 5000.
 * Code historically used 999. The live CEPT ceiling is UNVERIFIED until an
 * authorized UAT/Production probe confirms it. Production bulk stays off.
 */
export const INDIA_POST_JSON_BULK_DOCUMENTED_BELOW = 1000;
export const INDIA_POST_JSON_BULK_CODE_MAX = INDIA_POST_JSON_BOOKING_MAX;
export const INDIA_POST_JSON_BULK_LIMIT_VERIFIED = false;

export function indiaPostBulkEnabled() {
  return optional(process.env.INDIA_POST_BULK_ENABLED) === "true";
}

export function indiaPostBulkConcurrency() {
  const raw = Number(optional(process.env.INDIA_POST_BULK_CONCURRENCY) || "1");
  if (!Number.isFinite(raw)) return 1;
  return Math.min(1, Math.max(1, Math.floor(raw)));
}

export function indiaPostBulkMaxArticles() {
  const documentedCap = Math.min(INDIA_POST_JSON_BULK_CODE_MAX, INDIA_POST_JSON_BULK_DOCUMENTED_BELOW - 1);
  const raw = Number(optional(process.env.INDIA_POST_BULK_MAX_ARTICLES) || "2");
  if (!Number.isFinite(raw)) return 2;
  return Math.min(documentedCap, INDIA_POST_FILE_BOOKING_MAX, Math.max(1, Math.floor(raw)));
}

/** Hidden BATCH_SIZE>1 grouping stays off until true bulk is explicitly enabled. */
export function effectiveIndiaPostBookingBatchSize() {
  if (!indiaPostBulkEnabled()) return 1;
  return Math.min(indiaPostBookingBatchSize(), indiaPostBulkMaxArticles());
}

function optional(value: string | undefined) {
  return value?.trim() || "";
}
