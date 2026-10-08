import { describe, expect, it } from "vitest";
import { bookingFailureShipmentUpdate } from "@/modules/india-post/booking-failure-state";

describe("bookingFailureShipmentUpdate", () => {
  it("moves temporary CEPT 409 conflicts to RECOVERY_REQUIRED so empty tracking cannot POST again", () => {
    const patch = bookingFailureShipmentUpdate(
      {
        retryable: true,
        code: "TEMPORARY_PROVIDER_FAILURE",
        message: "Internal server error during processing",
        httpStatus: 409,
      },
      true
    );
    expect(patch.status).toBe("RECOVERY_REQUIRED");
    expect(patch.allowedStatuses).toContain("BOOKING");
    expect(patch.allowedStatuses).toContain("RECOVERY_REQUIRED");
  });

  it("keeps lock/infrastructure TEMPORARY_PROVIDER_FAILURE retryable as QUEUED", () => {
    const patch = bookingFailureShipmentUpdate(
      {
        retryable: true,
        code: "TEMPORARY_PROVIDER_FAILURE",
        message: "India Post booking lock is busy. Retrying.",
      },
      true
    );
    expect(patch.status).toBe("QUEUED");
  });

  it("moves BOOKING to RECOVERY_REQUIRED for ambiguous timeouts, including exhausted retries", () => {
    const retrying = bookingFailureShipmentUpdate(
      { retryable: true, code: "ETIMEDOUT", message: "India Post booking timed out after the request was sent." },
      true
    );
    expect(retrying.status).toBe("RECOVERY_REQUIRED");
    expect(retrying.allowedStatuses).toContain("BOOKING");

    const exhausted = bookingFailureShipmentUpdate(
      { retryable: false, code: "ETIMEDOUT", message: "India Post booking timed out after the request was sent." },
      false
    );
    expect(exhausted.status).toBe("RECOVERY_REQUIRED");
    expect(exhausted.status).not.toBe("FAILED");
  });

  it("does not fail unrecognized 409 into claimable FAILED", () => {
    const patch = bookingFailureShipmentUpdate(
      { retryable: false, code: "CEPT_UNKNOWN", message: "Conflict", httpStatus: 409 },
      false
    );
    expect(patch.status).toBe("RECOVERY_REQUIRED");
  });

  it("fails BOOKING for permanent validation errors", () => {
    const patch = bookingFailureShipmentUpdate(
      {
        retryable: false,
        code: "VALIDATION_ERROR",
        message: "Destination pincode 673589 not found",
      },
      false
    );
    expect(patch.status).toBe("FAILED");
    expect(patch.allowedStatuses).toContain("BOOKING");
  });
});
