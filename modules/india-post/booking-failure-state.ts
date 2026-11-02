import { classifyProviderError, type ClassifiedError } from "@/lib/jobs/retry";

const BOOKING_FAILURE_EXEMPT_QUEUES = new Set([
  "invoice-generation",
  "label-generation",
  "tracking-sync",
  "wati-notify",
  "vachat-notify",
  "support-ingest",
]);

/** Label and invoice failures must not change the India Post booking outcome. */
export function shouldApplyBookingFailureUpdate(queue: string) {
  return !BOOKING_FAILURE_EXEMPT_QUEUES.has(queue);
}

/**
 * Ambiguous CEPT outcomes must never become claimable FAILED.
 * Timeout / abort / unrecognized 409 stay in RECOVERY_REQUIRED (track-only).
 * Failures tagged before the booking POST are not ambiguous.
 */
export function isAmbiguousCeptOutcome(classified: Pick<ClassifiedError, "code">) {
  if (classified.code === "PRE_POST_TRANSIENT") return false;
  return classified.code === "ETIMEDOUT" || classified.code === "CEPT_UNKNOWN";
}

/**
 * Temporary failures that can only happen before the booking POST in the code paths that call
 * tagPrePostBookingError: the per-workspace booking lock, the session, and the network.
 */
const PRE_POST_TRANSIENT_CODES = new Set([
  "TEMPORARY_PROVIDER_FAILURE",
  "LOCK_RPC_TIMEOUT",
  "ECONNRESET",
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "RATE_LIMITED",
  "HTTP_429",
]);

/**
 * A temporary failure before CEPT was called must not become RECOVERY_REQUIRED. Tagging it
 * PRE_POST_TRANSIENT also records a "never submitted" code on the shipment, so the next run
 * may use the barcode this run claimed instead of sending it to review.
 */
export function tagPrePostBookingError(error: unknown) {
  const classified = classifyProviderError(error);
  const serverError = (classified.httpStatus ?? 0) >= 500;
  const transient = PRE_POST_TRANSIENT_CODES.has(classified.code) && classified.httpStatus !== 409;
  if (classified.code !== "ETIMEDOUT" && !serverError && !transient) return error;
  const wrapped = new Error(classified.message) as Error & {
    code: string;
    bookingPhase: "PRE_POST";
    status?: number;
  };
  wrapped.code = "PRE_POST_TRANSIENT";
  wrapped.bookingPhase = "PRE_POST";
  if (classified.httpStatus) wrapped.status = classified.httpStatus;
  return wrapped;
}

/**
 * Codes that mean "outcome unknown" even when this run did not POST (an earlier run did, or
 * the barcode has no proof). They must keep their recovery handling.
 */
const UNKNOWN_WITHOUT_POST_CODES = new Set(["CEPT_UNKNOWN", "ETIMEDOUT", "BOOKING_REVIEW_REQUIRED"]);

/** Marks an error raised before the booking POST was sent. */
export function markCeptNotCalled(error: unknown) {
  if (error && typeof error === "object") (error as { ceptNotCalled?: boolean }).ceptNotCalled = true;
}

/** True when this run never sent the booking POST and the error does not carry an older unknown outcome. */
export function failedBeforeCeptCall(error: unknown) {
  const anyError = error as { ceptNotCalled?: boolean; code?: string; bookingPhase?: string } | null;
  if (!anyError?.ceptNotCalled) return false;
  if (anyError.bookingPhase === "POST_SUBMIT") return false;
  return !UNKNOWN_WITHOUT_POST_CODES.has(String(anyError.code ?? "").toUpperCase());
}

export function bookingFailureShipmentUpdate(classified: ClassifiedError, retryable: boolean) {
  if (isAmbiguousCeptOutcome(classified)) {
    return {
      status: "RECOVERY_REQUIRED" as const,
      allowedStatuses: ["QUEUED", "VALIDATING", "DRAFT", "FAILED", "BOOKING", "RECOVERY_REQUIRED"] as const,
    };
  }
  if (retryable && classified.code === "TEMPORARY_PROVIDER_FAILURE" && classified.httpStatus === 409) {
    return {
      status: "RECOVERY_REQUIRED" as const,
      allowedStatuses: ["QUEUED", "VALIDATING", "DRAFT", "FAILED", "BOOKING", "RECOVERY_REQUIRED"] as const,
    };
  }
  if (retryable) {
    return {
      status: "QUEUED" as const,
      allowedStatuses: ["QUEUED", "VALIDATING", "DRAFT", "BOOKING"] as const,
    };
  }
  return {
    status: "FAILED" as const,
    allowedStatuses: ["QUEUED", "VALIDATING", "DRAFT", "FAILED", "BOOKING"] as const,
  };
}
