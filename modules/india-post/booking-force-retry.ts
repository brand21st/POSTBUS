import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import type { TenantContext } from "@/lib/api/context";
import { commercePendingBookingBlocked } from "@/lib/dashboard/records";
import { createBackgroundJob } from "@/modules/jobs/service";
import { loadLatestShipmentBookingJob } from "@/modules/jobs/shipment-booking-job";
import {
  metadataWithCeptForceResubmit,
  readCeptForceResubmitAt,
  readCeptForceResubmitConsumedAt,
  readCeptSubmitIntentAt,
} from "@/modules/india-post/booking-intent";
import { blankBookingArtifactPatch, shipmentBarcode } from "@/modules/india-post/booking-idempotency";
import {
  bulkMembershipRetryDecision,
  bulkRetryBucket,
  evaluateBookingRetryEligibility,
  NEVER_SUBMITTED_CODES,
  STALE_BOOKING_LOCK_MS,
  type BookingRetryAction,
  type BookingRetryDecision,
  type BookingRetryJob,
} from "@/modules/india-post/booking-retry-eligibility";
import { bookingForceRetryEnabled } from "@/modules/india-post/booking-recovery";

const REQUEUEABLE = ["DRAFT", "VALIDATING", "QUEUED", "FAILED", "RECOVERY_REQUIRED"] as const;

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
    .select("id, status, booked_at, barcode, tracking_number, provider_ref, last_error, last_error_code, metadata, updated_at, organization_id")
    .eq("organization_id", organizationId)
    .eq("id", shipmentId)
    .maybeSingle();
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  return data;
}

/**
 * The shipment's active bulk-batch result, if any. Fails closed: an unreadable membership must
 * not turn into a second POST. A database without the bulk tables has no bulk members.
 */
async function loadBulkArticleResult(supabase: SupabaseClient, organizationId: string, shipmentId: string) {
  const { data: member, error: memberError } = await supabase
    .from("india_post_bulk_batch_articles")
    .select("article_result")
    .eq("organization_id", organizationId)
    .eq("shipment_id", shipmentId)
    .in("article_result", ["PENDING", "SUBMITTED", "SUCCEEDED", "RECOVERY_REQUIRED"])
    .limit(1)
    .maybeSingle();
  if (memberError && !/does not exist|PGRST205|42P01/i.test(`${memberError.code ?? ""} ${memberError.message ?? ""}`)) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, memberError.message);
  }
  return (member?.article_result as string | undefined) ?? null;
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
  if (!shipment.booked_at && !readCeptForceResubmitAt(shipment.metadata)) {
    const owned = bulkMembershipRetryDecision(shipmentId, await loadBulkArticleResult(supabase, organizationId, shipmentId));
    if (owned) return owned;
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

  const blanks = blankBookingArtifactPatch(shipment ?? {});
  if (shipment && Object.keys(blanks).length) {
    await supabase
      .from("shipments")
      .update(blanks)
      .eq("id", shipmentId)
      .eq("organization_id", ctx.organizationId)
      .is("booked_at", null);
    Object.assign(shipment, blanks);
  }

  // A barcode PostBus recorded as never sent may be reused. Its "never submitted" error code is
  // what lets the booking run reuse it, so the code stays on the row until the next attempt.
  const keptBarcode = shipmentBarcode(shipment?.barcode);
  const patch: Record<string, unknown> = {
    status: "QUEUED",
    last_error: null,
    ...(keptBarcode ? {} : { last_error_code: null }),
  };
  if (extras?.weightGrams != null && extras.weightGrams > 0) patch.weight_grams = Math.round(extras.weightGrams);
  if (extras?.lengthCm != null && extras.lengthCm > 0) patch.length_cm = extras.lengthCm;
  if (extras?.widthCm != null && extras.widthCm > 0) patch.width_cm = extras.widthCm;
  if (extras?.heightCm != null && extras.heightCm > 0) patch.height_cm = extras.heightCm;

  const requeue = supabase
    .from("shipments")
    .update(patch)
    .eq("id", shipmentId)
    .eq("organization_id", ctx.organizationId)
    .is("booked_at", null)
    .is("tracking_number", null)
    .is("provider_ref", null)
    .in("status", [...REQUEUEABLE])
    .filter("metadata->>ceptSubmitIntentAt", "is", null);
  const { data: claimed, error: claimError } = await (keptBarcode
    ? requeue.eq("barcode", keptBarcode).in("last_error_code", [...NEVER_SUBMITTED_CODES])
    : requeue.is("barcode", null)
  )
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

/** Force book is a merchant decision about duplicates; only owners and admins may make it. */
export const FORCE_BOOK_ROLES = new Set(["OWNER", "ADMIN"]);
/** A second force within this window is refused, so repeated clicks cannot stack POSTs. */
export const FORCE_BOOK_COOLDOWN_MS = 10 * 60 * 1000;
/** Only a booking that failed or could not be confirmed may be forced. Never one in flight. */
const FORCE_BOOK_FROM = ["FAILED", "RECOVERY_REQUIRED"] as const;

export type ForceBookRefusal = {
  kind: "forbidden" | "conflict";
  reason: string;
  action?: BookingRetryAction;
};

/** Every reason to refuse a force book, checked before anything is written. */
export function forceBookRefusal(
  input: {
    role?: string | null;
    shipment: {
      id?: string | null;
      status?: string | null;
      barcode?: string | null;
      tracking_number?: string | null;
      metadata?: unknown;
    } | null;
    job?: BookingRetryJob;
    bulkArticleResult?: string | null;
  },
  now = Date.now()
): ForceBookRefusal | null {
  if (!FORCE_BOOK_ROLES.has(String(input.role ?? "").toUpperCase())) {
    return { kind: "forbidden", reason: "Only workspace owners and admins can force book." };
  }
  const shipment = input.shipment;
  if (!shipment?.id) return { kind: "conflict", reason: "Shipment not found.", action: "INVALID_SHIPMENT" };
  const status = String(shipment.status ?? "").toUpperCase();
  if (!(FORCE_BOOK_FROM as readonly string[]).includes(status)) {
    return {
      kind: "conflict",
      reason: `Force book is only for failed or unconfirmed bookings. This shipment is ${status || "in an unknown state"}.`,
    };
  }
  const owned = bulkMembershipRetryDecision(String(shipment.id), input.bulkArticleResult);
  if (owned) return { kind: "conflict", reason: owned.reason, action: owned.action };
  const job = input.job;
  const jobState = String(job?.status ?? "").toUpperCase();
  if (job?.id && (jobState === "QUEUED" || jobState === "PENDING" || jobState === "RETRYING")) {
    return { kind: "conflict", reason: "A booking retry is already scheduled.", action: "RETRY_ALREADY_SCHEDULED" };
  }
  if (job?.id && jobState === "RUNNING") {
    const locked = Date.parse(String(job.locked_at ?? job.lockedAt ?? ""));
    const stale = Number.isFinite(locked) && now - locked >= STALE_BOOKING_LOCK_MS;
    if (!stale) return { kind: "conflict", reason: "Booking in progress.", action: "BOOKING_IN_PROGRESS" };
  }
  const consumed = Date.parse(readCeptForceResubmitConsumedAt(shipment.metadata) ?? "");
  if (Number.isFinite(consumed) && now - consumed < FORCE_BOOK_COOLDOWN_MS) {
    const minutes = Math.max(1, Math.ceil((FORCE_BOOK_COOLDOWN_MS - (now - consumed)) / 60_000));
    return { kind: "conflict", reason: `Force book was just used. Try again in ${minutes} min.` };
  }
  return null;
}

export async function forceBookUnknownShipment(
  supabase: SupabaseClient,
  ctx: TenantContext,
  shipmentId: string
): Promise<ForceRetryResult & { reconciled?: boolean }> {
  const shipment = await loadOwnedShipment(supabase, ctx.organizationId, shipmentId);
  if (shipment?.booked_at) {
    return {
      shipmentId,
      jobId: null,
      scheduled: false,
      reconciled: true,
      decision: evaluateBookingRetryEligibility({ shipment }),
      message: "This shipment is already booked with India Post.",
    };
  }
  const [latest, bulkArticleResult] = shipment
    ? await Promise.all([
        loadLatestShipmentBookingJob(supabase, { organizationId: ctx.organizationId, entityId: shipmentId }),
        loadBulkArticleResult(supabase, ctx.organizationId, shipmentId),
      ])
    : [null, null];
  const refusal = forceBookRefusal({
    role: ctx.role,
    shipment,
    job: asJob(latest as Record<string, unknown> | null),
    bulkArticleResult,
  });
  if (refusal || !shipment) {
    throw new AppError(
      refusal?.kind === "forbidden" ? ERROR_CODES.FORBIDDEN : ERROR_CODES.CONFLICT,
      refusal?.reason ?? "Shipment not found.",
      refusal?.action ? { action: refusal.action } : undefined
    );
  }
  const barcode = shipmentBarcode(shipment.barcode || shipment.tracking_number);

  // Nothing is written until every check above passed; the claim still requires the status we checked.
  const now = new Date().toISOString();
  const { data: claimed, error: claimError } = await supabase
    .from("shipments")
    .update({
      status: "QUEUED",
      last_error: null,
      last_error_code: null,
      metadata: metadataWithCeptForceResubmit(shipment.metadata, now),
    })
    .eq("id", shipmentId)
    .eq("organization_id", ctx.organizationId)
    .eq("status", String(shipment.status))
    .is("booked_at", null)
    .select("id")
    .maybeSingle();
  if (claimError) throw new AppError(ERROR_CODES.VALIDATION_ERROR, claimError.message);
  if (!claimed) {
    throw new AppError(ERROR_CODES.CONFLICT, "This shipment changed while force booking. Reload and try again.");
  }

  let job: Awaited<ReturnType<typeof reuseOrCreateJob>>;
  try {
    job = await reuseOrCreateJob(supabase, ctx, shipmentId, latest as Record<string, unknown> | null);
  } catch (error) {
    // No job will run, so put the shipment back as it was instead of leaving a live force flag.
    await supabase
      .from("shipments")
      .update({
        status: shipment.status,
        last_error: shipment.last_error ?? null,
        last_error_code: shipment.last_error_code ?? null,
        metadata: shipment.metadata ?? {},
      })
      .eq("id", shipmentId)
      .eq("organization_id", ctx.organizationId)
      .eq("status", "QUEUED")
      .is("booked_at", null)
      .filter("metadata->>ceptForceResubmitAt", "eq", now)
      .then(() => undefined, () => undefined);
    throw error;
  }
  const { claimedJobFromRow, runQueuedJobsNow } = await import("@/lib/jobs/drain");
  await runQueuedJobsNow([claimedJobFromRow(job)]);

  await supabase
    .from("audit_logs")
    .insert({
      organization_id: ctx.organizationId,
      actor_id: ctx.userId,
      action: "shipment.force_book",
      entity_type: "shipment",
      entity_id: shipmentId,
      after: { jobId: job.id, barcode, previousStatus: shipment.status ?? null },
    })
    .then(() => undefined, () => undefined);

  return {
    shipmentId,
    jobId: job.id ? String(job.id) : null,
    scheduled: true,
    reconciled: false,
    decision: evaluateBookingRetryEligibility({ shipment: { ...shipment, status: "QUEUED" } }),
    message: barcode
      ? "Force book scheduled with the same barcode."
      : "Force book scheduled. A barcode will be allocated on submit.",
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
