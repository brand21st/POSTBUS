import { isIndiaPostAcceptedStatus } from "@/modules/india-post/booking-status";
import { isAuthoritativeIndiaPostBooking, shipmentBarcode } from "@/modules/india-post/booking-idempotency";
import { readCeptSubmitIntentAt } from "@/modules/india-post/booking-intent";
import { FULFILLMENT_STATUSES, ORDER_STATUSES, type FulfillmentStatus, type OrderStatus } from "@/types/domain";

/** Matches claim_background_jobs stale RUNNING recovery. */
export const STALE_BOOKING_LOCK_MS = 15 * 60 * 1000;

export const BOOKING_RETRY_ACTIONS = [
  "SAFE_TO_REQUEUE",
  "ALREADY_BOOKED",
  "BOOKING_IN_PROGRESS",
  "RETRY_ALREADY_SCHEDULED",
  "BOOKING_OUTCOME_UNKNOWN",
  "MANUAL_REVIEW_REQUIRED",
  "INVALID_SHIPMENT",
  "MAX_ATTEMPTS_EXCEEDED",
] as const;

export type BookingRetryAction = (typeof BOOKING_RETRY_ACTIONS)[number];

export type BookingRetryShipment = {
  id?: string | null;
  status?: string | null;
  booked_at?: string | null;
  bookedAt?: string | null;
  barcode?: string | null;
  tracking_number?: string | null;
  trackingNumber?: string | null;
  provider_ref?: string | null;
  providerRef?: string | null;
  last_error_code?: string | null;
  lastErrorCode?: string | null;
  metadata?: unknown;
  updated_at?: string | null;
  updatedAt?: string | null;
  created_at?: string | null;
  createdAt?: string | null;
};

export type BookingRetryOrder = {
  status?: string | null;
  fulfillment_status?: string | null;
  fulfillmentStatus?: string | null;
} | null;

export type BookingEligibilityPurpose = "retry" | "auto-recovery" | "worker";

export type BookingRetryJob = {
  id?: string | null;
  status?: string | null;
  attempt_count?: number | null;
  attemptCount?: number | null;
  max_attempts?: number | null;
  maxAttempts?: number | null;
  next_attempt_at?: string | null;
  nextAttemptAt?: string | null;
  locked_at?: string | null;
  lockedAt?: string | null;
} | null;

export type BookingRetryDecision = {
  eligible: boolean;
  action: BookingRetryAction;
  reason: string;
  shipmentId: string;
  existingJobId?: string;
  requiresManualReview: boolean;
  nextAttemptAt?: string | null;
};

const AMBIGUOUS_CODES = new Set([
  "ETIMEDOUT",
  "CEPT_UNKNOWN",
  "HTTP_500",
  "HTTP_502",
  "HTTP_503",
  "HTTP_504",
]);

/**
 * Codes that are written only when this process knows CEPT was not called.
 * An empty code is not in this set: a missing error is not proof of non-submission.
 * Local validation failures are included because they are raised before the booking POST
 * and only count when barcode, tracking, provider reference, and submit intent are all absent.
 */
export const NEVER_SUBMITTED_CODES = new Set([
  "PRE_POST_TRANSIENT",
  "QUEUE_UNAVAILABLE",
  "INVALID_PINCODE",
  "INVALID_ADDRESS",
  "INVALID_WEIGHT",
  "INVALID_DIMENSIONS",
  "MISSING_MANDATORY_FIELD",
  "INVALID_BARCODE",
  "INVALID_CONTRACT",
  "PERMANENT_AUTH_ERROR",
  "VALIDATION_ERROR",
  "SHOPIFY_FULFILLMENT_BLOCKED",
  "BILLING_LIMIT",
]);

const SAFE_STATUSES = new Set(["DRAFT", "VALIDATING", "QUEUED", "FAILED"]);

const REASONS: Record<BookingRetryAction, string> = {
  SAFE_TO_REQUEUE: "Booking can be retried.",
  ALREADY_BOOKED: "This shipment is already booked with India Post.",
  BOOKING_IN_PROGRESS: "Booking in progress.",
  RETRY_ALREADY_SCHEDULED: "Booking retry is scheduled.",
  BOOKING_OUTCOME_UNKNOWN:
    "Booking outcome could not be confirmed. Please contact support before retrying.",
  MANUAL_REVIEW_REQUIRED: "Booking needs review before it can be retried.",
  INVALID_SHIPMENT: "Shipment could not be retried.",
  MAX_ATTEMPTS_EXCEEDED: "Booking has reached the maximum number of attempts.",
};

/** Order statuses that may still need a first India Post booking. */
export const ORDER_STATUSES_ELIGIBLE_FOR_FIRST_BOOKING = [
  "IMPORTED",
  "READY",
  "PROCESSING",
  "FAILED",
] as const satisfies readonly OrderStatus[];

/** Order statuses that must never receive a new India Post booking. */
export const ORDER_STATUSES_BLOCK_NEW_BOOKING = [
  "BOOKED",
  "SHIPPED",
  "IN_TRANSIT",
  "DELIVERED",
  "CANCELLED",
] as const satisfies readonly OrderStatus[];

const ORDER_STATUS_SET = new Set<string>(ORDER_STATUSES);
const FULFILLMENT_STATUS_SET = new Set<string>(FULFILLMENT_STATUSES);
const ELIGIBLE_ORDER_STATUS_SET = new Set<string>(ORDER_STATUSES_ELIGIBLE_FOR_FIRST_BOOKING);
const BLOCKED_FULFILLMENT = new Set<string>(["FULFILLED", "CANCELLED"] satisfies FulfillmentStatus[]);

/**
 * Shipments created before this instant cannot be first-booked by cron or
 * Automatic Recovery. Force Retry remains the explicit merchant decision.
 * Covers the 24 Sep-2026 orphans and 14 Oct-8 queued jobs.
 */
export const HISTORICAL_FIRST_BOOKING_BEFORE = "2026-10-31T00:00:00.000Z";

export function readBookingFirstSubmitApprovedAt(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const value = (metadata as { bookingFirstSubmitApprovedAt?: unknown }).bookingFirstSubmitApprovedAt;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function metadataWithFirstSubmitApproval(metadata: unknown, approvedAt = new Date().toISOString()) {
  const base =
    metadata && typeof metadata === "object" && !Array.isArray(metadata)
      ? { ...(metadata as Record<string, unknown>) }
      : {};
  return { ...base, bookingFirstSubmitApprovedAt: approvedAt };
}

function createdAtMs(shipment: BookingRetryShipment) {
  const raw = shipment.createdAt ?? shipment.created_at;
  if (!raw) return null;
  const ms = Date.parse(String(raw));
  return Number.isFinite(ms) ? ms : null;
}

export function isHistoricalUnauthoredFirstBooking(
  shipment: BookingRetryShipment,
  purpose: BookingEligibilityPurpose = "retry"
) {
  if (hasSubmissionArtifact(shipment)) return false;
  if (readBookingFirstSubmitApprovedAt(shipment.metadata)) return false;
  const created = createdAtMs(shipment);
  if (created == null) return purpose === "auto-recovery";
  return created < Date.parse(HISTORICAL_FIRST_BOOKING_BEFORE);
}

export function evaluateOrderBookingEligibility(order?: BookingRetryOrder | undefined) {
  if (order === undefined) return { eligible: true as const, action: "SAFE_TO_REQUEUE" as const };
  if (!order) {
    return { eligible: false as const, action: "MANUAL_REVIEW_REQUIRED" as const };
  }
  const status = String(order.status ?? "").trim().toUpperCase();
  if (!status || !ORDER_STATUS_SET.has(status)) {
    return { eligible: false as const, action: "MANUAL_REVIEW_REQUIRED" as const };
  }
  if (!ELIGIBLE_ORDER_STATUS_SET.has(status)) {
    return { eligible: false as const, action: "MANUAL_REVIEW_REQUIRED" as const };
  }
  const fulfillment = String(order.fulfillmentStatus ?? order.fulfillment_status ?? "").trim().toUpperCase();
  if (fulfillment) {
    if (!FULFILLMENT_STATUS_SET.has(fulfillment) || BLOCKED_FULFILLMENT.has(fulfillment)) {
      return { eligible: false as const, action: "MANUAL_REVIEW_REQUIRED" as const };
    }
  }
  return { eligible: true as const, action: "SAFE_TO_REQUEUE" as const };
}

function decision(
  action: BookingRetryAction,
  shipmentId: string,
  extra?: { existingJobId?: string; nextAttemptAt?: string | null }
): BookingRetryDecision {
  return {
    eligible: action === "SAFE_TO_REQUEUE",
    action,
    reason: REASONS[action],
    shipmentId,
    requiresManualReview: action === "BOOKING_OUTCOME_UNKNOWN" || action === "MANUAL_REVIEW_REQUIRED",
    ...extra,
  };
}

function statusOf(shipment: BookingRetryShipment) {
  return String(shipment.status ?? "").toUpperCase();
}

function errorCodeOf(shipment: BookingRetryShipment) {
  return String(shipment.lastErrorCode ?? shipment.last_error_code ?? "").toUpperCase();
}

function jobStatus(job: BookingRetryJob) {
  return String(job?.status ?? "").toUpperCase();
}

function attempts(job: NonNullable<BookingRetryJob>) {
  return {
    count: job.attemptCount ?? job.attempt_count ?? 0,
    max: job.maxAttempts ?? job.max_attempts ?? 5,
  };
}

function lockAgeMs(job: NonNullable<BookingRetryJob>, now: number) {
  const locked = job.lockedAt ?? job.locked_at;
  const ms = locked ? Date.parse(locked) : Number.NaN;
  if (!Number.isFinite(ms)) return 0;
  return now - ms;
}

function nextAttemptMs(job: NonNullable<BookingRetryJob>) {
  const value = job.nextAttemptAt ?? job.next_attempt_at;
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * An existing barcode may be submitted only when this process has already recorded
 * that the previous failure happened before CEPT was called.
 * An empty error code is not that record.
 */
export function existingBarcodeMayBeSubmitted(shipment: BookingRetryShipment) {
  if (readCeptSubmitIntentAt(shipment.metadata)) return false;
  if (shipment.bookedAt ?? shipment.booked_at) return false;
  if (shipmentBarcode(shipment.trackingNumber ?? shipment.tracking_number)) return false;
  if (String(shipment.providerRef ?? shipment.provider_ref ?? "").trim()) return false;
  const code = errorCodeOf(shipment);
  return NEVER_SUBMITTED_CODES.has(code);
}

function hasSubmissionArtifact(shipment: BookingRetryShipment) {
  return Boolean(
    shipmentBarcode(shipment.barcode) ||
      shipmentBarcode(shipment.trackingNumber ?? shipment.tracking_number) ||
      String(shipment.providerRef ?? shipment.provider_ref ?? "").trim() ||
      readCeptSubmitIntentAt(shipment.metadata)
  );
}

/**
 * True when this row must not be submitted again.
 * A missing ceptSubmitIntentAt is not evidence that CEPT never received the article.
 */
export function shipmentOutcomeIsUncertain(
  shipment: BookingRetryShipment,
  job?: BookingRetryJob
) {
  const status = statusOf(shipment);
  if (status === "RECOVERY_REQUIRED") return true;
  if (hasSubmissionArtifact(shipment)) return true;
  const code = errorCodeOf(shipment);
  if (AMBIGUOUS_CODES.has(code)) return true;
  if (code && !NEVER_SUBMITTED_CODES.has(code)) return true;
  if (!code && job?.id && attempts(job).count > 0) return true;
  return false;
}

export function evaluateBookingRetryEligibility(
  input: {
    shipment?: BookingRetryShipment | null;
    job?: BookingRetryJob;
    order?: BookingRetryOrder | undefined;
    purpose?: BookingEligibilityPurpose;
  },
  now = Date.now()
): BookingRetryDecision {
  const shipment = input.shipment;
  const shipmentId = String(shipment?.id ?? "");
  if (!shipment?.id) return decision("INVALID_SHIPMENT", shipmentId);
  const purpose = input.purpose ?? "retry";

  const bookedAt = shipment.bookedAt ?? shipment.booked_at;
  const status = statusOf(shipment);
  if (
    bookedAt ||
    isAuthoritativeIndiaPostBooking({
      status,
      booked_at: bookedAt,
      barcode: shipment.barcode,
      tracking_number: shipment.trackingNumber ?? shipment.tracking_number,
    }) ||
    isIndiaPostAcceptedStatus(status) ||
    status === "LABEL_PENDING" ||
    status === "LABEL_READY"
  ) {
    return decision("ALREADY_BOOKED", shipmentId);
  }

  if (shipmentOutcomeIsUncertain(shipment, input.job)) {
    return decision("BOOKING_OUTCOME_UNKNOWN", shipmentId, {
      existingJobId: input.job?.id ?? undefined,
    });
  }

  const job = input.job;
  if (job?.id) {
    const state = jobStatus(job);
    const { count, max } = attempts(job);
    if (state === "FAILED" && count >= max) {
      return decision("MAX_ATTEMPTS_EXCEEDED", shipmentId, { existingJobId: job.id });
    }
    if (state === "RUNNING") {
      const stale = lockAgeMs(job, now) >= STALE_BOOKING_LOCK_MS;
      if (!stale || status === "BOOKING") {
        return decision("BOOKING_IN_PROGRESS", shipmentId, { existingJobId: job.id });
      }
    }
    if (state === "RETRYING") {
      const due = nextAttemptMs(job);
      if (due != null && due > now) {
        return decision("RETRY_ALREADY_SCHEDULED", shipmentId, {
          existingJobId: job.id,
          nextAttemptAt: job.nextAttemptAt ?? job.next_attempt_at,
        });
      }
    }
    if (state === "SUCCEEDED") {
      return decision("MANUAL_REVIEW_REQUIRED", shipmentId, { existingJobId: job.id });
    }
  }

  if (status === "BOOKING") {
    return decision("BOOKING_IN_PROGRESS", shipmentId, { existingJobId: job?.id ?? undefined });
  }

  if (!SAFE_STATUSES.has(status)) {
    return decision("MANUAL_REVIEW_REQUIRED", shipmentId, { existingJobId: job?.id ?? undefined });
  }

  const orderCheck =
    purpose === "auto-recovery" && input.order === undefined
      ? evaluateOrderBookingEligibility(null)
      : evaluateOrderBookingEligibility(input.order);
  if (!orderCheck.eligible) {
    return decision("MANUAL_REVIEW_REQUIRED", shipmentId, { existingJobId: job?.id ?? undefined });
  }

  if (
    (purpose === "auto-recovery" || purpose === "worker") &&
    isHistoricalUnauthoredFirstBooking(shipment, purpose)
  ) {
    return decision("MANUAL_REVIEW_REQUIRED", shipmentId, { existingJobId: job?.id ?? undefined });
  }

  return decision("SAFE_TO_REQUEUE", shipmentId, { existingJobId: job?.id ?? undefined });
}

export type BulkRetryBucket = "eligible" | "alreadyProcessing" | "needsReview" | "failedValidation";

export function bulkRetryBucket(action: BookingRetryAction): BulkRetryBucket {
  if (action === "SAFE_TO_REQUEUE") return "eligible";
  if (action === "BOOKING_IN_PROGRESS" || action === "RETRY_ALREADY_SCHEDULED") return "alreadyProcessing";
  if (action === "BOOKING_OUTCOME_UNKNOWN" || action === "MANUAL_REVIEW_REQUIRED") return "needsReview";
  return "failedValidation";
}

const STUCK_QUEUE_MS = 10 * 60 * 1000;

/** Merchant-facing label. This is not a database status. */
export function bookingQueueLabel(
  shipment: BookingRetryShipment,
  now = Date.now()
): "Queued" | "Processing" | "Retry Scheduled" | "Stuck" | "Needs Review" | "Booked" | "Failed" {
  const decisionNow = evaluateBookingRetryEligibility({ shipment }, now);
  if (decisionNow.action === "ALREADY_BOOKED") return "Booked";
  if (decisionNow.requiresManualReview || decisionNow.action === "BOOKING_OUTCOME_UNKNOWN") return "Needs Review";
  if (decisionNow.action === "BOOKING_IN_PROGRESS") return "Processing";
  if (decisionNow.action === "RETRY_ALREADY_SCHEDULED") return "Retry Scheduled";
  const status = statusOf(shipment);
  if (status === "FAILED") return "Failed";
  if (status === "BOOKING") return "Processing";
  if (errorCodeOf(shipment) === "PRE_POST_TRANSIENT") return "Retry Scheduled";
  const updated = Date.parse(String(shipment.updatedAt ?? shipment.updated_at ?? ""));
  if (status === "QUEUED" && Number.isFinite(updated) && now - updated >= STUCK_QUEUE_MS) return "Stuck";
  if (status === "QUEUED" || status === "DRAFT" || status === "VALIDATING") return "Queued";
  return "Needs Review";
}

export function bookingQueueMessage(action: BookingRetryAction) {
  return REASONS[action];
}
