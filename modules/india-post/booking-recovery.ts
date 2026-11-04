import type { SupabaseClient } from "@supabase/supabase-js";
import { logError, logInfo } from "@/lib/logger";
import { enqueueShipmentBookingJob } from "@/modules/jobs/shipment-booking-job";
import { readCeptForceResubmitConsumedAt, readCeptSubmitIntentAt } from "@/modules/india-post/booking-intent";
import { shipmentBarcode } from "@/modules/india-post/booking-idempotency";
import {
  evaluateBookingRetryEligibility,
  shipmentMayAllocateFirstBarcode,
  shipmentNeedsSameBarcodeRecovery,
} from "@/modules/india-post/booking-retry-eligibility";

export const BOOKING_RECOVERY_BATCH = 20;
/** All workspaces: Failed / Recovery Required with no article number, per cron tick. */
export const FIRST_BARCODE_RECOVERY_BATCH = 100;
const ORPHAN_MIN_AGE_MS = 2 * 60 * 1000;

let recoveryInFlight: Promise<BookingRecoveryResult> | null = null;

export type BookingRecoveryResult = {
  enabled: boolean;
  recovered: number;
  skipped: number;
};

/** Dangerous automatic requeue. Off unless BOOKING_AUTO_RECOVERY=true. */
export function bookingAutoRecoveryEnabled() {
  return (process.env.BOOKING_AUTO_RECOVERY || "").trim().toLowerCase() === "true";
}

/** Off unless explicitly enabled. Historical rows must not be force-retried by default. */
export function bookingForceRetryEnabled() {
  return (process.env.BOOKING_FORCE_RETRY_ENABLED || "").trim().toLowerCase() === "true";
}

type OrphanRow = {
  id: string;
  organization_id: string;
  barcode?: string | null;
  tracking_number?: string | null;
  provider_ref?: string | null;
  booked_at?: string | null;
  metadata?: unknown;
  last_error_code?: string | null;
  created_by?: string | null;
};

/**
 * Requeue shipments that are still QUEUED, have no barcode, no submit intent,
 * and no booking job. Never touches RECOVERY_REQUIRED or rows that may have been posted.
 */
export async function runBookingAutoRecovery(supabase: SupabaseClient): Promise<BookingRecoveryResult> {
  if (!bookingAutoRecoveryEnabled()) return { enabled: false, recovered: 0, skipped: 0 };
  if (recoveryInFlight) return recoveryInFlight;
  recoveryInFlight = recoverSafeOrphans(supabase).finally(() => {
    recoveryInFlight = null;
  });
  return recoveryInFlight;
}

async function recoverSafeOrphans(supabase: SupabaseClient): Promise<BookingRecoveryResult> {
  const cutoff = new Date(Date.now() - ORPHAN_MIN_AGE_MS).toISOString();
  const { data, error } = await supabase
    .from("shipments")
    .select("id, organization_id, barcode, tracking_number, provider_ref, booked_at, metadata, last_error_code, created_by")
    .eq("status", "QUEUED")
    .is("booked_at", null)
    .is("barcode", null)
    .is("tracking_number", null)
    .is("provider_ref", null)
    .lt("updated_at", cutoff)
    .order("updated_at", { ascending: true })
    .limit(BOOKING_RECOVERY_BATCH);
  if (error) throw new Error(error.message);

  let recovered = 0;
  let skipped = 0;
  for (const row of (data ?? []) as OrphanRow[]) {
    if (row.booked_at || shipmentBarcode(row.barcode) || shipmentBarcode(row.tracking_number) || row.provider_ref) {
      skipped += 1;
      continue;
    }
    if (readCeptSubmitIntentAt(row.metadata)) {
      skipped += 1;
      continue;
    }
    const decision = evaluateBookingRetryEligibility({ shipment: { ...row, status: "QUEUED" } });
    if (!decision.eligible) {
      skipped += 1;
      continue;
    }
    const { data: job, error: jobError } = await supabase
      .from("background_jobs")
      .select("id")
      .eq("organization_id", row.organization_id)
      .eq("job_type", "shipment-booking")
      .eq("entity_type", "shipment")
      .eq("entity_id", row.id)
      .limit(1)
      .maybeSingle();
    if (jobError) {
      skipped += 1;
      logError("booking.recovery_lookup_failed", { shipmentId: row.id, message: jobError.message });
      continue;
    }
    if (job?.id) {
      skipped += 1;
      continue;
    }
    try {
      await enqueueShipmentBookingJob(supabase, {
        organizationId: row.organization_id,
        jobType: "shipment-booking",
        entityType: "shipment",
        entityId: row.id,
        userId: row.created_by ?? undefined,
      });
      recovered += 1;
      logInfo("booking.orphan_requeued", { organizationId: row.organization_id, shipmentId: row.id });
    } catch (enqueueError) {
      skipped += 1;
      logError("booking.orphan_requeue_failed", {
        shipmentId: row.id,
        message: enqueueError instanceof Error ? enqueueError.message : "enqueue failed",
      });
    }
  }
  return { enabled: true, recovered, skipped };
}

/** Same window as Force book, so an automatic resubmit cannot stack. */
const SAME_BARCODE_RESUBMIT_COOLDOWN_MS = 10 * 60 * 1000;

type RecoveryRow = {
  id: string;
  organization_id: string;
  status?: string | null;
  barcode?: string | null;
  tracking_number?: string | null;
  provider_ref?: string | null;
  booked_at?: string | null;
  last_error?: string | null;
  last_error_code?: string | null;
  metadata?: unknown;
  created_by?: string | null;
};

/**
 * Every workspace: Failed / Recovery Required rows with no article number.
 * The booking run allocates a barcode and submits. Not a second POST of an unknown article.
 */
async function enqueueFirstBarcodeRecovery(supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from("shipments")
    .select("id, organization_id, status, barcode, tracking_number, provider_ref, booked_at, last_error, last_error_code, metadata, created_by")
    .is("booked_at", null)
    .is("barcode", null)
    .is("tracking_number", null)
    .is("provider_ref", null)
    .in("status", ["FAILED", "RECOVERY_REQUIRED"])
    .order("updated_at", { ascending: true })
    .limit(FIRST_BARCODE_RECOVERY_BATCH);
  if (error) throw new Error(error.message);

  let queued = 0;
  for (const row of (data ?? []) as RecoveryRow[]) {
    if (!shipmentMayAllocateFirstBarcode(row)) continue;
    try {
      await supabase
        .from("shipments")
        .update({ status: "QUEUED", last_error: null, last_error_code: null })
        .eq("id", row.id)
        .eq("organization_id", row.organization_id)
        .in("status", ["FAILED", "RECOVERY_REQUIRED"])
        .is("booked_at", null)
        .is("barcode", null)
        .is("tracking_number", null)
        .is("provider_ref", null);
      await enqueueShipmentBookingJob(supabase, {
        organizationId: row.organization_id,
        jobType: "shipment-booking",
        entityType: "shipment",
        entityId: row.id,
        userId: row.created_by ?? undefined,
      });
      queued += 1;
      logInfo("booking.first_barcode_requeued", {
        organizationId: row.organization_id,
        shipmentId: row.id,
      });
    } catch (enqueueError) {
      logError("booking.first_barcode_requeue_failed", {
        shipmentId: row.id,
        message: enqueueError instanceof Error ? enqueueError.message : "enqueue failed",
      });
    }
  }
  return queued;
}

/**
 * Queue booking jobs for unconfirmed barcodes, and for every workspace's
 * Recovery Required / Failed rows that never stored an article number.
 */
export async function enqueueSameBarcodeRecovery(supabase: SupabaseClient) {
  const firstBarcodeQueued = await enqueueFirstBarcodeRecovery(supabase);
  const { data, error } = await supabase
    .from("shipments")
    .select("id, organization_id, status, barcode, tracking_number, provider_ref, booked_at, last_error, last_error_code, metadata, created_by")
    .is("booked_at", null)
    .in("status", ["FAILED", "RECOVERY_REQUIRED", "BOOKING"])
    .order("updated_at", { ascending: true })
    .limit(BOOKING_RECOVERY_BATCH);
  if (error) throw new Error(error.message);

  let queued = firstBarcodeQueued;
  for (const row of (data ?? []) as RecoveryRow[]) {
    if (shipmentMayAllocateFirstBarcode(row)) continue;
    if (!shipmentNeedsSameBarcodeRecovery(row)) continue;
    const consumed = Date.parse(readCeptForceResubmitConsumedAt(row.metadata) ?? "");
    if (Number.isFinite(consumed) && Date.now() - consumed < SAME_BARCODE_RESUBMIT_COOLDOWN_MS) continue;
    try {
      await enqueueShipmentBookingJob(supabase, {
        organizationId: row.organization_id,
        jobType: "shipment-booking",
        entityType: "shipment",
        entityId: row.id,
        userId: row.created_by ?? undefined,
      });
      queued += 1;
    } catch (enqueueError) {
      logError("booking.same_barcode_requeue_failed", {
        shipmentId: row.id,
        message: enqueueError instanceof Error ? enqueueError.message : "enqueue failed",
      });
    }
  }
  return { queued };
}

async function shipmentCount(
  supabase: SupabaseClient,
  status: string,
  staleBefore?: string
) {
  let query = supabase
    .from("shipments")
    .select("id", { count: "exact", head: true })
    .eq("status", status)
    .is("booked_at", null);
  if (staleBefore) query = query.lt("updated_at", staleBefore);
  const { count, error } = await query;
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export async function loadBookingQueueHealth(supabase: SupabaseClient) {
  const staleBefore = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const [queued, processing, recoveryRequired, failed, staleQueued, overdue] = await Promise.all([
    shipmentCount(supabase, "QUEUED"),
    shipmentCount(supabase, "BOOKING"),
    shipmentCount(supabase, "RECOVERY_REQUIRED"),
    shipmentCount(supabase, "FAILED"),
    shipmentCount(supabase, "QUEUED", staleBefore),
    supabase.rpc("count_overdue_background_jobs"),
  ]);

  const { count: retrying, error: retryError } = await supabase
    .from("background_jobs")
    .select("id", { count: "exact", head: true })
    .eq("job_type", "shipment-booking")
    .eq("status", "RETRYING");
  if (retryError) throw new Error(retryError.message);

  return {
    queued,
    processing,
    staleQueued,
    retryScheduled: retrying ?? 0,
    recoveryRequired,
    failed,
    overdueJobs: Number(overdue.data ?? 0),
    autoRecoveryEnabled: bookingAutoRecoveryEnabled(),
    forceRetryEnabled: bookingForceRetryEnabled(),
    jobRunner: (process.env.JOB_RUNNER || "database").trim().toLowerCase() || "database",
  };
}
