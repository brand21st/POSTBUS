import { afterEach, describe, expect, it } from "vitest";
import { classifyProviderError } from "@/lib/jobs/retry";
import { metadataWithCeptSubmitIntent } from "@/modules/india-post/booking-intent";
import { evaluateBookingRetryEligibility } from "@/modules/india-post/booking-retry-eligibility";
import {
  classifySmartAutoRetryFailure,
  decideSmartAutoRetry,
  HISTORICAL_JOB_HOLD_AT,
  isJobDueForAutomaticClaim,
  isParkedHistoricalBookingJob,
  merchantSmartAutoRetryView,
  parkedHistoricalJobReleaseStatus,
  reparkHistoricalBookingJob,
  resolveSmartAutoRetryPolicy,
  SMART_AUTO_RETRY_DELAYS_MS,
  smartAutoRetryDelayForAttempt,
  validateShipmentForSmartAutoRetry,
} from "@/modules/india-post/smart-auto-retry";
import { smartAutoBookingRetryEnabled } from "@/modules/india-post/booking-recovery";

const NOW = Date.parse("2026-10-31T12:00:00.000Z");

const validAddress = {
  name: "Asha Rao",
  phone: "9876543210",
  line1: "12 MG Road",
  city: "Kozhikode",
  state: "Kerala",
  pincode: "673602",
  country: "IN",
  address_validation_status: "READY",
};

function shipment(overrides: Record<string, unknown> = {}) {
  return {
    id: "ship-1",
    status: "FAILED",
    booked_at: null,
    barcode: null,
    tracking_number: null,
    provider_ref: null,
    last_error_code: "PRE_POST_TRANSIENT",
    metadata: {},
    created_at: "2026-10-31T06:00:00.000Z",
    weight_grams: 500,
    length_cm: 20,
    width_cm: 15,
    height_cm: 10,
    service_code: "SP",
    ...overrides,
  };
}

function withFlag(value: string | undefined, run: () => void) {
  const previous = process.env.SMART_AUTO_BOOKING_RETRY_ENABLED;
  try {
    if (value === undefined) delete process.env.SMART_AUTO_BOOKING_RETRY_ENABLED;
    else process.env.SMART_AUTO_BOOKING_RETRY_ENABLED = value;
    run();
  } finally {
    if (previous === undefined) delete process.env.SMART_AUTO_BOOKING_RETRY_ENABLED;
    else process.env.SMART_AUTO_BOOKING_RETRY_ENABLED = previous;
  }
}

afterEach(() => {
  delete process.env.SMART_AUTO_BOOKING_RETRY_ENABLED;
  delete process.env.SMART_AUTO_BOOKING_RETRY_MAX_ATTEMPTS;
  delete process.env.SMART_AUTO_BOOKING_RETRY_DELAYS_MS;
});

describe("Smart Auto Retry flag", () => {
  it("stays off unless the environment value is exactly true", () => {
    expect(smartAutoBookingRetryEnabled()).toBe(false);
    withFlag("TRUE", () => expect(smartAutoBookingRetryEnabled()).toBe(false));
    withFlag("true", () => expect(smartAutoBookingRetryEnabled()).toBe(true));
  });

  it("does not let an organization enable the policy when the global flag is off", () => {
    withFlag(undefined, () => {
      expect(resolveSmartAutoRetryPolicy({ enabled: true }).enabled).toBe(false);
    });
    withFlag("true", () => {
      expect(resolveSmartAutoRetryPolicy({ enabled: false }).enabled).toBe(false);
      expect(resolveSmartAutoRetryPolicy({ enabled: true }).enabled).toBe(true);
    });
  });
});

describe("validateShipmentForSmartAutoRetry", () => {
  const base = {
    shipment: shipment({ status: "QUEUED", last_error_code: null }),
    address: validAddress,
    customer: { name: "Asha Rao", phone: "9876543210" },
    order: { status: "PROCESSING", fulfillment_status: "UNFULFILLED" },
  };

  it("accepts a complete India Post shipment", () => {
    expect(validateShipmentForSmartAutoRetry(base)).toEqual([]);
  });

  it("rejects an invalid PIN code without inventing a replacement", () => {
    const issues = validateShipmentForSmartAutoRetry({
      ...base,
      address: { ...validAddress, pincode: "12", address_validation_status: "INVALID" },
    });
    expect(issues.some((issue) => issue.code === "INVALID_PINCODE")).toBe(true);
  });

  it("rejects a missing address", () => {
    const issues = validateShipmentForSmartAutoRetry({ ...base, address: null });
    expect(issues.some((issue) => issue.code === "INVALID_ADDRESS")).toBe(true);
  });

  it("rejects an invalid phone number", () => {
    const issues = validateShipmentForSmartAutoRetry({
      ...base,
      customer: { name: "Asha Rao", phone: "12345" },
      address: { ...validAddress, phone: "12345" },
    });
    expect(issues.some((issue) => issue.field === "mobile")).toBe(true);
  });

  it("rejects missing weight", () => {
    const issues = validateShipmentForSmartAutoRetry({
      ...base,
      shipment: shipment({ weight_grams: 0, length_cm: 20, width_cm: 15, height_cm: 10 }),
    });
    expect(issues.some((issue) => issue.code === "INVALID_WEIGHT")).toBe(true);
  });

  it("rejects invalid parcel dimensions", () => {
    const issues = validateShipmentForSmartAutoRetry({
      ...base,
      shipment: shipment({ length_cm: 1, width_cm: 1, height_cm: 1, weight_grams: 500 }),
    });
    expect(issues.some((issue) => issue.code === "INVALID_DIMENSIONS")).toBe(true);
  });

  it("blocks a SHIPPED order", () => {
    const issues = validateShipmentForSmartAutoRetry({
      ...base,
      order: { status: "SHIPPED", fulfillment_status: "FULFILLED" },
    });
    expect(issues.some((issue) => issue.code === "BOOKING_REVIEW_REQUIRED")).toBe(true);
  });
});

describe("classifySmartAutoRetryFailure", () => {
  it("retries a pre-POST authentication timeout", () => {
    const classified = classifyProviderError({
      code: "PRE_POST_TRANSIENT",
      bookingPhase: "PRE_POST",
      message: "login timed out",
    });
    expect(
      classifySmartAutoRetryFailure({
        classified,
        error: { bookingPhase: "PRE_POST" },
        shipment: shipment(),
      })
    ).toBe("SAFE_TRANSIENT_FAILURE");
  });

  it("does not retry HTTP 500 after a booking POST", () => {
    const classified = classifyProviderError({
      code: "CEPT_UNKNOWN",
      status: 500,
      bookingPhase: "POST_SUBMIT",
      message: "after post",
    });
    expect(
      classifySmartAutoRetryFailure({
        classified,
        error: { bookingPhase: "POST_SUBMIT" },
        shipment: shipment({
          status: "RECOVERY_REQUIRED",
          barcode: "ET214330016IN",
          metadata: metadataWithCeptSubmitIntent({}, "2026-10-31T11:00:00.000Z"),
        }),
      })
    ).toBe("CEPT_OUTCOME_UNKNOWN");
  });

  it("does not treat a bare HTTP 500 as permission to POST again", () => {
    const classified = classifyProviderError({ status: 500, message: "boom" });
    expect(classified.retryable).toBe(true);
    expect(classifySmartAutoRetryFailure({ classified, shipment: shipment({ last_error_code: null }) })).toBe(
      "CEPT_OUTCOME_UNKNOWN"
    );
  });

  it("waits for correction on invalid PIN", () => {
    const classified = classifyProviderError({ code: "INVALID_PINCODE", message: "bad pin" });
    expect(classifySmartAutoRetryFailure({ classified, shipment: shipment({ last_error_code: "INVALID_PINCODE" }) })).toBe(
      "VALIDATION_FAILURE"
    );
  });

  it("marks CEPT_UNKNOWN as recovery required", () => {
    const classified = classifyProviderError({ code: "CEPT_UNKNOWN", bookingPhase: "POST_SUBMIT", message: "unknown" });
    expect(classifySmartAutoRetryFailure({ classified, error: { bookingPhase: "POST_SUBMIT" } })).toBe(
      "CEPT_OUTCOME_UNKNOWN"
    );
  });
});

describe("decideSmartAutoRetry", () => {
  it("does not schedule work while the flag is off", () => {
    const classified = classifyProviderError({
      code: "PRE_POST_TRANSIENT",
      bookingPhase: "PRE_POST",
      message: "queue hiccup",
    });
    const decision = decideSmartAutoRetry({
      classified,
      error: { bookingPhase: "PRE_POST" },
      shipment: shipment({ last_error_code: "PRE_POST_TRANSIENT", status: "QUEUED" }),
      attempt: 1,
    });
    expect(decision.enabled).toBe(false);
    expect(decision.shouldRetry).toBe(false);
  });

  it("schedules backoff for a verified safe transient failure", () => {
    withFlag("true", () => {
      const classified = classifyProviderError({
        code: "PRE_POST_TRANSIENT",
        bookingPhase: "PRE_POST",
        message: "login timed out",
      });
      const decision = decideSmartAutoRetry({
        classified,
        error: { bookingPhase: "PRE_POST" },
        shipment: shipment({ last_error_code: "PRE_POST_TRANSIENT", status: "QUEUED" }),
        attempt: 1,
        now: NOW,
        random: () => 0,
      });
      expect(decision.shouldRetry).toBe(true);
      expect(decision.retryDelayMs).toBe(SMART_AUTO_RETRY_DELAYS_MS[0]);
      expect(decision.merchantState).toBe("AUTO_RETRY_SCHEDULED");
    });
  });

  it("never unparks a historical job held at 2099", () => {
    withFlag("true", () => {
      const classified = classifyProviderError({
        code: "PRE_POST_TRANSIENT",
        bookingPhase: "PRE_POST",
        message: "login timed out",
      });
      const job = {
        id: "job-parked",
        status: "RETRYING",
        next_attempt_at: HISTORICAL_JOB_HOLD_AT,
        attempt_count: 2,
        max_attempts: 5,
      };
      expect(isParkedHistoricalBookingJob(job)).toBe(true);
      const decision = decideSmartAutoRetry({
        classified,
        error: { bookingPhase: "PRE_POST" },
        shipment: shipment({ created_at: "2026-10-08T00:00:00.000Z", last_error_code: null, barcode: null }),
        job,
        attempt: 3,
        now: NOW,
      });
      expect(decision.shouldRetry).toBe(false);
      expect(decision.parkedHistoricalJob).toBe(true);
    });
  });

  it("does not auto-retry a historical barcode", () => {
    withFlag("true", () => {
      const classified = classifyProviderError({ status: 502, message: "bad gateway" });
      const decision = decideSmartAutoRetry({
        classified,
        shipment: shipment({
          barcode: "CX00000001IN",
          last_error_code: "HTTP_502",
          status: "RECOVERY_REQUIRED",
        }),
        attempt: 1,
        now: NOW,
      });
      expect(decision.shouldRetry).toBe(false);
      expect(decision.retryClass).toBe("CEPT_OUTCOME_UNKNOWN");
    });
  });

  it("stops after the retry budget is exhausted", () => {
    withFlag("true", () => {
      const classified = classifyProviderError({
        code: "PRE_POST_TRANSIENT",
        bookingPhase: "PRE_POST",
        message: "timeout",
      });
      const decision = decideSmartAutoRetry({
        classified,
        error: { bookingPhase: "PRE_POST" },
        shipment: shipment({ last_error_code: "PRE_POST_TRANSIENT", status: "QUEUED" }),
        job: { id: "job-1", status: "RETRYING", attempt_count: 5, max_attempts: 5 },
        attempt: 5,
        now: NOW,
      });
      expect(decision.shouldRetry).toBe(false);
      expect(decision.merchantState).toBe("BOOKING_FAILED");
    });
  });

  it("does not race an in-progress Force Retry", () => {
    withFlag("true", () => {
      const classified = classifyProviderError({
        code: "PRE_POST_TRANSIENT",
        bookingPhase: "PRE_POST",
        message: "timeout",
      });
      const job = { id: "job-1", status: "RUNNING", locked_at: new Date(NOW - 1_000).toISOString() };
      const eligibility = evaluateBookingRetryEligibility(
        { shipment: shipment({ status: "BOOKING", last_error_code: "PRE_POST_TRANSIENT" }), job, purpose: "auto-retry" },
        NOW
      );
      expect(eligibility.action).toBe("BOOKING_IN_PROGRESS");
      const decision = decideSmartAutoRetry({
        classified,
        error: { bookingPhase: "PRE_POST" },
        shipment: shipment({ status: "BOOKING", last_error_code: "PRE_POST_TRANSIENT" }),
        job,
        attempt: 1,
        now: NOW,
      });
      expect(decision.shouldRetry).toBe(false);
    });
  });
});

describe("merchantSmartAutoRetryView", () => {
  it("does not present an uncertain booking as a normal retryable failure", () => {
    const view = merchantSmartAutoRetryView({
      shipment: shipment({
        status: "RECOVERY_REQUIRED",
        barcode: "ET214330016IN",
        last_error_code: "CEPT_UNKNOWN",
        last_error: "timeout after POST",
        metadata: metadataWithCeptSubmitIntent({}, "2026-10-31T11:00:00.000Z"),
      }),
    });
    expect(view.merchantState).toBe("RECOVERY_REQUIRED");
    expect(view.canEditShipment).toBe(false);
    expect(view.reason).toMatch(/not a normal retryable failure/i);
  });

  it("shows booked successfully after India Post accepts the article", () => {
    const view = merchantSmartAutoRetryView({
      shipment: shipment({ status: "BOOKED", booked_at: "2026-10-31T12:00:00.000Z", last_error: null }),
    });
    expect(view.merchantState).toBe("BOOKED_SUCCESSFULLY");
  });
});

describe("smartAutoRetryDelayForAttempt", () => {
  it("uses the documented backoff ladder with jitter", () => {
    expect(smartAutoRetryDelayForAttempt(1, [...SMART_AUTO_RETRY_DELAYS_MS], () => 0)).toBe(2 * 60_000);
    expect(smartAutoRetryDelayForAttempt(5, [...SMART_AUTO_RETRY_DELAYS_MS], () => 0)).toBe(60 * 60_000);
    expect(smartAutoRetryDelayForAttempt(9, [...SMART_AUTO_RETRY_DELAYS_MS], () => 0)).toBe(60 * 60_000);
  });
});

describe("parked job automatic claim", () => {
  it("treats 2099 holds as not due for automatic claim", () => {
    expect(isJobDueForAutomaticClaim({ next_attempt_at: HISTORICAL_JOB_HOLD_AT }, NOW)).toBe(false);
    expect(isJobDueForAutomaticClaim({ next_attempt_at: null }, NOW)).toBe(true);
    expect(isJobDueForAutomaticClaim({ next_attempt_at: "2026-10-31T11:00:00.000Z" }, NOW)).toBe(true);
    expect(isJobDueForAutomaticClaim({ next_attempt_at: "not-a-date" }, NOW)).toBe(false);
  });

  it("restores QUEUED vs RETRYING without marking the job succeeded", () => {
    expect(parkedHistoricalJobReleaseStatus({ attempt_count: 0 })).toBe("QUEUED");
    expect(parkedHistoricalJobReleaseStatus({ attempt_count: 2 })).toBe("RETRYING");
    expect(parkedHistoricalJobReleaseStatus({ attempt_count: 0, last_error_code: "HTTP_502" })).toBe("RETRYING");
  });

  it("re-parks a RUNNING claim back to 2099 without writing shipment evidence", async () => {
    const updates: Array<{ table: string; values: Record<string, unknown> }> = [];
    const supabase = {
      from(table: string) {
        return {
          update(values: Record<string, unknown>) {
            updates.push({ table, values });
            const chain = {
              eq() {
                return chain;
              },
              select() {
                return {
                  maybeSingle: async () => ({
                    data: { id: "job-parked", status: "RETRYING", next_attempt_at: HISTORICAL_JOB_HOLD_AT },
                    error: null,
                  }),
                };
              },
            };
            return chain;
          },
        };
      },
    };
    await reparkHistoricalBookingJob(supabase as never, {
      jobId: "job-parked",
      organizationId: "org-1",
      job: { attempt_count: 2, last_error_code: "HTTP_502" },
    });
    expect(updates).toEqual([
      {
        table: "background_jobs",
        values: {
          status: "RETRYING",
          locked_at: null,
          next_attempt_at: HISTORICAL_JOB_HOLD_AT,
        },
      },
    ]);
  });
});
