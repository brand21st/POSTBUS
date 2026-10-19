import type { SupabaseClient } from "@supabase/supabase-js";
import { logError } from "@/lib/logger";
import { AI_ACCOUNTANT_SLUG } from "@/modules/addons/constants";
import { accessModeForAddonStatus } from "@/modules/addons/entitlements";
import { addDays, istDate } from "@/modules/ai-accountant/period";
import { createBackgroundJob } from "@/modules/jobs/service";

const RESYNC_AFTER_MS = 20 * 60 * 60 * 1000;
const LOOKBACK_DAYS = 35;

/**
 * Queues one accounting-rebuild job per org with a live AI Accountant add-on whose
 * ledger has not synced in 20 hours. Re-syncing 35 days catches late RTOs and COD remittances.
 */
export async function enqueueDueLedgerSyncJobs(supabase: SupabaseClient, now = new Date()) {
  const { data: entitlements } = await supabase
    .from("organization_entitlements")
    .select("organization_id, status, current_period_end")
    .eq("addon_slug", AI_ACCOUNTANT_SLUG)
    .limit(5000);
  const live = (entitlements ?? [])
    .filter((row) => accessModeForAddonStatus({ status: row.status, currentPeriodEnd: row.current_period_end, now }) === "FULL")
    .map((row) => row.organization_id as string);
  if (!live.length) return { queued: 0 };

  const [{ data: settings }, { data: pending }] = await Promise.all([
    supabase.from("accounting_settings").select("organization_id, last_synced_at").in("organization_id", live),
    supabase
      .from("background_jobs")
      .select("organization_id")
      .eq("job_type", "accounting-rebuild")
      .in("status", ["PENDING", "QUEUED", "RUNNING", "RETRYING"])
      .in("organization_id", live),
  ]);
  const lastSync = new Map((settings ?? []).map((row) => [row.organization_id as string, row.last_synced_at as string | null]));
  const busy = new Set((pending ?? []).map((row) => row.organization_id as string));
  const today = istDate(now);
  let queued = 0;
  for (const organizationId of live) {
    if (busy.has(organizationId)) continue;
    const last = lastSync.get(organizationId);
    if (last && now.getTime() - new Date(last).getTime() < RESYNC_AFTER_MS) continue;
    try {
      await createBackgroundJob(supabase, {
        organizationId,
        jobType: "accounting-rebuild",
        progress: { from: addDays(today, -LOOKBACK_DAYS), to: today },
      });
      queued += 1;
    } catch (error) {
      logError("ai_accountant.ledger_enqueue_failed", { organizationId, message: error instanceof Error ? error.message : "unknown" });
    }
  }
  return { queued };
}
