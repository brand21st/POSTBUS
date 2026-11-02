import { logError, logInfo } from "@/lib/logger";

export type BulkMetricName =
  | "bulk_batches_started"
  | "bulk_batches_succeeded"
  | "bulk_batches_partial"
  | "bulk_batches_failed"
  | "bulk_batches_recovery_required"
  | "bulk_articles_submitted"
  | "bulk_articles_succeeded"
  | "bulk_articles_failed"
  | "bulk_articles_recovery_required"
  | "bulk_409"
  | "bulk_429"
  | "bulk_5xx"
  | "bulk_timeouts"
  | "bulk_duplicates_prevented"
  | "bulk_latency"
  | "bulk_cept_posts"
  | "bulk_queue_backlog"
  | "bulk_worker_health";

const CRITICAL_BULK_METRICS = new Set<BulkMetricName>([
  "bulk_batches_recovery_required",
  "bulk_409",
  "bulk_5xx",
  "bulk_timeouts",
]);

export function recordIndiaPostBulkMetric(
  name: BulkMetricName,
  fields: Record<string, string | number | boolean | null | undefined>
) {
  logInfo(name, fields);
  if (CRITICAL_BULK_METRICS.has(name)) logError(name, fields);
}
