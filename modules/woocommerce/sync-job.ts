import type { SupabaseClient } from "@supabase/supabase-js";
import { logError, logInfo } from "@/lib/logger";
import { isAutoWooCommerceSyncEnabled } from "@/modules/automation/service";
import { createBackgroundJob } from "@/modules/jobs/service";
import { credentialsFromConnection, loadWooConnection } from "@/modules/woocommerce/connect";

const ACTIVE = ["QUEUED", "RUNNING", "RETRYING"];
const DUE = ["QUEUED", "PENDING", "RETRYING"];
/** Store-wide import jobs. Per-order webhook jobs use WOO_WEBHOOK_ENTITY so they never block a sync. */
const WOO_SYNC_ENTITY = "woocommerce_connection";
export const WOO_WEBHOOK_ENTITY = "woocommerce_webhook";
/** The scheduled fallback pulls recently modified orders at most this often per store. */
export const WOO_POLL_INTERVAL_MS = 10 * 60 * 1000;
const WOO_POLL_BATCH = 50;
/** Newest store events imported on each other-lane cron tick, without taking tracking's claim slots. */
export const WOO_SIDE_DRAIN_LIMIT = 8;

type WooJobRow = {
  id: string;
  organization_id: string;
  job_type: string;
  entity_type?: string | null;
  entity_id?: string | null;
  created_by?: string | null;
  attempt_count?: number | null;
  max_attempts?: number | null;
  status?: string | null;
  next_attempt_at?: string | null;
  created_at?: string | null;
  progress?: { mode?: string; shipmentIds?: string[] } | null;
};

function jobMode(progress: unknown) {
  if (!progress || typeof progress !== "object") return "";
  const mode = (progress as { mode?: unknown }).mode;
  return typeof mode === "string" ? mode : "";
}

function isDueWooJob(row: WooJobRow, now = Date.now()) {
  const attempts = row.attempt_count ?? 0;
  const max = row.max_attempts ?? 5;
  if (attempts >= max) return false;
  if (row.status === "RETRYING") {
    const next = row.next_attempt_at ? Date.parse(row.next_attempt_at) : now;
    return !Number.isNaN(next) && next <= now;
  }
  return row.status === "QUEUED" || row.status === "PENDING";
}

async function findActiveWooImport(
  supabase: SupabaseClient,
  organizationId: string
) {
  const { data, error } = await supabase
    .from("background_jobs")
    .select("id, progress")
    .eq("organization_id", organizationId)
    .eq("job_type", "woocommerce-sync")
    .eq("entity_type", WOO_SYNC_ENTITY)
    .in("status", ACTIVE)
    .order("created_at", { ascending: false })
    .limit(40);
  if (error) throw new Error(error.message);
  return ((data ?? []) as Array<{ id: string; progress?: unknown }>).find(
    (row) => jobMode(row.progress) !== "webhook"
  );
}

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
    const existing = await findActiveWooImport(supabase, input.organizationId);
    if (existing?.id) {
      return { queued: true as const, connected: true as const, jobId: existing.id, duplicate: true };
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

const WOO_JOB_COLUMNS =
  "id, organization_id, job_type, entity_type, entity_id, created_by, attempt_count, max_attempts, status, next_attempt_at, created_at, progress";

/**
 * Store webhooks are queued as woocommerce-sync. Production's other lane does not claim that
 * type, so new orders sat in QUEUED. This batch is newest-first and runs beside that lane.
 * One store-wide import is included so a polling fallback is not stuck behind webhook rows
 * that were saved with the connection entity type.
 */
export async function listWooCommerceJobsToDrain(supabase: SupabaseClient, limit = WOO_SIDE_DRAIN_LIMIT) {
  const webhookCap = Math.max(1, limit);
  const { data: webhookRows, error: webhookError } = await supabase
    .from("background_jobs")
    .select(WOO_JOB_COLUMNS)
    .eq("job_type", "woocommerce-sync")
    .eq("entity_type", WOO_WEBHOOK_ENTITY)
    .in("status", DUE)
    .order("created_at", { ascending: false })
    .limit(webhookCap * 3);
  if (webhookError) throw new Error(webhookError.message);

  const { data: connectionRows, error: connectionError } = await supabase
    .from("background_jobs")
    .select(WOO_JOB_COLUMNS)
    .eq("job_type", "woocommerce-sync")
    .eq("entity_type", WOO_SYNC_ENTITY)
    .in("status", DUE)
    .order("created_at", { ascending: false })
    .limit(40);
  if (connectionError) throw new Error(connectionError.message);

  const { data: oldestRows, error: oldestError } = await supabase
    .from("background_jobs")
    .select(WOO_JOB_COLUMNS)
    .eq("job_type", "woocommerce-sync")
    .eq("entity_type", WOO_SYNC_ENTITY)
    .in("status", DUE)
    .order("created_at", { ascending: true })
    .limit(40);
  if (oldestError) throw new Error(oldestError.message);

  const { data: trackingRows, error: trackingError } = await supabase
    .from("background_jobs")
    .select(WOO_JOB_COLUMNS)
    .eq("job_type", "woocommerce-tracking")
    .in("status", DUE)
    .order("created_at", { ascending: false })
    .limit(4);
  if (trackingError) throw new Error(trackingError.message);

  const now = Date.now();
  const due = (rows: unknown) => ((rows ?? []) as WooJobRow[]).filter((row) => isDueWooJob(row, now));
  const webhooks = [
    ...due(webhookRows),
    ...due(connectionRows).filter((row) => jobMode(row.progress) === "webhook"),
  ]
    .sort((left, right) => String(right.created_at ?? "").localeCompare(String(left.created_at ?? "")))
    .slice(0, webhookCap);
  const importJob =
    due(connectionRows).find((row) => jobMode(row.progress) !== "webhook") ??
    due(oldestRows).find((row) => jobMode(row.progress) !== "webhook");
  const tracking = due(trackingRows).slice(0, 3);
  const seen = new Set<string>();
  const picked: WooJobRow[] = [];
  for (const row of [...webhooks, ...(importJob ? [importJob] : []), ...tracking]) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    picked.push(row);
  }
  return picked.map((row) => ({
    id: row.id,
    organization_id: row.organization_id,
    job_type: row.job_type,
    entity_type: row.entity_type ?? null,
    entity_id: row.entity_id ?? null,
    created_by: row.created_by ?? null,
    attempt_count: row.attempt_count ?? 0,
    created_at: row.created_at ?? null,
    progress: row.progress ?? null,
  }));
}
