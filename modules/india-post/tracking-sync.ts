import type { SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";
import { createBackgroundJob } from "@/modules/jobs/service";
import { TRACKING_POLL_STATUSES } from "@/modules/india-post/apply-tracking";
import {
  isTrackingP0CanaryOrganization,
  trackingP0CanaryActive,
  trackingP0CanaryAllowlist,
} from "@/modules/india-post/tracking-p0-canary";

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

export function trackingAuthCooldownMs() {
  const parsed = Number(env.indiaPostTrackingAuthCooldownMs);
  if (!Number.isFinite(parsed) || parsed < 0) return 30 * 60 * 1000;
  return Math.trunc(parsed);
}

export function trackingLookupCooldownMs() {
  const parsed = Number(env.indiaPostTrackingLookupCooldownMs);
  if (!Number.isFinite(parsed) || parsed < 0) return 15 * 60 * 1000;
  return Math.trunc(parsed);
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

export async function organizationHasTrackingCooldown(
  supabase: SupabaseClient,
  organizationId: string,
  code: "PERMANENT_AUTH_ERROR" | "TRACKING_LOOKUP_REJECTED",
  cooldownMs: number,
  now = Date.now()
) {
  const since = new Date(now - cooldownMs).toISOString();
  const { data } = await supabase
    .from("background_jobs")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("job_type", "tracking-sync")
    .eq("status", "FAILED")
    .eq("last_error_code", code)
    .gte("updated_at", since)
    .limit(1);
  return Boolean(data?.length);
}

export function dueTrackingShipmentsQuery(supabase: SupabaseClient, organizationId: string, cutoffIso: string) {
  return supabase
    .from("shipments")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .not("barcode", "is", null)
    .in("status", [...TRACKING_POLL_STATUSES])
    .or("operational_status.is.null,operational_status.neq.RTO_DELIVERED")
    .or(`last_tracked_at.is.null,last_tracked_at.lt.${cutoffIso}`);
}

export async function organizationHasDueTrackingShipments(
  supabase: SupabaseClient,
  organizationId: string,
  now = Date.now()
) {
  const { count, error } = await dueTrackingShipmentsQuery(supabase, organizationId, trackingSyncCutoffIso(now));
  if (error) return true;
  return (count ?? 0) > 0;
}

export async function enqueueOrgTrackingSyncIfIdle(
  supabase: SupabaseClient,
  organizationId: string
) {
  if (await organizationHasOpenTrackingSync(supabase, organizationId)) {
    return { enqueued: false, reason: "open-job" as const };
  }
  if (trackingP0CanaryActive() && isTrackingP0CanaryOrganization(organizationId) && !trackingP0CanaryAllowlist().length) {
    return { enqueued: false, reason: "canary-awaiting-allowlist" as const };
  }
  if (await organizationHasTrackingCooldown(supabase, organizationId, "PERMANENT_AUTH_ERROR", trackingAuthCooldownMs())) {
    return { enqueued: false, reason: "auth-cooldown" as const };
  }
  if (
    await organizationHasTrackingCooldown(
      supabase,
      organizationId,
      "TRACKING_LOOKUP_REJECTED",
      trackingLookupCooldownMs()
    )
  ) {
    return { enqueued: false, reason: "lookup-cooldown" as const };
  }
  if (!(await organizationHasDueTrackingShipments(supabase, organizationId))) {
    return { enqueued: false, reason: "not-due" as const };
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
