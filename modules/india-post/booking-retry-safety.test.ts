import { describe, expect, it } from "vitest";
import { classifyProviderError } from "@/lib/jobs/retry";
import { metadataWithCeptSubmitIntent } from "@/modules/india-post/booking-intent";
import { assertShipmentsClassified } from "@/modules/india-post/booking-run";
import { bookingAutoRecoveryEnabled, runBookingAutoRecovery } from "@/modules/india-post/booking-recovery";
import {
  bulkRetryBucket,
  evaluateBookingRetryEligibility,
  STALE_BOOKING_LOCK_MS,
  type BookingRetryAction,
} from "@/modules/india-post/booking-retry-eligibility";

const NOW = Date.parse("2026-10-31T03:00:00.000Z");

function shipment(overrides: Record<string, unknown> = {}) {
  return {
    id: "ship-1",
    status: "QUEUED",
    booked_at: null,
    barcode: null,
    tracking_number: null,
    provider_ref: null,
    last_error_code: null,
    metadata: {},
    ...overrides,
  };
}

describe("evaluateBookingRetryEligibility", () => {
  it("requeues a QUEUED shipment that has no job and was never submitted", () => {
    const decision = evaluateBookingRetryEligibility({ shipment: shipment() }, NOW);
    expect(decision).toMatchObject({ eligible: true, action: "SAFE_TO_REQUEUE", requiresManualReview: false });
  });

  it("reuses an existing QUEUED job instead of implying a second one", () => {
    const decision = evaluateBookingRetryEligibility(
      { shipment: shipment(), job: { id: "job-1", status: "QUEUED", attempt_count: 0, max_attempts: 5 } },
      NOW
    );
    expect(decision.action).toBe("SAFE_TO_REQUEUE");
    expect(decision.existingJobId).toBe("job-1");
  });

  it("reports a future RETRYING job as already scheduled", () => {
    const decision = evaluateBookingRetryEligibility(
      {
        shipment: shipment({ last_error_code: "PRE_POST_TRANSIENT" }),
        job: {
          id: "job-1",
          status: "RETRYING",
          next_attempt_at: new Date(NOW + 60_000).toISOString(),
          attempt_count: 1,
          max_attempts: 5,
        },
      },
      NOW
    );
    expect(decision.action).toBe("RETRY_ALREADY_SCHEDULED");
    expect(decision.eligible).toBe(false);
  });

  it("treats a fresh RUNNING lock as booking in progress", () => {
    const decision = evaluateBookingRetryEligibility(
      {
        shipment: shipment(),
        job: { id: "job-1", status: "RUNNING", locked_at: new Date(NOW - 60_000).toISOString() },
      },
      NOW
    );
    expect(decision.action).toBe("BOOKING_IN_PROGRESS");
  });

  it("allows the same job to be reclaimed after a stale lock when CEPT was not contacted", () => {
    const decision = evaluateBookingRetryEligibility(
      {
        shipment: shipment(),
        job: {
          id: "job-1",
          status: "RUNNING",
          locked_at: new Date(NOW - STALE_BOOKING_LOCK_MS - 1_000).toISOString(),
        },
      },
      NOW
    );
    expect(decision.action).toBe("SAFE_TO_REQUEUE");
    expect(decision.existingJobId).toBe("job-1");
  });

  it("blocks a booked shipment", () => {
    expect(evaluateBookingRetryEligibility({ shipment: shipment({ status: "BOOKED", booked_at: "2026-10-01T00:00:00.000Z" }) }, NOW).action).toBe(
      "ALREADY_BOOKED"
    );
  });

  it("blocks a QUEUED row that already has booked_at", () => {
    expect(
      evaluateBookingRetryEligibility(
        { shipment: shipment({ status: "QUEUED", booked_at: "2026-10-01T00:00:00.000Z", barcode: "ET214330016IN" }) },
        NOW
      ).action
    ).toBe("ALREADY_BOOKED");
  });

  it("blocks RECOVERY_REQUIRED with a barcode", () => {
    const decision = evaluateBookingRetryEligibility(
      { shipment: shipment({ status: "RECOVERY_REQUIRED", barcode: "ET214330016IN" }) },
      NOW
    );
    expect(decision.action).toBe("BOOKING_OUTCOME_UNKNOWN");
    expect(decision.requiresManualReview).toBe(true);
  });

  it("blocks RECOVERY_REQUIRED even when no barcode was stored", () => {
    expect(evaluateBookingRetryEligibility({ shipment: shipment({ status: "RECOVERY_REQUIRED" }) }, NOW).action).toBe(
      "BOOKING_OUTCOME_UNKNOWN"
    );
  });

  it("allows a pre-POST authentication timeout to be retried", () => {
    const classified = classifyProviderError({
      name: "AbortError",
      message: "login timed out",
      code: "PRE_POST_TRANSIENT",
      bookingPhase: "PRE_POST",
    });
    expect(classified.code).toBe("PRE_POST_TRANSIENT");
    const decision = evaluateBookingRetryEligibility(
      { shipment: shipment({ status: "QUEUED", last_error_code: "PRE_POST_TRANSIENT" }) },
      NOW
    );
    expect(decision.action).toBe("SAFE_TO_REQUEUE");
  });

  it("blocks a timeout after the booking POST", () => {
    const decision = evaluateBookingRetryEligibility(
      {
        shipment: shipment({
          status: "RECOVERY_REQUIRED",
          barcode: "ET214330016IN",
          last_error_code: "ETIMEDOUT",
          metadata: { ceptSubmitIntentAt: "2026-10-31T02:00:00.000Z" },
        }),
      },
      NOW
    );
    expect(decision.action).toBe("BOOKING_OUTCOME_UNKNOWN");
  });

  it("blocks HTTP 500 after a barcode was submitted", () => {
    const decision = evaluateBookingRetryEligibility(
      { shipment: shipment({ status: "QUEUED", barcode: "ET214330016IN", last_error_code: "HTTP_500" }) },
      NOW
    );
    expect(decision.action).toBe("BOOKING_OUTCOME_UNKNOWN");
  });

  it("keeps a second click on the same QUEUED job idempotent", () => {
    const first = evaluateBookingRetryEligibility({ shipment: shipment() }, NOW);
    const second = evaluateBookingRetryEligibility(
      { shipment: shipment(), job: { id: "job-1", status: "QUEUED", attempt_count: 0, max_attempts: 5 } },
      NOW
    );
    expect(first.action).toBe("SAFE_TO_REQUEUE");
    expect(second.action).toBe("SAFE_TO_REQUEUE");
    expect(second.existingJobId).toBe("job-1");
  });

  it("stops when the failed job has used every attempt", () => {
    const decision = evaluateBookingRetryEligibility(
      {
        shipment: shipment({ status: "FAILED", last_error_code: "PRE_POST_TRANSIENT" }),
        job: { id: "job-1", status: "FAILED", attempt_count: 5, max_attempts: 5 },
      },
      NOW
    );
    expect(decision.action).toBe("MAX_ATTEMPTS_EXCEEDED");
  });

  it("sends a succeeded job with a still-queued shipment to review", () => {
    const decision = evaluateBookingRetryEligibility(
      { shipment: shipment({ status: "QUEUED" }), job: { id: "job-1", status: "SUCCEEDED" } },
      NOW
    );
    expect(decision.action).toBe("MANUAL_REVIEW_REQUIRED");
  });

  it("does not treat a missing tracking result as permission to resubmit", () => {
    const decision = evaluateBookingRetryEligibility(
      {
        shipment: shipment({
          status: "RECOVERY_REQUIRED",
          barcode: "ET214330016IN",
          last_error_code: "CEPT_UNKNOWN",
          metadata: { ceptSubmitIntentAt: "2026-10-31T02:00:00.000Z" },
        }),
      },
      NOW
    );
    expect(decision.eligible).toBe(false);
    expect(decision.reason).toMatch(/could not be confirmed/i);
  });

  it("blocks QUEUED with a barcode and a null error code", () => {
    expect(
      evaluateBookingRetryEligibility({ shipment: shipment({ barcode: "ET214330016IN" }) }, NOW).action
    ).toBe("BOOKING_OUTCOME_UNKNOWN");
  });

  it("blocks FAILED with an existing barcode", () => {
    expect(
      evaluateBookingRetryEligibility(
        { shipment: shipment({ status: "FAILED", barcode: "ET214330016IN", last_error_code: "VALIDATION_ERROR" }) },
        NOW
      ).action
    ).toBe("BOOKING_OUTCOME_UNKNOWN");
  });

  it("blocks QUEUED with TEMPORARY_PROVIDER_FAILURE even without a barcode", () => {
    expect(
      evaluateBookingRetryEligibility(
        { shipment: shipment({ last_error_code: "TEMPORARY_PROVIDER_FAILURE" }) },
        NOW
      ).action
    ).toBe("BOOKING_OUTCOME_UNKNOWN");
  });

  it("blocks ETIMEDOUT when no barcode was stored", () => {
    expect(
      evaluateBookingRetryEligibility({ shipment: shipment({ status: "FAILED", last_error_code: "ETIMEDOUT" }) }, NOW).action
    ).toBe("BOOKING_OUTCOME_UNKNOWN");
  });

  it("blocks a historical shipment that has no submit marker but has a tracking number", () => {
    expect(
      evaluateBookingRetryEligibility(
        { shipment: shipment({ tracking_number: "ET214330016IN", metadata: {} }) },
        NOW
      ).action
    ).toBe("BOOKING_OUTCOME_UNKNOWN");
  });

  it("blocks a historical shipment whose job already ran and whose error was cleared", () => {
    expect(
      evaluateBookingRetryEligibility(
        { shipment: shipment(), job: { id: "job-old", status: "FAILED", attempt_count: 2, max_attempts: 5 } },
        NOW
      ).action
    ).toBe("BOOKING_OUTCOME_UNKNOWN");
  });

  it("keeps Force Retry off unless the flag is explicitly true", async () => {
    const { bookingForceRetryEnabled } = await import("@/modules/india-post/booking-recovery");
    const previous = process.env.BOOKING_FORCE_RETRY_ENABLED;
    delete process.env.BOOKING_FORCE_RETRY_ENABLED;
    expect(bookingForceRetryEnabled()).toBe(false);
    process.env.BOOKING_FORCE_RETRY_ENABLED = "true";
    expect(bookingForceRetryEnabled()).toBe(true);
    if (previous === undefined) delete process.env.BOOKING_FORCE_RETRY_ENABLED;
    else process.env.BOOKING_FORCE_RETRY_ENABLED = previous;
  });
});

describe("booking submission intent and classification", () => {
  it("does not replace an existing submit intent", () => {
    const next = metadataWithCeptSubmitIntent({ ceptSubmitIntentAt: "2026-10-01T00:00:00.000Z", keep: true }, "2026-10-02T00:00:00.000Z");
    expect(next.ceptSubmitIntentAt).toBe("2026-10-01T00:00:00.000Z");
    expect(next.keep).toBe(true);
  });

  it("refuses to mark a job complete when a posted article was not classified", () => {
    expect(() =>
      assertShipmentsClassified({
        requestedIds: ["a", "b"],
        bookedIds: ["a"],
        failedIds: [],
        preparedIds: ["a", "b"],
      })
    ).toThrow(expect.objectContaining({ code: "CEPT_UNKNOWN" }));
  });

  it("retries a shipment that never reached the booking POST", () => {
    expect(() =>
      assertShipmentsClassified({
        requestedIds: ["a"],
        bookedIds: [],
        failedIds: [],
        preparedIds: [],
      })
    ).toThrow(expect.objectContaining({ code: "PRE_POST_TRANSIENT" }));
  });

  it("keeps a partial batch classified when every prepared article has an outcome", () => {
    expect(() =>
      assertShipmentsClassified({
        requestedIds: ["ok", "bad"],
        bookedIds: ["ok"],
        failedIds: ["bad"],
        preparedIds: ["ok", "bad"],
      })
    ).not.toThrow();
  });
});

describe("bulk retry buckets", () => {
  it("counts mixed eligibility without collapsing every row into one result", () => {
    const actions: BookingRetryAction[] = [
      "SAFE_TO_REQUEUE",
      "ALREADY_BOOKED",
      "BOOKING_IN_PROGRESS",
      "BOOKING_OUTCOME_UNKNOWN",
      "INVALID_SHIPMENT",
    ];
    const counts = { eligible: 0, alreadyProcessing: 0, needsReview: 0, failedValidation: 0 };
    for (const action of actions) {
      const bucket = bulkRetryBucket(action);
      if (bucket === "eligible") counts.eligible += 1;
      if (bucket === "alreadyProcessing") counts.alreadyProcessing += 1;
      if (bucket === "needsReview") counts.needsReview += 1;
      if (bucket === "failedValidation") counts.failedValidation += 1;
    }
    expect(counts).toEqual({ eligible: 1, alreadyProcessing: 1, needsReview: 1, failedValidation: 2 });
  });
});

describe("booking auto recovery", () => {
  it("stays off unless BOOKING_AUTO_RECOVERY is enabled", async () => {
    const previous = process.env.BOOKING_AUTO_RECOVERY;
    delete process.env.BOOKING_AUTO_RECOVERY;
    expect(bookingAutoRecoveryEnabled()).toBe(false);
    const supabase = { from: () => { throw new Error("should not query"); } };
    await expect(runBookingAutoRecovery(supabase as never)).resolves.toEqual({ enabled: false, recovered: 0, skipped: 0 });
    if (previous === undefined) delete process.env.BOOKING_AUTO_RECOVERY;
    else process.env.BOOKING_AUTO_RECOVERY = previous;
  });

  it("does not start a second recovery while one is running", async () => {
    const previous = process.env.BOOKING_AUTO_RECOVERY;
    process.env.BOOKING_AUTO_RECOVERY = "true";
    let calls = 0;
    const supabase = {
      from() {
        calls += 1;
        const query = {
          select: () => query,
          eq: () => query,
          is: () => query,
          lt: () => query,
          order: () => query,
          limit: async () => {
            await new Promise((resolve) => setTimeout(resolve, 15));
            return { data: [], error: null };
          },
        };
        return query;
      },
    };
    const [first, second] = await Promise.all([
      runBookingAutoRecovery(supabase as never),
      runBookingAutoRecovery(supabase as never),
    ]);
    expect(calls).toBe(1);
    expect(first.enabled).toBe(true);
    expect(second.enabled).toBe(true);
    if (previous === undefined) delete process.env.BOOKING_AUTO_RECOVERY;
    else process.env.BOOKING_AUTO_RECOVERY = previous;
  });
});
