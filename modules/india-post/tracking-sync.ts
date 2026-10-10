import type { SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";
import { createBackgroundJob } from "@/modules/jobs/service";
import { TRACKING_POLL_STATUSES } from "@/modules/india-post/apply-tracking";

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

export async function enqueueOrgTrackingSyncIfIdle(
  supabase: SupabaseClient,
  organizationId: string
) {
  if (await organizationHasOpenTrackingSync(supabase, organizationId)) {
    return { enqueued: false, reason: "open-job" as const };
  }
  await createBackgroundJob(supabase, {
    organizationId,
    jobType: "tracking-sync",
    entityType: "organization",
    entityId: organizationId,
  });
  return { enqueued: true, reason: "queued" as const };
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
      .select("id, status, encrypted_username")
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (!connection || (connection.status !== "CONNECTED" && !connection.encrypted_username)) {
      continue;
    }
    const result = await enqueueOrgTrackingSyncIfIdle(supabase, organizationId);
    if (result.enqueued) enqueued += 1;
  }
  return { enqueued, considered: orgIds.length };
}

export function trackingPollStatuses() {
  return [...TRACKING_POLL_STATUSES];
}
