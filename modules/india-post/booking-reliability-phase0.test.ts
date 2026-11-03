import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { encryptSecret } from "@/lib/security/crypto";
import { classifyProviderError } from "@/lib/jobs/retry";
import {
  FORCE_BOOK_COOLDOWN_MS,
  forceBookRefusal,
} from "@/modules/india-post/booking-force-retry";
import {
  failedBeforeCeptCall,
  markCeptNotCalled,
  tagPrePostBookingError,
} from "@/modules/india-post/booking-failure-state";
import {
  metadataConsumingCeptForceResubmit,
  readCeptForceResubmitAt,
  readCeptForceResubmitConsumedAt,
} from "@/modules/india-post/booking-intent";
import {
  existingBarcodeMayBeSubmitted,
  shipmentMayBeRequeuedForBooking,
} from "@/modules/india-post/booking-retry-eligibility";
import type { IndiaPostBulkBatchStatus } from "@/modules/india-post/bulk-state";
import { BULK_NOT_SUBMITTED, runIndiaPostBulkWorkerAttempt, type BulkWorkerDeps } from "@/modules/india-post/bulk-worker";
import { IndiaPostProvider } from "@/modules/india-post/provider";
import { isUnknownBookingError } from "@/modules/orders/error-facts";
import { shipmentMayHoldIndiaPostBooking } from "@/modules/shipments/service";

const NOW = Date.parse("2026-11-02T10:00:00.000Z");
const BARCODE = "CX467191634IN";

function failedShipment(overrides: Record<string, unknown> = {}) {
  return { id: "ship-1", status: "RECOVERY_REQUIRED", barcode: BARCODE, tracking_number: null, metadata: {}, ...overrides };
}

describe("force book refusals", () => {
  it("lets an owner or admin force a failed or unconfirmed booking", () => {
    expect(forceBookRefusal({ role: "OWNER", shipment: failedShipment() }, NOW)).toBeNull();
    expect(forceBookRefusal({ role: "admin", shipment: failedShipment({ status: "FAILED" }) }, NOW)).toBeNull();
  });

  it("refuses everyone else", () => {
    for (const role of ["MANAGER", "OPERATOR", "VIEWER", null]) {
      expect(forceBookRefusal({ role, shipment: failedShipment() }, NOW)?.kind).toBe("forbidden");
    }
  });

  it("never forces a booking that is in flight or not failed", () => {
    for (const status of ["BOOKING", "QUEUED", "DRAFT", "BOOKED", "LABEL_PENDING"]) {
      expect(forceBookRefusal({ role: "OWNER", shipment: failedShipment({ status }) }, NOW)?.kind).toBe("conflict");
    }
  });

  it("refuses a shipment owned by a bulk batch", () => {
    for (const result of ["PENDING", "SUBMITTED", "RECOVERY_REQUIRED", "SUCCEEDED"]) {
      expect(
        forceBookRefusal({ role: "OWNER", shipment: failedShipment(), bulkArticleResult: result }, NOW)?.kind
      ).toBe("conflict");
    }
  });

  it("refuses while a booking job is scheduled or running", () => {
    expect(
      forceBookRefusal({ role: "OWNER", shipment: failedShipment(), job: { id: "job-1", status: "QUEUED" } }, NOW)?.action
    ).toBe("RETRY_ALREADY_SCHEDULED");
    expect(
      forceBookRefusal(
        {
          role: "OWNER",
          shipment: failedShipment(),
          job: { id: "job-1", status: "RUNNING", locked_at: new Date(NOW - 60_000).toISOString() },
        },
        NOW
      )?.action
    ).toBe("BOOKING_IN_PROGRESS");
  });

  it("allows force book without a barcode so the run can allocate one", () => {
    expect(forceBookRefusal({ role: "OWNER", shipment: failedShipment({ barcode: null }) }, NOW)).toBeNull();
  });

  it("applies a cooldown after a force was used", () => {
    const recent = failedShipment({
      metadata: { ceptForceResubmitConsumedAt: new Date(NOW - 60_000).toISOString() },
    });
    expect(forceBookRefusal({ role: "OWNER", shipment: recent }, NOW)?.reason).toMatch(/Try again in/);
    const old = failedShipment({
      metadata: { ceptForceResubmitConsumedAt: new Date(NOW - FORCE_BOOK_COOLDOWN_MS - 1).toISOString() },
    });
    expect(forceBookRefusal({ role: "OWNER", shipment: old }, NOW)).toBeNull();
  });
});

describe("force permission is single-use", () => {
  it("swaps the permission for a consumed timestamp and keeps the intent", () => {
    const next = metadataConsumingCeptForceResubmit(
      { ceptSubmitIntentAt: "2026-11-01T00:00:00.000Z", ceptForceResubmitAt: "2026-11-02T00:00:00.000Z" },
      "2026-11-02T00:05:00.000Z"
    );
    expect(readCeptForceResubmitAt(next)).toBeNull();
    expect(readCeptForceResubmitConsumedAt(next)).toBe("2026-11-02T00:05:00.000Z");
    expect(next.ceptSubmitIntentAt).toBe("2026-11-01T00:00:00.000Z");
    // With the permission used, the barcode may not be sent again.
    expect(existingBarcodeMayBeSubmitted({ barcode: BARCODE, metadata: next })).toBe(false);
  });

  it("leaves metadata without a permission unchanged", () => {
    expect(metadataConsumingCeptForceResubmit({ a: 1 }, "x")).toEqual({ a: 1 });
  });
});

describe("requeue rule", () => {
  const base = { status: "FAILED", booked_at: null, tracking_number: null, provider_ref: null, metadata: {} };

  it("requeues a shipment without a barcode", () => {
    expect(shipmentMayBeRequeuedForBooking({ ...base, barcode: null })).toBe(true);
  });

  it("requeues a barcode recorded as never sent or written with a creation proof", () => {
    expect(shipmentMayBeRequeuedForBooking({ ...base, barcode: BARCODE, last_error_code: "PRE_POST_TRANSIENT" })).toBe(true);
    expect(shipmentMayBeRequeuedForBooking({ ...base, barcode: BARCODE, last_error_code: "BULK_NOT_SUBMITTED" })).toBe(true);
    expect(
      shipmentMayBeRequeuedForBooking({ ...base, barcode: BARCODE, metadata: { bookingBarcodeProof: { v: 1 } } })
    ).toBe(true);
  });

  it("keeps anything that may already be at India Post out of the queue", () => {
    expect(shipmentMayBeRequeuedForBooking({ ...base, barcode: BARCODE, last_error_code: "INDIA_POST_VALIDATION" })).toBe(false);
    expect(
      shipmentMayBeRequeuedForBooking({ ...base, metadata: { ceptSubmitIntentAt: "2026-11-01T00:00:00.000Z" } })
    ).toBe(false);
    expect(shipmentMayBeRequeuedForBooking({ ...base, tracking_number: BARCODE })).toBe(false);
    expect(shipmentMayBeRequeuedForBooking({ ...base, provider_ref: "batch-1" })).toBe(false);
    expect(shipmentMayBeRequeuedForBooking({ ...base, status: "RECOVERY_REQUIRED", barcode: BARCODE })).toBe(false);
    expect(shipmentMayBeRequeuedForBooking({ ...base, status: "RECOVERY_REQUIRED" })).toBe(true);
    expect(shipmentMayBeRequeuedForBooking({ ...base, status: "BOOKING" })).toBe(false);
  });
});

describe("second shipment for one order", () => {
  it("blocks a new shipment while an existing one may be at India Post", () => {
    expect(shipmentMayHoldIndiaPostBooking({ status: "FAILED", barcode: BARCODE })).toBe(true);
    expect(
      shipmentMayHoldIndiaPostBooking({ status: "FAILED", metadata: { ceptSubmitIntentAt: "2026-11-01T00:00:00.000Z" } })
    ).toBe(true);
    expect(shipmentMayHoldIndiaPostBooking({ status: "RECOVERY_REQUIRED" })).toBe(true);
    expect(shipmentMayHoldIndiaPostBooking({ status: "BOOKING" })).toBe(true);
    expect(shipmentMayHoldIndiaPostBooking({ status: "FAILED", provider_ref: "batch-1" })).toBe(true);
  });

  it("allows a new shipment beside a clean failure or a cancellation", () => {
    expect(shipmentMayHoldIndiaPostBooking({ status: "FAILED", barcode: null })).toBe(false);
    expect(shipmentMayHoldIndiaPostBooking({ status: "CANCELLED", barcode: BARCODE })).toBe(false);
  });
});

describe("pre-POST error tagging", () => {
  it("makes a busy booking lock retryable with a never-submitted code", () => {
    const busy = Object.assign(new Error("India Post booking lock is busy. Retrying."), {
      code: "TEMPORARY_PROVIDER_FAILURE",
    });
    const tagged = tagPrePostBookingError(busy);
    expect(tagged).toMatchObject({ code: "PRE_POST_TRANSIENT", bookingPhase: "PRE_POST" });
    expect(classifyProviderError(tagged)).toMatchObject({ retryable: true, code: "PRE_POST_TRANSIENT" });
  });

  it("leaves permanent errors and CEPT processing conflicts alone", () => {
    const contract = Object.assign(new Error("No contract"), { code: "INVALID_CONTRACT" });
    expect(tagPrePostBookingError(contract)).toBe(contract);
    const conflict = Object.assign(new Error("processing"), { code: "TEMPORARY_PROVIDER_FAILURE", status: 409 });
    expect(tagPrePostBookingError(conflict)).toBe(conflict);
  });

  it("tells a never-sent failure from an older unknown outcome", () => {
    const lock = Object.assign(new Error("busy"), { code: "PRE_POST_TRANSIENT" });
    markCeptNotCalled(lock);
    expect(failedBeforeCeptCall(lock)).toBe(true);
    for (const code of ["CEPT_UNKNOWN", "ETIMEDOUT", "BOOKING_REVIEW_REQUIRED"]) {
      const older = Object.assign(new Error("older"), { code });
      markCeptNotCalled(older);
      expect(failedBeforeCeptCall(older)).toBe(false);
    }
    expect(failedBeforeCeptCall(Object.assign(new Error("posted"), { code: "PRE_POST_TRANSIENT" }))).toBe(false);
  });
});

describe("bulk batch errors before the POST", () => {
  function memoryDeps(batch: { id: string; status: IndiaPostBulkBatchStatus }) {
    const articles = new Map<string, string>();
    const deps: BulkWorkerDeps = {
      transition: async (_supabase, _id, from, to) => {
        if (batch.status !== from) return false;
        batch.status = to;
        return true;
      },
      persistArticles: async (_supabase, _id, input) => {
        for (const id of input.bookedIds) articles.set(id, "SUCCEEDED");
        for (const id of input.failedIds) articles.set(id, "FAILED");
        for (const id of input.recoveryIds ?? []) articles.set(id, "RECOVERY_REQUIRED");
      },
      recordMetric: () => undefined,
    };
    return { deps, articles };
  }

  it("closes the batch as FAILED and leaves members retryable when nothing was sent", async () => {
    const batch = { id: "batch-1", status: "READY" as IndiaPostBulkBatchStatus };
    const { deps, articles } = memoryDeps(batch);
    const lockBusy = Object.assign(new Error("lock busy"), { code: "PRE_POST_TRANSIENT", bookingPhase: "PRE_POST" });
    markCeptNotCalled(lockBusy);
    await expect(
      runIndiaPostBulkWorkerAttempt(
        {
          supabase: {} as SupabaseClient,
          organizationId: "org-1",
          shipmentIds: ["s1", "s2"],
          bulkBatch: batch,
          post: async () => {
            throw lockBusy;
          },
        },
        deps
      )
    ).rejects.toMatchObject({ code: BULK_NOT_SUBMITTED });
    expect(batch.status).toBe("FAILED");
    expect(articles.get("s1")).toBe("FAILED");
    expect(articles.get("s2")).toBe("FAILED");
    expect(classifyProviderError({ code: BULK_NOT_SUBMITTED, message: "x" }).retryable).toBe(false);
    expect(
      existingBarcodeMayBeSubmitted({ barcode: BARCODE, last_error_code: BULK_NOT_SUBMITTED, metadata: {} })
    ).toBe(true);
  });

  it("keeps a permanent pre-POST error's own code", async () => {
    const batch = { id: "batch-1", status: "READY" as IndiaPostBulkBatchStatus };
    const { deps } = memoryDeps(batch);
    const invalid = Object.assign(new Error("No contract"), { code: "INVALID_CONTRACT" });
    markCeptNotCalled(invalid);
    await expect(
      runIndiaPostBulkWorkerAttempt(
        {
          supabase: {} as SupabaseClient,
          organizationId: "org-1",
          shipmentIds: ["s1"],
          bulkBatch: batch,
          post: async () => {
            throw invalid;
          },
        },
        deps
      )
    ).rejects.toMatchObject({ code: "INVALID_CONTRACT" });
    expect(batch.status).toBe("FAILED");
  });

  it("still sends a batch to recovery when the POST may have reached India Post", async () => {
    const batch = { id: "batch-1", status: "READY" as IndiaPostBulkBatchStatus };
    const { deps, articles } = memoryDeps(batch);
    await expect(
      runIndiaPostBulkWorkerAttempt(
        {
          supabase: {} as SupabaseClient,
          organizationId: "org-1",
          shipmentIds: ["s1"],
          bulkBatch: batch,
          post: async () => {
            throw Object.assign(new Error("timeout"), { code: "CEPT_UNKNOWN", bookingPhase: "POST_SUBMIT" });
          },
        },
        deps
      )
    ).rejects.toMatchObject({ code: "CEPT_UNKNOWN" });
    expect(batch.status).toBe("RECOVERY_REQUIRED");
    expect(articles.get("s1")).toBe("RECOVERY_REQUIRED");
  });
});

describe("401 on a booking POST", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("replays once with a fresh token and the same barcode", async () => {
    const bodies: string[] = [];
    let bookingCalls = 0;
    const fetchMock = vi.fn(async (url: string, init?: { body?: unknown }) => {
      if (String(url).includes("/access/") || String(url).includes("Token")) {
        return {
          ok: true,
          json: async () => ({ success: true, data: { access_token: "fresh", refresh_token: "r", expires_in: 3600 } }),
        };
      }
      bodies.push(String(init?.body ?? ""));
      bookingCalls += 1;
      if (bookingCalls === 1) return { ok: false, status: 401, json: async () => ({ success: false }) };
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true, valid_articles: [{ barcode_no: BARCODE, article_number: BARCODE }] }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);
    const provider = new IndiaPostProvider({
      environment: "UAT",
      status: "CONNECTED",
      encrypted_username: encryptSecret("user"),
      encrypted_password: encryptSecret("pass"),
      bulk_customer_id: "1000002954",
    });
    await provider.bookShipment({ articles: [{ barcode_no: BARCODE }] });
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toBe(bodies[1]);
    expect(bodies[1]).toContain(BARCODE);
  });
});

describe("orders page force book offer", () => {
  it("offers force book for every shipment awaiting recovery", () => {
    expect(isUnknownBookingError({ status: "RECOVERY_REQUIRED", last_error_code: "BOOKING_REVIEW_REQUIRED" })).toBe(true);
    expect(isUnknownBookingError({ status: "FAILED", last_error_code: "BOOKING_REVIEW_REQUIRED" })).toBe(true);
    expect(isUnknownBookingError({ status: "FAILED", last_error_code: "VALIDATION_ERROR" })).toBe(false);
  });
});
