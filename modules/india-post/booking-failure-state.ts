import type { ClassifiedError } from "@/lib/jobs/retry";

/**
 * Ambiguous CEPT outcomes must never become claimable FAILED.
 * Timeout / abort / unrecognized 409 stay in RECOVERY_REQUIRED (track-only).
 */
export function isAmbiguousCeptOutcome(classified: Pick<ClassifiedError, "code">) {
  return classified.code === "ETIMEDOUT" || classified.code === "CEPT_UNKNOWN";
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
      allowedStatuses: ["QUEUED", "VALIDATING", "DRAFT", "FAILED", "BOOKING"] as const,
    };
  }
  return {
    status: "FAILED" as const,
    allowedStatuses: ["QUEUED", "VALIDATING", "DRAFT", "FAILED", "BOOKING"] as const,
  };
}
