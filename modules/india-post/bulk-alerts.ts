import type { BulkMetricName } from "@/modules/india-post/bulk-metrics";

export type BulkAlertDefinition = {
  id: string;
  metric: BulkMetricName | BulkMetricName[];
  condition: string;
  severity: "warning" | "critical";
  action: string;
};

/**
 * Alert contracts for when an on-call provider is wired.
 * Not deployed to Production by this change.
 */
export const INDIA_POST_BULK_ALERTS: BulkAlertDefinition[] = [
  {
    id: "bulk_recovery_required_spike",
    metric: "bulk_batches_recovery_required",
    condition: ">= 1 in 15m",
    severity: "critical",
    action: "Disable INDIA_POST_BULK_ENABLED. Do not retry. Reconcile with CEPT evidence.",
  },
  {
    id: "bulk_409_spike",
    metric: "bulk_409",
    condition: ">= 1 in 15m",
    severity: "critical",
    action: "Treat as unknown booking state. No second POST.",
  },
  {
    id: "bulk_5xx_spike",
    metric: "bulk_5xx",
    condition: ">= 3 in 15m",
    severity: "critical",
    action: "Keep concurrency at 1. Leave drain paused if Production.",
  },
  {
    id: "bulk_partial_spike",
    metric: "bulk_batches_partial",
    condition: ">= 3 in 1h",
    severity: "warning",
    action: "Inspect error_articles. Do not resubmit succeeded members.",
  },
  {
    id: "bulk_duplicates_prevented_spike",
    metric: "bulk_duplicates_prevented",
    condition: ">= 5 in 15m",
    severity: "warning",
    action: "Check duplicate workers / fingerprint collisions.",
  },
  {
    id: "bulk_latency_high",
    metric: "bulk_latency",
    condition: "p95 > 30s",
    severity: "warning",
    action: "Do not raise CEPT concurrency. Investigate CEPT/lock wait.",
  },
];

export function indiaPostBulkAlertDestinations() {
  const sentry = Boolean(process.env.SENTRY_DSN?.trim() || process.env.NEXT_PUBLIC_SENTRY_DSN?.trim());
  const posthog = Boolean(process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN?.trim());
  return {
    sentry,
    posthog,
    inAppNotifications: true,
    pagingConfigured: sentry || posthog,
  };
}

export const INDIA_POST_BULK_ALERT_INTEGRATION_TODO =
  "Critical bulk alerts currently emit logInfo only. Paging requires SENTRY_DSN or PostHog. Do not treat in-app notifications as on-call.";
