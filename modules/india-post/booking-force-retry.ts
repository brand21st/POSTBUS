import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import type { TenantContext } from "@/lib/api/context";
import { commercePendingBookingBlocked } from "@/lib/dashboard/records";
import { createBackgroundJob } from "@/modules/jobs/service";
import { loadLatestShipmentBookingJob } from "@/modules/jobs/shipment-booking-job";
import { readCeptSubmitIntentAt } from "@/modules/india-post/booking-intent";
import {
  bulkRetryBucket,
  evaluateBookingRetryEligibility,
  STALE_BOOKING_LOCK_MS,
  type BookingRetryAction,
  type BookingRetryDecision,
  type BookingRetryJob,
} from "@/modules/india-post/booking-retry-eligibility";
import { bookingForceRetryEnabled } from "@/modules/india-post/booking-recovery";

const REQUEUEABLE = ["DRAFT", "VALIDATING", "QUEUED", "FAILED"] as const;

type RetryExtras = {
  lengthCm?: number;
  widthCm?: number;
  heightCm?: number;
  weightGrams?: number;
};

export type ForceRetryResult = {
  shipmentId: string;
  jobId: string | null;
  scheduled: boolean;
  decision: BookingRetryDecision;
  message: string;
};

function conflict(decision: BookingRetryDecision) {
  return new AppError(ERROR_CODES.CONFLICT, decision.reason, { action: decision.action });
}

function asJob(row: Record<string, unknown> | null): BookingRetryJob {
  if (!row?.id) return null;
  return row as BookingRetryJob;
}

async function loadOwnedShipment(supabase: SupabaseClient, organizationId: string, shipmentId: string) {
  const { data, error } = await supabase
    .from("shipments")
    .select("id, status, booked_at, barcode, tracking_number, provider_ref, last_error_code, metadata, updated_at, organization_id")
    .eq("organization_id", organizationId)
    .eq("id", shipmentId)
    .maybeSingle();
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  return data;
}

export async function evaluateOwnedBookingRetry(
  supabase: SupabaseClient,
  organizationId: string,
  shipmentId: string
) {
  const shipment = await loadOwnedShipment(supabase, organizationId, shipmentId);
  if (!shipment) {
    return evaluateBookingRetryEligibility({ shipment: null });
  }
  const job = await loadLatestShipmentBookingJob(supabase, { organizationId, entityId: shipmentId });
  return evaluateBookingRetryEligibility({
    shipment,
    job: asJob(job as Record<string, unknown> | null),
  });
}

async function reuseOrCreateJob(
  supabase: SupabaseClient,
  ctx: TenantContext,
  shipmentId: string,
  job: Record<string, unknown> | null
) {
  const state = String(job?.status ?? "").toUpperCase();
  if (job?.id && (state === "QUEUED" || state === "PENDING")) {
    return job;
  }
  if (job?.id && state === "RETRYING") {
    const { data, error } = await supabase
      .from("background_jobs")
      .update({ status: "QUEUED", next_attempt_at: null, locked_at: null })
      .eq("id", job.id)
      .eq("organization_id", ctx.organizationId)
      .eq("status", "RETRYING")
      .select("*")
      .maybeSingle();
    if (error) throw new AppError(ERROR_CODES.JOB_FAILED, error.message);
    if (data) return data;
  }
  if (job?.id && state === "RUNNING") {
    const locked = Date.parse(String(job.locked_at ?? ""));
    const stale = Number.isFinite(locked) && Date.now() - locked >= STALE_BOOKING_LOCK_MS;
    if (!stale) throw conflict(evaluateBookingRetryEligibility({ shipment: { id: shipmentId, status: "BOOKING" }, job: asJob(job) }));
    const { data, error } = await supabase
      .from("background_jobs")
      .update({ status: "QUEUED", locked_at: null })
      .eq("id", job.id)
      .eq("organization_id", ctx.organizationId)
      .eq("status", "RUNNING")
      .select("*")
      .maybeSingle();
    if (error) throw new AppError(ERROR_CODES.JOB_FAILED, error.message);
    if (!data) throw conflict(evaluateBookingRetryEligibility({ shipment: { id: shipmentId, status: "BOOKING" } }));
    return data;
  }
  return createBackgroundJob(supabase, {
    organizationId: ctx.organizationId,
    jobType: "shipment-booking",
    entityType: "shipment",
    entityId: shipmentId,
    userId: ctx.userId,
  });
}

export async function scheduleForceRetryBooking(
  supabase: SupabaseClient,
  ctx: TenantContext,
  shipmentId: string,
  extras?: RetryExtras
): Promise<ForceRetryResult> {
  if (!bookingForceRetryEnabled()) {
    throw new AppError(ERROR_CODES.FORBIDDEN, "Retry booking is turned off.");
  }
  const shipment = await loadOwnedShipment(supabase, ctx.organizationId, shipmentId);
  const latest = shipment
    ? await loadLatestShipmentBookingJob(supabase, { organizationId: ctx.organizationId, entityId: shipmentId })
    : null;
  const decision = evaluateBookingRetryEligibility({
    shipment,
    job: asJob(latest as Record<string, unknown> | null),
  });
  if (decision.action === "RETRY_ALREADY_SCHEDULED") {
    return {
      shipmentId,
      jobId: decision.existingJobId ?? null,
      scheduled: false,
      decision,
      message: decision.reason,
    };
  }
  if (!decision.eligible) throw conflict(decision);
  if (readCeptSubmitIntentAt(shipment?.metadata)) {
    throw conflict(evaluateBookingRetryEligibility({ shipment, job: asJob(latest as Record<string, unknown> | null) }));
  }

  const patch: Record<string, unknown> = {
    status: "QUEUED",
    last_error: null,
    last_error_code: null,
  };
  if (extras?.weightGrams != null && extras.weightGrams > 0) patch.weight_grams = Math.round(extras.weightGrams);
  if (extras?.lengthCm != null && extras.lengthCm > 0) patch.length_cm = extras.lengthCm;
  if (extras?.widthCm != null && extras.widthCm > 0) patch.width_cm = extras.widthCm;
  if (extras?.heightCm != null && extras.heightCm > 0) patch.height_cm = extras.heightCm;

  const { data: claimed, error: claimError } = await supabase
    .from("shipments")
    .update(patch)
    .eq("id", shipmentId)
    .eq("organization_id", ctx.organizationId)
    .is("booked_at", null)
    .is("barcode", null)
    .is("tracking_number", null)
    .is("provider_ref", null)
    .in("status", [...REQUEUEABLE])
    .filter("metadata->>ceptSubmitIntentAt", "is", null)
    .select("id")
    .maybeSingle();
  if (claimError) throw new AppError(ERROR_CODES.VALIDATION_ERROR, claimError.message);
  if (!claimed) {
    const again = await loadOwnedShipment(supabase, ctx.organizationId, shipmentId);
    throw conflict(evaluateBookingRetryEligibility({ shipment: again }));
  }

  const job = await reuseOrCreateJob(supabase, ctx, shipmentId, latest as Record<string, unknown> | null);
  const { claimedJobFromRow, runQueuedJobsNow } = await import("@/lib/jobs/drain");
  await runQueuedJobsNow([claimedJobFromRow(job)]);

  await supabase
    .from("audit_logs")
    .insert({
      organization_id: ctx.organizationId,
      actor_id: ctx.userId,
      action: "shipment.force_retry",
      entity_type: "shipment",
      entity_id: shipmentId,
      after: { jobId: job.id, previousStatus: shipment?.status ?? null },
    })
    .then(() => undefined, () => undefined);

  return {
    shipmentId,
    jobId: job.id,
    scheduled: true,
    decision,
    message: "Retry scheduled.",
  };
}

type BulkRow = {
  id: string;
  status?: string | null;
  booked_at?: string | null;
  barcode?: string | null;
  tracking_number?: string | null;
  provider_ref?: string | null;
  last_error_code?: string | null;
  metadata?: unknown;
  updated_at?: string | null;
  orders?: { source?: string | null; payment_status?: string | null } | { source?: string | null; payment_status?: string | null }[] | null;
};

export async function forceRetryBookingBatch(
  supabase: SupabaseClient,
  ctx: TenantContext,
  shipmentIds: string[]
) {
  if (!bookingForceRetryEnabled()) {
    throw new AppError(ERROR_CODES.FORBIDDEN, "Retry booking is turned off.");
  }
  const ids = [...new Set(shipmentIds.map((id) => String(id || "").trim()).filter(Boolean))].slice(0, 25);
  if (!ids.length) throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Select at least one shipment.");

  const [{ data: rows, error: rowError }, { data: jobs, error: jobError }] = await Promise.all([
    supabase
      .from("shipments")
      .select(
        "id, status, booked_at, barcode, tracking_number, provider_ref, last_error_code, metadata, updated_at, orders(source, payment_status)"
      )
      .eq("organization_id", ctx.organizationId)
      .in("id", ids),
    supabase
      .from("background_jobs")
      .select("id, entity_id, status, attempt_count, max_attempts, next_attempt_at, locked_at, created_at")
      .eq("organization_id", ctx.organizationId)
      .eq("job_type", "shipment-booking")
      .eq("entity_type", "shipment")
      .in("entity_id", ids)
      .order("created_at", { ascending: false }),
  ]);
  if (rowError) throw new AppError(ERROR_CODES.VALIDATION_ERROR, rowError.message);
  if (jobError) throw new AppError(ERROR_CODES.VALIDATION_ERROR, jobError.message);

  const byId = new Map((rows ?? []).map((row) => [String((row as BulkRow).id), row as BulkRow]));
  const latestJob = new Map<string, Record<string, unknown>>();
  for (const job of jobs ?? []) {
    const entityId = String((job as { entity_id?: string }).entity_id ?? "");
    if (entityId && !latestJob.has(entityId)) latestJob.set(entityId, job as Record<string, unknown>);
  }

  const summary = {
    eligible: 0,
    scheduled: 0,
    alreadyProcessing: 0,
    needsReview: 0,
    failedValidation: 0,
    results: [] as Array<{ shipmentId: string; action: BookingRetryAction; message: string }>,
  };

  for (const id of ids) {
    const row = byId.get(id);
    if (!row) {
      summary.failedValidation += 1;
      summary.results.push({ shipmentId: id, action: "INVALID_SHIPMENT", message: "Shipment could not be retried." });
      continue;
    }
    const order = Array.isArray(row.orders) ? row.orders[0] : row.orders;
    if (commercePendingBookingBlocked(order ?? {})) {
      summary.failedValidation += 1;
      summary.results.push({
        shipmentId: id,
        action: "INVALID_SHIPMENT",
        message: "Payment must be confirmed as Prepaid or COD before booking.",
      });
      continue;
    }
    const decision = evaluateBookingRetryEligibility({ shipment: row, job: asJob(latestJob.get(id) ?? null) });
    const bucket = bulkRetryBucket(decision.action);
    if (bucket === "needsReview") summary.needsReview += 1;
    else if (bucket === "alreadyProcessing") summary.alreadyProcessing += 1;
    else if (bucket === "failedValidation") summary.failedValidation += 1;
    else summary.eligible += 1;

    if (decision.action !== "SAFE_TO_REQUEUE") {
      summary.results.push({ shipmentId: id, action: decision.action, message: decision.reason });
      continue;
    }
    try {
      const scheduled = await scheduleForceRetryBooking(supabase, ctx, id);
      if (scheduled.scheduled) summary.scheduled += 1;
      else summary.alreadyProcessing += 1;
      summary.results.push({ shipmentId: id, action: scheduled.decision.action, message: scheduled.message });
    } catch (error) {
      const action = ((error as AppError).details as { action?: BookingRetryAction } | undefined)?.action;
      const resolved = action ?? "INVALID_SHIPMENT";
      const bucketAfter = bulkRetryBucket(resolved);
      if (bucketAfter === "needsReview") summary.needsReview += 1;
      else if (bucketAfter === "alreadyProcessing") summary.alreadyProcessing += 1;
      else summary.failedValidation += 1;
      summary.eligible = Math.max(0, summary.eligible - 1);
      summary.results.push({
        shipmentId: id,
        action: resolved,
        message: error instanceof Error ? error.message : "Shipment could not be retried.",
      });
    }
  }

  return summary;
}
