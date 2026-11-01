import type { SupabaseClient } from "@supabase/supabase-js";
import { logError, logInfo } from "@/lib/logger";
import { startBookingJobs } from "@/modules/booking-queue/actions";
import { bookingQueueAutomationEnabledFor } from "@/modules/booking-queue/flags";
import { automaticRunDue, planAutomaticRuns, tickLimits, type ReadyItem } from "@/modules/booking-queue/planner";
import { createBackgroundJob } from "@/modules/jobs/service";

/**
 * Automatic Bulk Booking, run from the job drain (`/api/cron/jobs`), so it keeps working with no
 * one signed in. Two steps:
 *   1. scan  - a cheap check per automatic workspace; a due workspace gets one dispatch job.
 *   2. dispatch job - plans batches from READY items and calls dispatch_booking_run, the same
 *      transaction manual booking uses. Items are locked and state-checked there, so a duplicate
 *      job or a worker restart can never book an item twice.
 */

export const DISPATCH_JOB_TYPE = "booking-queue-dispatch" as const;
/** Consecutive dispatch failures before automatic booking holds itself. */
export const AUTO_HOLD_AFTER_ERRORS = 3;
export const AUTO_HOLD_MINUTES = 15;
const ACTIVE_JOB_STATUSES = ["PENDING", "QUEUED", "RUNNING", "RETRYING"];

type AutomaticSettings = {
  organization_id: string;
  batch_threshold: number;
  max_wait_minutes: number | null;
  auto_hold_until: string | null;
  version?: number;
  consecutive_errors?: number;
};

function onHold(settings: { auto_hold_until: string | null }, now: Date) {
  return Boolean(settings.auto_hold_until && Date.parse(settings.auto_hold_until) > now.getTime());
}

async function readyStats(admin: SupabaseClient, organizationId: string) {
  const [{ count }, { data: oldest }] = await Promise.all([
    admin
      .from("booking_queue_items")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("state", "READY_FOR_BOOKING"),
    admin
      .from("booking_queue_items")
      .select("ready_at")
      .eq("organization_id", organizationId)
      .eq("state", "READY_FOR_BOOKING")
      .order("ready_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
  ]);
  return { readyCount: count ?? 0, oldestReadyAt: (oldest?.ready_at as string | undefined) ?? null };
}

/**
 * Scheduler scan. Only workspaces in AUTOMATIC mode, not paused, not on hold and inside the
 * automation rollout are considered; cost grows with those workspaces' READY items, not history.
 */
export async function enqueueDueBookingQueueDispatches(admin: SupabaseClient, now = new Date()) {
  const result = { candidates: 0, due: 0, enqueued: 0 };
  const { data: rows, error } = await admin
    .from("booking_automation_settings")
    .select("organization_id, batch_threshold, max_wait_minutes, auto_hold_until")
    .eq("mode", "AUTOMATIC")
    .is("paused_at", null);
  if (error) {
    // Tables missing (migration not applied) or a transient error: nothing to schedule.
    return result;
  }
  for (const row of (rows ?? []) as AutomaticSettings[]) {
    if (!bookingQueueAutomationEnabledFor(row.organization_id) || onHold(row, now)) continue;
    result.candidates += 1;
    try {
      const stats = await readyStats(admin, row.organization_id);
      const due = automaticRunDue({
        ...stats,
        threshold: Number(row.batch_threshold) || 50,
        maxWaitMinutes: row.max_wait_minutes == null ? null : Number(row.max_wait_minutes),
        now,
      });
      if (!due) continue;
      result.due += 1;
      const { data: active } = await admin
        .from("background_jobs")
        .select("id")
        .eq("organization_id", row.organization_id)
        .eq("job_type", DISPATCH_JOB_TYPE)
        .in("status", ACTIVE_JOB_STATUSES)
        .limit(1)
        .maybeSingle();
      if (active) continue;
      await createBackgroundJob(admin, {
        organizationId: row.organization_id,
        jobType: DISPATCH_JOB_TYPE,
        entityType: "organization",
        entityId: row.organization_id,
      });
      result.enqueued += 1;
    } catch (scanError) {
      logError("booking_queue.scan_failed", {
        organizationId: row.organization_id,
        message: scanError instanceof Error ? scanError.message : "unknown",
      });
    }
  }
  if (result.candidates) logInfo("booking_queue.scan", result);
  return result;
}

async function notify(admin: SupabaseClient, organizationId: string, title: string, body: string) {
  try {
    await admin.from("notifications").insert({
      organization_id: organizationId,
      type: "booking_queue.attention",
      title,
      body,
      entity_type: "booking_automation_settings",
      entity_id: organizationId,
    });
  } catch {
    // Alerts are optional; the dashboard shows the same error.
  }
}

async function recordFailure(admin: SupabaseClient, settings: AutomaticSettings, message: string, now: Date) {
  const errors = (Number(settings.consecutive_errors) || 0) + 1;
  const hold = errors >= AUTO_HOLD_AFTER_ERRORS;
  await admin
    .from("booking_automation_settings")
    .update({
      last_error: message,
      last_error_at: now.toISOString(),
      consecutive_errors: errors,
      ...(hold
        ? {
            auto_hold_until: new Date(now.getTime() + AUTO_HOLD_MINUTES * 60_000).toISOString(),
            auto_hold_reason: message,
          }
        : {}),
    })
    .eq("organization_id", settings.organization_id);
  if (hold) {
    await notify(
      admin,
      settings.organization_id,
      "Automatic booking is on hold",
      `Automatic Bulk Booking stopped for ${AUTO_HOLD_MINUTES} minutes after ${errors} failed attempts: ${message}`
    );
  }
}

export type AutomaticDispatchResult = {
  skipped?: "OFF" | "NOT_AUTOMATIC" | "ON_HOLD" | "NOTHING_DUE";
  runs: Array<{ runId: string | null; trigger: string; dispatched: number; skipped: number }>;
};

/**
 * Dispatch job for one workspace. Settings are read once; a change while this runs only affects
 * the next tick, and never cancels or repeats a run already started. Run keys come from the job
 * id, so a retried job replays its runs instead of booking again.
 */
export async function runAutomaticDispatch(
  admin: SupabaseClient,
  organizationId: string,
  jobId: string,
  now = new Date()
): Promise<AutomaticDispatchResult> {
  if (!bookingQueueAutomationEnabledFor(organizationId)) return { skipped: "OFF", runs: [] };
  const { data: settingsRow, error: settingsError } = await admin
    .from("booking_automation_settings")
    .select("organization_id, mode, paused_at, batch_threshold, max_wait_minutes, auto_hold_until, version, consecutive_errors")
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (settingsError) throw new Error(settingsError.message);
  const settings = settingsRow as (AutomaticSettings & { mode: string; paused_at: string | null }) | null;
  if (!settings || settings.mode !== "AUTOMATIC" || settings.paused_at) return { skipped: "NOT_AUTOMATIC", runs: [] };
  if (onHold(settings, now)) return { skipped: "ON_HOLD", runs: [] };

  const threshold = Number(settings.batch_threshold) || 50;
  const maxWaitMinutes = settings.max_wait_minutes == null ? null : Number(settings.max_wait_minutes);
  const { data: ready, error: readyError } = await admin
    .from("booking_queue_items")
    .select("id, ready_at")
    .eq("organization_id", organizationId)
    .eq("state", "READY_FOR_BOOKING")
    .order("ready_at", { ascending: true })
    .limit(tickLimits(threshold).items);
  if (readyError) throw new Error(readyError.message);
  const items: ReadyItem[] = (ready ?? []).map((row) => ({ id: String(row.id), readyAt: String(row.ready_at) }));
  const planned = planAutomaticRuns(items, { threshold, maxWaitMinutes, now });
  if (!planned.length) return { skipped: "NOTHING_DUE", runs: [] };

  const runs: AutomaticDispatchResult["runs"] = [];
  try {
    const { checkQuota } = await import("@/modules/billing/usage");
    await checkQuota(admin, organizationId, planned.reduce((sum, run) => sum + run.itemIds.length, 0));
    for (const [index, run] of planned.entries()) {
      const { data, error } = await admin.rpc("dispatch_booking_run", {
        p_organization_id: organizationId,
        p_item_ids: run.itemIds,
        p_idempotency_key: `auto-${jobId}-${index}`,
        p_trigger: run.trigger,
        p_group_key: "AUTO",
        p_created_by: null,
        p_settings_version: settings.version ?? null,
      });
      if (error) throw new Error(error.message);
      const result = (data ?? {}) as {
        runId?: string | null;
        replayed?: boolean;
        paused?: boolean;
        dispatched?: Array<{ jobId?: string | null }>;
        skipped?: unknown[];
      };
      // Paused or switched to manual between the read above and this call: stop quietly.
      if (result.paused) break;
      runs.push({
        runId: result.runId ?? null,
        trigger: run.trigger,
        dispatched: result.dispatched?.length ?? 0,
        skipped: result.skipped?.length ?? 0,
      });
      if (!result.replayed) {
        await startBookingJobs(
          admin,
          organizationId,
          (result.dispatched ?? []).map((row) => String(row.jobId ?? "")).filter(Boolean)
        );
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Automatic booking failed.";
    logError("booking_queue.auto_dispatch_failed", { organizationId, jobId, message });
    await recordFailure(admin, settings, message, now);
    throw error;
  }

  await admin
    .from("booking_automation_settings")
    .update({ last_dispatch_at: now.toISOString(), consecutive_errors: 0, last_error: null, last_error_at: null })
    .eq("organization_id", organizationId);
  logInfo("booking_queue.auto_dispatched", {
    organizationId,
    jobId,
    runs: runs.length,
    dispatched: runs.reduce((sum, run) => sum + run.dispatched, 0),
  });
  return { runs };
}
