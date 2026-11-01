import type { SupabaseClient } from "@supabase/supabase-js";
import type { TenantContext } from "@/lib/api/context";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { usesDatabaseJobRunner } from "@/lib/env";
import { logError, logInfo } from "@/lib/logger";
import { createAdminClient, hasAdminClient } from "@/lib/supabase/admin";
import { assertBookingQueueEnabled, validateQueuedOrders } from "@/modules/booking-queue/service";
import type { BookingQueueState } from "@/modules/booking-queue/state";

export const QUEUE_ACTION_MAX_ITEMS = 5000;

export type QueueActionResult = {
  applied: string[];
  skipped: Array<{ itemId: string; reason: string }>;
};

function uniqueIds(ids: string[]) {
  return [...new Set(ids.map((id) => String(id ?? "").trim()).filter(Boolean))];
}

function assertIdCount(ids: string[]) {
  if (!ids.length) throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Select at least one order.");
  if (ids.length > QUEUE_ACTION_MAX_ITEMS) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, `Select at most ${QUEUE_ACTION_MAX_ITEMS} orders at a time.`);
  }
}

/**
 * Moves the given items from one of `from` to `to`, only where they still are in `from`
 * (compare-and-set). Items in any other state are reported, never forced.
 */
async function moveItems(
  supabase: SupabaseClient,
  ctx: TenantContext,
  ids: string[],
  from: BookingQueueState[],
  patch: Record<string, unknown> & { state: BookingQueueState },
  skipReason: string
): Promise<QueueActionResult> {
  const { data, error } = await supabase
    .from("booking_queue_items")
    .update(patch)
    .eq("organization_id", ctx.organizationId)
    .in("id", ids)
    .in("state", from)
    .select("id");
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  const applied = (data ?? []).map((row) => String(row.id));
  const done = new Set(applied);
  return { applied, skipped: ids.filter((id) => !done.has(id)).map((itemId) => ({ itemId, reason: skipReason })) };
}

/**
 * Approve selected items for booking (WAITING_APPROVAL -> READY_FOR_BOOKING). Approval never
 * calls India Post; booking is a separate, confirmed action.
 */
export async function approveItems(supabase: SupabaseClient, ctx: TenantContext, itemIds: string[]) {
  assertBookingQueueEnabled(ctx);
  const ids = uniqueIds(itemIds);
  assertIdCount(ids);
  const result = await moveItems(
    supabase,
    ctx,
    ids,
    ["WAITING_APPROVAL"],
    { state: "READY_FOR_BOOKING", approved_by: ctx.userId || null, approved_at: new Date().toISOString() },
    "Only orders waiting for approval can be approved."
  );
  logInfo("booking_queue.approved", { organizationId: ctx.organizationId, applied: result.applied.length });
  return result;
}

/**
 * Approve every item waiting for approval. `expectedCount` is what the person saw in the
 * confirmation; if the queue changed since, nothing is approved and the new count is returned.
 */
export async function approveAllWaiting(supabase: SupabaseClient, ctx: TenantContext, expectedCount: number) {
  assertBookingQueueEnabled(ctx);
  const { data, error, count } = await supabase
    .from("booking_queue_items")
    .select("id", { count: "exact" })
    .eq("organization_id", ctx.organizationId)
    .eq("state", "WAITING_APPROVAL")
    .limit(QUEUE_ACTION_MAX_ITEMS);
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  const total = count ?? 0;
  if (total !== expectedCount) {
    throw new AppError(
      ERROR_CODES.CONFLICT,
      `The queue changed: ${total} orders are waiting for approval now. Review and try again.`,
      { currentCount: total }
    );
  }
  if (!total) return { applied: [], skipped: [] } satisfies QueueActionResult;
  if (total > QUEUE_ACTION_MAX_ITEMS) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, `Approve at most ${QUEUE_ACTION_MAX_ITEMS} orders at a time.`);
  }
  return approveItems(supabase, ctx, (data ?? []).map((row) => String(row.id)));
}

/** Leave items out of booking. They stay visible and can be checked again later. */
export async function excludeItems(supabase: SupabaseClient, ctx: TenantContext, itemIds: string[]) {
  assertBookingQueueEnabled(ctx);
  const ids = uniqueIds(itemIds);
  assertIdCount(ids);
  return moveItems(
    supabase,
    ctx,
    ids,
    ["PENDING_VALIDATION", "INVALID", "WAITING_APPROVAL", "READY_FOR_BOOKING"],
    { state: "EXCLUDED", last_error: null, last_error_code: null },
    "Orders that are booking or booked cannot be excluded."
  );
}

/**
 * Check excluded or invalid items again (for example after fixing an address), using the same
 * validation as enrollment.
 */
export async function revalidateItems(supabase: SupabaseClient, ctx: TenantContext, itemIds: string[]) {
  assertBookingQueueEnabled(ctx);
  const ids = uniqueIds(itemIds);
  assertIdCount(ids);
  const moved = await moveItems(
    supabase,
    ctx,
    ids,
    ["INVALID", "EXCLUDED", "WAITING_APPROVAL", "READY_FOR_BOOKING"],
    { state: "PENDING_VALIDATION", last_error: null, last_error_code: null, issues: [] },
    "Only orders that are not booking can be checked again."
  );
  if (!moved.applied.length) return moved;
  const { data: rows, error } = await supabase
    .from("booking_queue_items")
    .select("id, order_id")
    .eq("organization_id", ctx.organizationId)
    .in("id", moved.applied);
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  await validateQueuedOrders(
    supabase,
    ctx,
    (rows ?? []).map((row) => ({ itemId: String(row.id), orderId: String(row.order_id) }))
  );
  return moved;
}

export type DispatchResult = {
  runId: string | null;
  replayed: boolean;
  dispatched: Array<{ itemId: string; shipmentId: string; jobId?: string | null }>;
  skipped: Array<{ itemId: string; reason: string }>;
};

type JobRow = {
  id: string;
  organization_id: string;
  job_type: string;
  entity_type: string | null;
  entity_id: string | null;
  created_by: string | null;
  attempt_count: number | null;
  progress: Record<string, unknown> | null;
};

/** Hands newly created booking jobs to whichever runner this deployment uses. */
export async function startBookingJobs(admin: SupabaseClient, organizationId: string, jobIds: string[]) {
  if (!jobIds.length) return;
  const { data } = await admin
    .from("background_jobs")
    .select("id, organization_id, job_type, entity_type, entity_id, created_by, attempt_count, progress")
    .eq("organization_id", organizationId)
    .in("id", jobIds)
    .eq("status", "QUEUED");
  const jobs = (data ?? []) as JobRow[];
  if (!jobs.length) return;
  if (usesDatabaseJobRunner()) {
    const { claimedJobFromRow, startQueuedBookingJobs } = await import("@/lib/jobs/drain");
    await startQueuedBookingJobs(jobs.map((row) => claimedJobFromRow(row as Parameters<typeof claimedJobFromRow>[0])));
    return;
  }
  const { enqueueJob } = await import("@/lib/queue/queues");
  for (const job of jobs) {
    try {
      await enqueueJob("shipment-booking", {
        organizationId: job.organization_id,
        jobId: job.id,
        entityType: job.entity_type ?? undefined,
        entityId: job.entity_id ?? undefined,
        userId: job.created_by ?? undefined,
      });
    } catch (error) {
      logError("booking_queue.enqueue_failed", {
        jobId: job.id,
        message: error instanceof Error ? error.message : "redis unavailable",
      });
      await admin
        .from("background_jobs")
        .update({
          last_error: "Redis is unreachable. Set JOB_RUNNER=database or start the BullMQ workers.",
          last_error_code: "QUEUE_UNAVAILABLE",
        })
        .eq("id", job.id);
    }
  }
}

/**
 * Book the selected approved items with India Post. One database transaction creates the run,
 * hands each shipment to the existing booking job and marks the items BATCHED; the same
 * idempotency key always returns the same run. Only READY_FOR_BOOKING items are booked.
 */
export async function dispatchItems(
  supabase: SupabaseClient,
  ctx: TenantContext,
  input: { itemIds: string[]; idempotencyKey: string }
): Promise<DispatchResult> {
  assertBookingQueueEnabled(ctx);
  const ids = uniqueIds(input.itemIds);
  assertIdCount(ids);
  const key = String(input.idempotencyKey ?? "").trim();
  if (key.length < 8 || key.length > 120) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Booking request is missing its confirmation key. Open the dialog again.");
  }
  if (!hasAdminClient()) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Background booking is not configured on this server.");
  }

  // Count only what can actually be booked, so a quota error is about real bookings.
  const { count: readyCount, error: readyError } = await supabase
    .from("booking_queue_items")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", ctx.organizationId)
    .in("id", ids)
    .eq("state", "READY_FOR_BOOKING");
  if (readyError) throw new AppError(ERROR_CODES.VALIDATION_ERROR, readyError.message);
  if (readyCount) {
    const { checkQuota } = await import("@/modules/billing/usage");
    await checkQuota(supabase, ctx.organizationId, readyCount);
  }

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("dispatch_booking_run", {
    p_organization_id: ctx.organizationId,
    p_item_ids: ids,
    p_idempotency_key: key,
    p_trigger: "MANUAL",
    p_group_key: "MANUAL",
    p_created_by: ctx.userId || null,
  });
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  const result = (data ?? {}) as Partial<DispatchResult>;
  const dispatched = Array.isArray(result.dispatched) ? result.dispatched : [];
  const outcome: DispatchResult = {
    runId: result.runId ?? null,
    replayed: Boolean(result.replayed),
    dispatched,
    skipped: Array.isArray(result.skipped) ? result.skipped : [],
  };
  logInfo("booking_queue.dispatched", {
    organizationId: ctx.organizationId,
    runId: outcome.runId,
    replayed: outcome.replayed,
    dispatched: dispatched.length,
    skipped: outcome.skipped.length,
  });
  // A replay never starts jobs again; the original request already did.
  if (!outcome.replayed) {
    await startBookingJobs(
      admin,
      ctx.organizationId,
      dispatched.map((row) => String(row.jobId ?? "")).filter(Boolean)
    );
  }
  return outcome;
}
