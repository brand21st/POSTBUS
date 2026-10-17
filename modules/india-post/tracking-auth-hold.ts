import type { SupabaseClient } from "@supabase/supabase-js";
import { isConfirmedTrackingAuthFailureJob } from "@/modules/india-post/login-auth";

export const TRACKING_AUTH_HOLD_DELAYS_MS = [
  15 * 60_000,
  60 * 60_000,
  4 * 60 * 60_000,
  12 * 60 * 60_000,
  24 * 60 * 60_000,
] as const;

export const TRACKING_AUTH_HOLD_HISTORY_LIMIT = 10;

type JobAuthRow = {
  id?: string;
  created_at?: string | null;
  last_error_code?: string | null;
  last_error?: string | null;
};

export type TrackingAuthHoldDecision = {
  blocked: boolean;
  reason: "idle" | "auth-hold" | "probe" | "probe-throttle";
  strikeCount: number;
  cooldownUntil: string | null;
  lastFailureAt: string | null;
};

function parseTime(value: string | null | undefined) {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function latestVerifiedAuthMs(input: {
  lastVerifiedAt?: string | null;
  lastRefreshedAt?: string | null;
}) {
  const times = [input.lastVerifiedAt, input.lastRefreshedAt]
    .map(parseTime)
    .filter((value): value is number => value != null);
  if (!times.length) return null;
  return Math.max(...times);
}

export function cooldownMsForAuthStrikes(strikeCount: number) {
  if (strikeCount < 1) return 0;
  const index = Math.min(strikeCount, TRACKING_AUTH_HOLD_DELAYS_MS.length) - 1;
  return TRACKING_AUTH_HOLD_DELAYS_MS[index];
}

export function decideTrackingAuthHold(input: {
  now?: number;
  failuresNewestFirst: JobAuthRow[];
  lastVerifiedAt?: string | null;
  lastRefreshedAt?: string | null;
  lastProbeAt?: string | null;
}): TrackingAuthHoldDecision {
  const now = input.now ?? Date.now();
  const authIndex = input.failuresNewestFirst.findIndex((row) => isConfirmedTrackingAuthFailureJob(row));
  const latest = authIndex >= 0 ? input.failuresNewestFirst[authIndex] : null;
  if (!latest) {
    return { blocked: false, reason: "idle", strikeCount: 0, cooldownUntil: null, lastFailureAt: null };
  }

  const failureAt = parseTime(latest.created_at);
  if (failureAt == null) {
    return { blocked: false, reason: "idle", strikeCount: 0, cooldownUntil: null, lastFailureAt: null };
  }

  const successAt = latestVerifiedAuthMs(input);
  if (successAt != null && successAt > failureAt) {
    return {
      blocked: false,
      reason: "idle",
      strikeCount: 0,
      cooldownUntil: null,
      lastFailureAt: latest.created_at ?? null,
    };
  }

  let strikeCount = 0;
  for (const row of input.failuresNewestFirst.slice(authIndex)) {
    const at = parseTime(row.created_at);
    if (at == null) break;
    if (successAt != null && at <= successAt) break;
    if (!isConfirmedTrackingAuthFailureJob(row)) break;
    strikeCount += 1;
  }
  if (strikeCount < 1) strikeCount = 1;

  const delayMs = cooldownMsForAuthStrikes(strikeCount);
  const failureCooldownUntilMs = failureAt + delayMs;
  const probeAt = parseTime(input.lastProbeAt);
  const probeThrottleUntilMs = probeAt != null ? probeAt + delayMs : 0;
  const blockedUntilMs = Math.max(failureCooldownUntilMs, probeThrottleUntilMs);
  const cooldownUntil = new Date(blockedUntilMs).toISOString();
  if (now < failureCooldownUntilMs) {
    return {
      blocked: true,
      reason: "auth-hold",
      strikeCount,
      cooldownUntil,
      lastFailureAt: latest.created_at ?? null,
    };
  }
  if (now < blockedUntilMs) {
    return {
      blocked: true,
      reason: "probe-throttle",
      strikeCount,
      cooldownUntil,
      lastFailureAt: latest.created_at ?? null,
    };
  }
  return {
    blocked: false,
    reason: "probe",
    strikeCount,
    cooldownUntil,
    lastFailureAt: latest.created_at ?? null,
  };
}

async function loadRecentTrackingSyncFailures(supabase: SupabaseClient, organizationId: string) {
  const { data, error } = await supabase
    .from("background_jobs")
    .select("id, created_at, last_error_code, last_error")
    .eq("organization_id", organizationId)
    .eq("job_type", "tracking-sync")
    .eq("status", "FAILED")
    .order("created_at", { ascending: false })
    .limit(TRACKING_AUTH_HOLD_HISTORY_LIMIT);
  if (error) {
    throw Object.assign(new Error(error.message), { code: "TEMPORARY_PROVIDER_FAILURE" });
  }
  return (data ?? []) as JobAuthRow[];
}

async function loadLatestTrackingSyncAfter(
  supabase: SupabaseClient,
  organizationId: string,
  afterIso: string
) {
  const { data, error } = await supabase
    .from("background_jobs")
    .select("id, created_at, status")
    .eq("organization_id", organizationId)
    .eq("job_type", "tracking-sync")
    .gt("created_at", afterIso)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) {
    throw Object.assign(new Error(error.message), { code: "TEMPORARY_PROVIDER_FAILURE" });
  }
  const rows = Array.isArray(data) ? data : data ? [data] : [];
  return (rows[0]?.created_at as string | null | undefined) ?? null;
}

export async function evaluateTrackingAuthHold(
  supabase: SupabaseClient,
  input: {
    organizationId: string;
    lastVerifiedAt?: string | null;
    lastRefreshedAt?: string | null;
    now?: number;
  }
): Promise<TrackingAuthHoldDecision> {
  const failuresNewestFirst = await loadRecentTrackingSyncFailures(supabase, input.organizationId);
  const authIndex = failuresNewestFirst.findIndex((row) => isConfirmedTrackingAuthFailureJob(row));
  if (authIndex < 0) {
    return { blocked: false, reason: "idle", strikeCount: 0, cooldownUntil: null, lastFailureAt: null };
  }
  const lastFailureAt = failuresNewestFirst[authIndex]?.created_at ?? null;
  const lastProbeAt = lastFailureAt
    ? await loadLatestTrackingSyncAfter(supabase, input.organizationId, lastFailureAt)
    : null;
  return decideTrackingAuthHold({
    now: input.now,
    failuresNewestFirst,
    lastVerifiedAt: input.lastVerifiedAt,
    lastRefreshedAt: input.lastRefreshedAt,
    lastProbeAt,
  });
}
