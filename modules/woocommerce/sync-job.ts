import type { SupabaseClient } from "@supabase/supabase-js";
import { logError, logInfo } from "@/lib/logger";
import { isAutoWooCommerceSyncEnabled } from "@/modules/automation/service";
import { createBackgroundJob } from "@/modules/jobs/service";
import { credentialsFromConnection, loadWooConnection } from "@/modules/woocommerce/connect";

const ACTIVE = ["QUEUED", "RUNNING", "RETRYING"];
/** Store-wide import jobs. Per-order webhook jobs use WOO_WEBHOOK_ENTITY so they never block a sync. */
const WOO_SYNC_ENTITY = "woocommerce_connection";
export const WOO_WEBHOOK_ENTITY = "woocommerce_webhook";
/** The scheduled fallback pulls recently modified orders at most this often per store. */
export const WOO_POLL_INTERVAL_MS = 10 * 60 * 1000;
const WOO_POLL_BATCH = 50;

export async function enqueueWooCommerceSync(
  supabase: SupabaseClient,
  input: {
    organizationId: string;
    userId?: string;
    force?: boolean;
    page?: number;
    imported?: number;
    updated?: number;
    skipped?: number;
  }
) {
  const connection = await loadWooConnection(supabase, input.organizationId);
  if (!connection || connection.status !== "CONNECTED" || !credentialsFromConnection(connection)) {
    return { queued: false as const, connected: false as const, jobId: null, duplicate: false };
  }
  if (!input.page) {
    const { data: existing } = await supabase
      .from("background_jobs")
      .select("id, status")
      .eq("organization_id", input.organizationId)
      .eq("job_type", "woocommerce-sync")
      .eq("entity_type", WOO_SYNC_ENTITY)
      .in("status", ACTIVE)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existing?.id) {
      return { queued: true as const, connected: true as const, jobId: existing.id as string, duplicate: true };
    }
  }
  const job = await createBackgroundJob(supabase, {
    organizationId: input.organizationId,
    jobType: "woocommerce-sync",
    entityType: WOO_SYNC_ENTITY,
    entityId: connection.id,
    userId: input.userId,
    progress: {
      mode: "import",
      force: Boolean(input.force),
      page: input.page ?? 1,
      imported: input.imported ?? 0,
      updated: input.updated ?? 0,
      skipped: input.skipped ?? 0,
    },
  });
  return { queued: true as const, connected: true as const, jobId: job.id as string, duplicate: false };
}

export async function enqueueWooWebhookJob(
  supabase: SupabaseClient,
  input: {
    organizationId: string;
    connectionId: string;
    deliveryId: string;
    topic: string;
    orderId: string;
  }
) {
  const job = await createBackgroundJob(supabase, {
    organizationId: input.organizationId,
    jobType: "woocommerce-sync",
    entityType: WOO_WEBHOOK_ENTITY,
    entityId: input.connectionId,
    progress: {
      mode: "webhook",
      force: true,
      deliveryId: input.deliveryId,
      topic: input.topic,
      orderId: input.orderId,
    },
  });
  return job.id as string;
}

/**
 * Polling fallback for stores whose webhooks are missing, disabled or dropped deliveries.
 * Enqueues a non-forced (incremental, flag-gated) sync for connected stores not synced recently.
 */
export async function enqueueDueWooCommerceSyncJobs(
  supabase: SupabaseClient,
  options: { now?: Date; intervalMs?: number } = {}
) {
  const now = options.now ?? new Date();
  const cutoff = now.getTime() - (options.intervalMs ?? WOO_POLL_INTERVAL_MS);
  const { data, error } = await supabase
    .from("woocommerce_connections")
    .select("organization_id, last_sync_at")
    .eq("status", "CONNECTED")
    .eq("sync_enabled", true)
    .order("last_sync_at", { ascending: true, nullsFirst: true })
    .limit(WOO_POLL_BATCH * 4);
  if (error) {
    logError("woocommerce.poll_list_failed", { message: error.message });
    return { checked: 0, queued: 0 };
  }
  const due = ((data ?? []) as Array<{ organization_id: string; last_sync_at?: string | null }>)
    .filter((row) => {
      const last = row.last_sync_at ? Date.parse(row.last_sync_at) : Number.NaN;
      return Number.isNaN(last) || last <= cutoff;
    })
    .slice(0, WOO_POLL_BATCH);
  let queued = 0;
  for (const row of due) {
    try {
      if (!(await isAutoWooCommerceSyncEnabled(supabase, row.organization_id))) continue;
      const result = await enqueueWooCommerceSync(supabase, { organizationId: row.organization_id, force: false });
      if (result.queued && !result.duplicate) queued += 1;
    } catch (enqueueError) {
      logError("woocommerce.poll_enqueue_failed", {
        organizationId: row.organization_id,
        message: enqueueError instanceof Error ? enqueueError.message : "enqueue failed",
      });
    }
  }
  if (queued) logInfo("woocommerce.poll_enqueued", { checked: due.length, queued });
  return { checked: due.length, queued };
}
