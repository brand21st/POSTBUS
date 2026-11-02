import type { SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";
import { logError, logInfo } from "@/lib/logger";
import { createBackgroundJob } from "@/modules/jobs/service";
import { TRACKING_POLL_STATUSES } from "@/modules/india-post/apply-tracking";
import { evaluateTrackingAuthHold } from "@/modules/india-post/tracking-auth-hold";

const OPEN_JOB_STATUSES = ["QUEUED", "PENDING", "RUNNING", "RETRYING"];

export function trackingSyncPageSize() {
  const parsed = Number(env.indiaPostTrackingSyncPageSize);
  if (!Number.isFinite(parsed) || parsed < 1) return 500;
  return Math.min(500, Math.trunc(parsed));
}

export function trackingSyncMinIntervalMs() {
  const parsed = Number(env.indiaPostTrackingSyncMinIntervalMs);
  if (!Number.isFinite(parsed) || parsed < 0) return 15 * 60 * 1000;
  return Math.trunc(parsed);
}

export function trackingSyncEnqueueLimit() {
  const parsed = Number(env.indiaPostTrackingSyncEnqueueLimit);
  if (!Number.isFinite(parsed) || parsed < 1) return 50;
  return Math.min(200, Math.trunc(parsed));
}

export function trackingSyncCutoffIso(now = Date.now()) {
  return new Date(now - trackingSyncMinIntervalMs()).toISOString();
}

export function trackingSyncUnscannedIntervalMs() {
  return Math.min(trackingSyncMinIntervalMs(), 2 * 60 * 1000);
}

export function trackingSyncUnscannedCutoffIso(now = Date.now()) {
  return new Date(now - trackingSyncUnscannedIntervalMs()).toISOString();
}

export function trackingSyncDueFilter(now = Date.now()) {
  const cutoff = trackingSyncCutoffIso(now);
  const unscannedCutoff = trackingSyncUnscannedCutoffIso(now);
  return `last_tracked_at.is.null,last_tracked_at.lt.${cutoff},and(last_event_at.is.null,last_tracked_at.lt.${unscannedCutoff})`;
}

const DUPLICATE_ENQUEUE_STATUSES = ["QUEUED", "PENDING"];

export async function organizationHasOpenTrackingSync(
  supabase: SupabaseClient,
  organizationId: string
) {
  const { data } = await supabase
    .from("background_jobs")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("job_type", "tracking-sync")
    .in("status", OPEN_JOB_STATUSES)
    .limit(1);
  return Boolean(data?.length);
}

/** Best-effort collapse of check-then-insert races. Does not cancel RUNNING continuation jobs. */
export async function cancelNewerDuplicateQueuedTrackingSync(
  supabase: SupabaseClient,
  organizationId: string
) {
  const { data } = await supabase
    .from("background_jobs")
    .select("id, created_at, status")
    .eq("organization_id", organizationId)
    .eq("job_type", "tracking-sync")
    .in("status", DUPLICATE_ENQUEUE_STATUSES)
    .order("created_at", { ascending: true })
    .limit(10);
  const rows = (data ?? []) as { id: string; created_at?: string | null }[];
  if (rows.length < 2) {
    return { kept: rows[0]?.id ?? null, cancelled: 0 };
  }
  let cancelled = 0;
  for (const row of rows.slice(1)) {
    const { error } = await supabase
      .from("background_jobs")
      .update({
        status: "CANCELLED",
        last_error_code: "DUPLICATE_TRACKING_SYNC",
        last_error: "Duplicate tracking-sync enqueue lost the race.",
      })
      .eq("id", row.id)
      .eq("organization_id", organizationId)
      .in("status", DUPLICATE_ENQUEUE_STATUSES);
    if (!error) cancelled += 1;
  }
  return { kept: rows[0].id, cancelled };
}

export async function enqueueOrgTrackingSyncIfIdle(
  supabase: SupabaseClient,
  organizationId: string,
  connection?: {
    last_verified_at?: string | null;
    last_refreshed_at?: string | null;
  }
) {
  if (await organizationHasOpenTrackingSync(supabase, organizationId)) {
    return { enqueued: false, reason: "open-job" as const };
  }
  let hold;
  try {
    hold = await evaluateTrackingAuthHold(supabase, {
      organizationId,
      lastVerifiedAt: connection?.last_verified_at,
      lastRefreshedAt: connection?.last_refreshed_at,
    });
  } catch (error) {
    logError("india_post.tracking.auth_hold_unavailable", {
      organizationId,
      message: error instanceof Error ? error.message : "hold check failed",
    });
    return { enqueued: false, reason: "hold-check-failed" as const };
  }
  if (hold.blocked) {
    logInfo("india_post.tracking.auth_hold", {
      organizationId,
      reason: hold.reason,
      strikeCount: hold.strikeCount,
      cooldownUntil: hold.cooldownUntil,
    });
    return { enqueued: false, reason: "auth-hold" as const, cooldownUntil: hold.cooldownUntil };
  }
  await createBackgroundJob(supabase, {
    organizationId,
    jobType: "tracking-sync",
    entityType: "organization",
    entityId: organizationId,
  });
  await cancelNewerDuplicateQueuedTrackingSync(supabase, organizationId);
  return { enqueued: true, reason: hold.reason === "probe" ? ("probe" as const) : ("queued" as const) };
}

export async function enqueueDueTrackingSyncJobs(supabase: SupabaseClient) {
  const limit = trackingSyncEnqueueLimit();
  const { data: settings } = await supabase
    .from("automation_settings")
    .select("organization_id")
    .eq("auto_tracking_sync", true)
    .limit(limit * 2);
  const orgIds = [...new Set((settings ?? []).map((row) => row.organization_id).filter(Boolean))];
  let enqueued = 0;
  for (const organizationId of orgIds) {
    if (enqueued >= limit) break;
    const { data: connection } = await supabase
      .from("india_post_connections")
      .select("id, status, encrypted_username, last_verified_at, last_refreshed_at")
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (!connection || (connection.status !== "CONNECTED" && !connection.encrypted_username)) {
      continue;
    }
    const result = await enqueueOrgTrackingSyncIfIdle(supabase, organizationId, connection);
    if (result.enqueued) enqueued += 1;
  }
  return { enqueued, considered: orgIds.length };
}

export function trackingPollStatuses() {
  return [...TRACKING_POLL_STATUSES];
}
