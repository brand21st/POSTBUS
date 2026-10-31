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

/** A timeout or server error before CEPT was called must not become RECOVERY_REQUIRED. */
export function tagPrePostBookingError(error: unknown) {
  const classified = classifyProviderError(error);
  const serverError = (classified.httpStatus ?? 0) >= 500;
  if (classified.code !== "ETIMEDOUT" && !serverError) return error;
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
