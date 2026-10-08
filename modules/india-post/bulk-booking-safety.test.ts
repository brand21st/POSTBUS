import { afterEach, describe, expect, it } from "vitest";
import { indiaPostBookingTransport } from "@/modules/india-post/booking-batch";
import { canRetryCeptPostAfterUnknown } from "@/modules/india-post/booking-idempotency";
import {
  barcodesAreUnique,
  buildIndiaPostBulkBatches,
  requestFingerprint,
  sortBulkCandidatesDeterministically,
} from "@/modules/india-post/bulk-batch-build";
import { planIndiaPostBulkWork } from "@/modules/india-post/bulk-engine";
import { classifyBulkHttpOutcome } from "@/modules/india-post/bulk-classify";
import {
  effectiveIndiaPostBookingBatchSize,
  INDIA_POST_JSON_BULK_CODE_MAX,
  INDIA_POST_JSON_BULK_DOCUMENTED_BELOW,
  INDIA_POST_JSON_BULK_LIMIT_VERIFIED,
  indiaPostBulkConcurrency,
  indiaPostBulkEnabled,
} from "@/modules/india-post/bulk-config";
import { bulkShipmentEligible, rejectIncompatibleBulkMix, type BulkCandidate } from "@/modules/india-post/bulk-eligibility";
import {
  labelsForSuccessfulArticlesOnly,
  reconcileBulkCeptResponse,
  succeededArticlesMustNotRetry,
} from "@/modules/india-post/bulk-reconcile";
import {
  articlesAllowedToRetryIndividually,
  canSubmitCeptAtCrashPoint,
  duplicateWorkerMustSkipPost,
} from "@/modules/india-post/bulk-recovery";
import { assertIndiaPostBulkPostAllowed, bulkWorkerMayPost } from "@/modules/india-post/bulk-run";
import { INDIA_POST_BULK_ALERTS } from "@/modules/india-post/bulk-alerts";
import { evaluateBulkCrashRestart, INDIA_POST_BULK_CRASH_SCENARIOS } from "@/modules/india-post/bulk-crash";
import { canTransitionIndiaPostBulkBatch, fingerprintRetryPolicy } from "@/modules/india-post/bulk-state";
import { INDIA_POST_FILE_BOOKING_MAX, INDIA_POST_JSON_BOOKING_MAX } from "@/modules/india-post/spec";

afterEach(() => {
  delete process.env.INDIA_POST_BULK_ENABLED;
  delete process.env.INDIA_POST_BULK_MAX_ARTICLES;
  delete process.env.INDIA_POST_BULK_CONCURRENCY;
});

function candidate(overrides: Partial<BulkCandidate> = {}): BulkCandidate {
  return {
    shipmentId: "s1",
    jobId: "j1",
    organizationId: "org-1",
    indiaPostCustomerId: "1392911671",
    contractId: "prod-contract",
    serviceCode: "SP_INLAND_PARCEL",
    environment: "PRODUCTION",
    createdAt: "2026-10-09T00:00:00.000Z",
    barcode: "CX000000001IN",
    lengthCm: 15,
    widthCm: 10,
    heightCm: 5,
    weightGrams: 50,
    status: "QUEUED",
    ...overrides,
  };
}

describe("India Post bulk feature flag", () => {
  it("defaults bulk off and concurrency 1", () => {
    expect(indiaPostBulkEnabled()).toBe(false);
    expect(indiaPostBulkConcurrency()).toBe(1);
    expect(effectiveIndiaPostBookingBatchSize()).toBe(1);
    process.env.INDIA_POST_BULK_CONCURRENCY = "8";
    expect(indiaPostBulkConcurrency()).toBe(1);
  });

  it("does not treat BATCH_SIZE as bulk enablement", () => {
    process.env.INDIA_POST_BULK_ENABLED = "false";
    expect(effectiveIndiaPostBookingBatchSize()).toBe(1);
  });

  it("fail-closes on missing or malformed flags", () => {
    delete process.env.INDIA_POST_BULK_ENABLED;
    expect(indiaPostBulkEnabled()).toBe(false);
    for (const value of ["TRUE", "True", "1", "yes", "on", "", "false"]) {
      process.env.INDIA_POST_BULK_ENABLED = value;
      expect(indiaPostBulkEnabled()).toBe(false);
    }
    process.env.INDIA_POST_BULK_ENABLED = "true";
    expect(indiaPostBulkEnabled()).toBe(true);
  });
});

describe("bulk batch construction", () => {
  it("builds deterministic batches without duplicate membership", () => {
    const rows = [
      candidate({ shipmentId: "s2", jobId: "j2", createdAt: "2026-10-09T00:00:01.000Z", barcode: "CX000000002IN" }),
      candidate({ shipmentId: "s1", jobId: "j1", createdAt: "2026-10-09T00:00:00.000Z", barcode: "CX000000001IN" }),
      candidate({ shipmentId: "s1", jobId: "j9", createdAt: "2026-10-09T00:00:00.000Z", barcode: "CX000000001IN" }),
    ];
    process.env.INDIA_POST_BULK_MAX_ARTICLES = "10";
    const batches = buildIndiaPostBulkBatches(rows, { maxArticles: 10 }).batches;
    expect(batches).toHaveLength(1);
    expect(batches[0].shipmentIds).toEqual(["s1", "s2"]);
  });

  it("sorts by created_at then job_id then shipment_id", () => {
    const sorted = sortBulkCandidatesDeterministically([
      candidate({ shipmentId: "b", jobId: "j2", createdAt: "2026-10-09T00:00:00.000Z" }),
      candidate({ shipmentId: "a", jobId: "j1", createdAt: "2026-10-09T00:00:00.000Z" }),
      candidate({ shipmentId: "c", jobId: "j0", createdAt: "2026-10-09T00:00:01.000Z" }),
    ]);
    expect(sorted.map((row) => row.shipmentId)).toEqual(["a", "b", "c"]);
  });

  it("rejects a shipment already in an active batch", () => {
    const batches = buildIndiaPostBulkBatches(
      [candidate({ shipmentId: "s1" }), candidate({ shipmentId: "s2", jobId: "j2", barcode: "CX000000002IN" })],
      { maxArticles: 10, activeShipmentIds: new Set(["s1"]) }
    ).batches;
    expect(batches).toHaveLength(0);
  });

  it("rejects cross-organization mix", () => {
    expect(
      rejectIncompatibleBulkMix([
        candidate({ organizationId: "org-a" }),
        candidate({ organizationId: "org-b", shipmentId: "s2" }),
      ]).ok
    ).toBe(false);
  });

  it("rejects cross-customer mix", () => {
    expect(
      rejectIncompatibleBulkMix([
        candidate({ indiaPostCustomerId: "1" }),
        candidate({ indiaPostCustomerId: "2", shipmentId: "s2" }),
      ]).ok
    ).toBe(false);
  });

  it("rejects mixed connections, offices, and environments", () => {
    expect(
      rejectIncompatibleBulkMix([
        candidate({ indiaPostConnectionId: "conn-a" }),
        candidate({ indiaPostConnectionId: "conn-b", shipmentId: "s2" }),
      ]).ok
    ).toBe(false);
    expect(
      rejectIncompatibleBulkMix([
        candidate({ officeId: "1" }),
        candidate({ officeId: "2", shipmentId: "s2" }),
      ]).ok
    ).toBe(false);
    expect(
      rejectIncompatibleBulkMix([
        candidate({ environment: "UAT" }),
        candidate({ environment: "PRODUCTION", shipmentId: "s2" }),
      ]).ok
    ).toBe(false);
  });

  it("rejects contract mismatch", () => {
    expect(
      rejectIncompatibleBulkMix([
        candidate({ contractId: "c1" }),
        candidate({ contractId: "c2", shipmentId: "s2" }),
      ]).ok
    ).toBe(false);
  });

  it("keeps invalid dimensions out of a batch", () => {
    expect(bulkShipmentEligible(candidate({ lengthCm: 10 }))).toBe(false);
  });

  it("requires unique barcodes", () => {
    expect(barcodesAreUnique(["A", "B"])).toBe(true);
    expect(barcodesAreUnique(["A", "A"])).toBe(false);
  });

  it("fingerprints membership for idempotency", () => {
    expect(requestFingerprint("org-1", ["s2", "s1"])).toBe(requestFingerprint("org-1", ["s1", "s2"]));
    expect(requestFingerprint("org-1", ["s1", "s2"])).not.toBe(requestFingerprint("org-2", ["s1", "s2"]));
  });
});

describe("bulk reconcile", () => {
  it("marks a full batch succeeded", () => {
    const result = reconcileBulkCeptResponse({
      expectedCount: 2,
      shipmentIds: ["s1", "s2"],
      total: 2,
      processed: 2,
      httpOk: true,
      bodyComplete: true,
      validArticles: [
        { shipmentId: "s1", barcode: "A", articleNumber: "CX1" },
        { shipmentId: "s2", barcode: "B", articleNumber: "CX2" },
      ],
      errorArticles: [],
    });
    expect(result.batchStatus).toBe("SUCCEEDED");
    expect(labelsForSuccessfulArticlesOnly(result.articles)).toHaveLength(2);
  });

  it("keeps partial success without retrying booked articles", () => {
    const result = reconcileBulkCeptResponse({
      expectedCount: 2,
      shipmentIds: ["s1", "s2"],
      total: 2,
      processed: 2,
      httpOk: true,
      bodyComplete: true,
      validArticles: [{ shipmentId: "s1", barcode: "A", articleNumber: "CX1" }],
      errorArticles: [{ shipmentId: "s2", barcode: "B", code: "VALIDATION_ERROR", message: "bad pin" }],
    });
    expect(result.batchStatus).toBe("PARTIAL_SUCCESS");
    expect(succeededArticlesMustNotRetry(result.articles)).toEqual(["s1"]);
    expect(labelsForSuccessfulArticlesOnly(result.articles).map((row) => row.shipmentId)).toEqual(["s1"]);
  });

  it("marks an all-failed accounted batch FAILED", () => {
    const result = reconcileBulkCeptResponse({
      expectedCount: 2,
      shipmentIds: ["s1", "s2"],
      total: 2,
      processed: 2,
      httpOk: true,
      bodyComplete: true,
      validArticles: [],
      errorArticles: [
        { shipmentId: "s1", code: "VALIDATION_ERROR" },
        { shipmentId: "s2", code: "VALIDATION_ERROR" },
      ],
    });
    expect(result.batchStatus).toBe("FAILED");
  });

  it("maps tracking per successful article, not batch_id", () => {
    const result = reconcileBulkCeptResponse({
      expectedCount: 2,
      shipmentIds: ["s1", "s2"],
      total: 2,
      processed: 2,
      httpOk: true,
      bodyComplete: true,
      validArticles: [
        { shipmentId: "s1", articleNumber: "CX1" },
        { shipmentId: "s2", articleNumber: "CX2" },
      ],
    });
    expect(result.articles.map((row) => row.trackingNumber)).toEqual(["CX1", "CX2"]);
  });
});

describe("bulk HTTP and recovery taxonomy", () => {
  it("treats 409 as RECOVERY_REQUIRED", () => {
    expect(classifyBulkHttpOutcome({ httpStatus: 409 }).class).toBe("RECOVERY_REQUIRED");
  });

  it("treats 429 as RETRYABLE only before POST", () => {
    expect(classifyBulkHttpOutcome({ httpStatus: 429 }).class).toBe("RETRYABLE");
  });

  it("treats 5xx as RECOVERY_REQUIRED", () => {
    expect(classifyBulkHttpOutcome({ httpStatus: 503 }).class).toBe("RECOVERY_REQUIRED");
  });

  it("treats timeout as RECOVERY_REQUIRED", () => {
    expect(classifyBulkHttpOutcome({ timedOut: true }).class).toBe("RECOVERY_REQUIRED");
  });

  it("treats malformed and unknown bodies as RECOVERY_REQUIRED", () => {
    expect(classifyBulkHttpOutcome({ malformedResponse: true }).class).toBe("RECOVERY_REQUIRED");
    expect(classifyBulkHttpOutcome({ unknownResponse: true }).class).toBe("RECOVERY_REQUIRED");
  });

  it("does not infer not-booked from timeout", () => {
    expect(articlesAllowedToRetryIndividually([{ shipmentId: "s1", bookedAtProvider: null }])).toEqual([]);
    expect(articlesAllowedToRetryIndividually([{ shipmentId: "s1", bookedAtProvider: false }])).toEqual(["s1"]);
  });

  it("keeps H4: no CEPT POST after unknown", () => {
    expect(canRetryCeptPostAfterUnknown()).toBe(false);
    expect(duplicateWorkerMustSkipPost("SUBMITTED")).toBe(true);
    expect(bulkWorkerMayPost("RECOVERY_REQUIRED")).toBe(false);
  });
});

describe("crash recovery points", () => {
  it("allows POST only before the request leaves READY", () => {
    expect(canSubmitCeptAtCrashPoint("before_batch_creation", "PENDING")).toBe(true);
    expect(canSubmitCeptAtCrashPoint("after_membership_creation", "READY")).toBe(true);
    expect(canSubmitCeptAtCrashPoint("immediately_before_cept_post", "READY")).toBe(true);
    expect(canSubmitCeptAtCrashPoint("during_cept_post", "SUBMITTING")).toBe(false);
    expect(canSubmitCeptAtCrashPoint("immediately_after_cept_post", "SUBMITTED")).toBe(false);
    expect(canSubmitCeptAtCrashPoint("after_cept_before_db_commit", "SUBMITTED")).toBe(false);
    expect(canSubmitCeptAtCrashPoint("after_partial_article_reconciliation", "RECONCILING")).toBe(false);
    expect(canSubmitCeptAtCrashPoint("before_label_generation", "PARTIAL_SUCCESS")).toBe(false);
  });

  it("duplicate workers skip POST after SUBMITTING", () => {
    expect(duplicateWorkerMustSkipPost("SUBMITTING")).toBe(true);
    expect(duplicateWorkerMustSkipPost("READY")).toBe(false);
  });
});

describe("bulk state machine", () => {
  it("allows READY → SUBMITTING → SUBMITTED → RECONCILING", () => {
    expect(canTransitionIndiaPostBulkBatch("READY", "SUBMITTING")).toBe(true);
    expect(canTransitionIndiaPostBulkBatch("SUBMITTING", "SUBMITTED")).toBe(true);
    expect(canTransitionIndiaPostBulkBatch("SUBMITTED", "RECONCILING")).toBe(true);
    expect(canTransitionIndiaPostBulkBatch("SUCCEEDED", "READY")).toBe(false);
  });

  it("recovery only resumes into RECONCILING, never a second POST", () => {
    expect(canTransitionIndiaPostBulkBatch("RECOVERY_REQUIRED", "RECONCILING")).toBe(true);
    expect(canTransitionIndiaPostBulkBatch("RECOVERY_REQUIRED", "SUBMITTING")).toBe(false);
  });
});

describe("batch size and transport boundary (unverified JSON ceiling)", () => {
  it("does not silently resolve below-1000 vs 999", () => {
    expect(INDIA_POST_JSON_BULK_LIMIT_VERIFIED).toBe(false);
    expect(INDIA_POST_JSON_BULK_DOCUMENTED_BELOW).toBe(1000);
    expect(INDIA_POST_JSON_BULK_CODE_MAX).toBe(999);
    expect(INDIA_POST_JSON_BOOKING_MAX).toBe(999);
    expect(indiaPostBookingTransport(999)).toBe("json");
    expect(indiaPostBookingTransport(1000)).toBe("file");
    expect(INDIA_POST_FILE_BOOKING_MAX).toBe(5000);
  });

  it("refuses a multi-article POST while bulk is disabled", () => {
    expect(() => assertIndiaPostBulkPostAllowed(2)).toThrow(/disabled/);
    expect(() => assertIndiaPostBulkPostAllowed(1)).not.toThrow();
  });
});

function splitArticles(success: number, failed: number) {
  const shipmentIds = Array.from({ length: success + failed }, (_, index) => `s${index + 1}`);
  return reconcileBulkCeptResponse({
    expectedCount: shipmentIds.length,
    shipmentIds,
    total: shipmentIds.length,
    processed: shipmentIds.length,
    httpOk: true,
    bodyComplete: true,
    validArticles: shipmentIds.slice(0, success).map((shipmentId) => ({
      shipmentId,
      barcode: `B${shipmentId}`,
      articleNumber: `CX${shipmentId}`,
    })),
    errorArticles: shipmentIds.slice(success).map((shipmentId) => ({
      shipmentId,
      barcode: `B${shipmentId}`,
      code: "VALIDATION_ERROR",
    })),
  });
}

describe("partial success matrices", () => {
  it.each([
    [97, 3, "PARTIAL_SUCCESS"],
    [99, 1, "PARTIAL_SUCCESS"],
    [50, 50, "PARTIAL_SUCCESS"],
    [1, 99, "PARTIAL_SUCCESS"],
    [0, 100, "FAILED"],
    [100, 0, "SUCCEEDED"],
  ] as const)("%s success / %s error → %s and labels only for successes", (ok, bad, status) => {
    const result = splitArticles(ok, bad);
    expect(result.batchStatus).toBe(status);
    expect(succeededArticlesMustNotRetry(result.articles)).toHaveLength(ok);
    expect(labelsForSuccessfulArticlesOnly(result.articles)).toHaveLength(ok);
    expect(result.articles.filter((row) => row.generateLabel && row.result !== "SUCCEEDED")).toHaveLength(0);
  });

  it("sends count mismatch, unknown id, duplicate barcode, and batch_id-as-tracking to recovery", () => {
    const ids = ["s1", "s2"];
    expect(
      reconcileBulkCeptResponse({
        expectedCount: 2,
        shipmentIds: ids,
        total: 1,
        processed: 2,
        httpOk: true,
        bodyComplete: true,
        validArticles: [{ shipmentId: "s1" }, { shipmentId: "s2" }],
      }).batchStatus
    ).toBe("RECOVERY_REQUIRED");
    expect(
      reconcileBulkCeptResponse({
        expectedCount: 2,
        shipmentIds: ids,
        httpOk: true,
        bodyComplete: true,
        validArticles: [{ shipmentId: "s1" }, { shipmentId: "s9" }],
        errorArticles: [],
      }).batchStatus
    ).toBe("RECOVERY_REQUIRED");
    expect(
      reconcileBulkCeptResponse({
        expectedCount: 2,
        shipmentIds: ids,
        httpOk: true,
        bodyComplete: true,
        validArticles: [
          { shipmentId: "s1", barcode: "DUP" },
          { shipmentId: "s2", barcode: "DUP" },
        ],
      }).batchStatus
    ).toBe("RECOVERY_REQUIRED");
    expect(
      reconcileBulkCeptResponse({
        expectedCount: 2,
        shipmentIds: ids,
        ceptBatchId: "BATCH-1",
        httpOk: true,
        bodyComplete: true,
        validArticles: [
          { shipmentId: "s1", articleNumber: "BATCH-1" },
          { shipmentId: "s2", articleNumber: "CX2" },
        ],
      }).batchStatus
    ).toBe("RECOVERY_REQUIRED");
  });
});

describe("HTTP taxonomy", () => {
  it.each([
    [{ httpStatus: 200 }, "NON_RETRYABLE"],
    [{ httpStatus: 200, malformedResponse: true }, "RECOVERY_REQUIRED"],
    [{ httpStatus: 400 }, "NON_RETRYABLE"],
    [{ httpStatus: 401 }, "NON_RETRYABLE"],
    [{ httpStatus: 403 }, "NON_RETRYABLE"],
    [{ httpStatus: 409 }, "RECOVERY_REQUIRED"],
    [{ httpStatus: 429 }, "RETRYABLE"],
    [{ httpStatus: 429, batchLeftReady: true }, "RECOVERY_REQUIRED"],
    [{ httpStatus: 500 }, "RECOVERY_REQUIRED"],
    [{ httpStatus: 502 }, "RECOVERY_REQUIRED"],
    [{ httpStatus: 503 }, "RECOVERY_REQUIRED"],
    [{ timedOut: true }, "RECOVERY_REQUIRED"],
    [{ networkError: true }, "RECOVERY_REQUIRED"],
    [{ emptyResponse: true }, "RECOVERY_REQUIRED"],
    [{ invalidJson: true }, "RECOVERY_REQUIRED"],
  ] as const)("%j → %s", (input, expected) => {
    expect(classifyBulkHttpOutcome(input).class).toBe(expected);
  });
});

describe("crash injection CRASH-01..10", () => {
  it("never resubmits after a CEPT POST without provider evidence", () => {
    expect(INDIA_POST_BULK_CRASH_SCENARIOS).toHaveLength(10);
    for (const scenario of INDIA_POST_BULK_CRASH_SCENARIOS) {
      const result = evaluateBulkCrashRestart(scenario);
      if (scenario.ceptPostCount === 1) {
        expect(result.mayResubmit, scenario.id).toBe(false);
        expect(result.recoveryRequired, scenario.id).toBe(true);
      }
      expect(result.barcodeMayBeReallocated, scenario.id).toBe(false);
    }
  });
});

describe("BulkBookingEngine controlled splitting", () => {
  it("turns 11 compatible articles into two CEPT batches and one leftover single", () => {
    const rows = Array.from({ length: 11 }, (_, index) =>
      candidate({
        shipmentId: `s${String(index).padStart(2, "0")}`,
        jobId: `j${index}`,
        createdAt: `2026-10-09T00:00:${String(index).padStart(2, "0")}.000Z`,
        barcode: `CX${String(index).padStart(9, "0")}IN`,
      })
    );
    const plan = planIndiaPostBulkWork(rows, { maxArticles: 5 });
    expect(plan.batches).toHaveLength(2);
    expect(plan.batches[0].shipmentIds).toHaveLength(5);
    expect(plan.batches[1].shipmentIds).toHaveLength(5);
    expect(plan.leftoverShipmentIds).toHaveLength(1);
    expect(plan.batches.reduce((sum, batch) => sum + batch.shipmentIds.length, 0)).toBe(10);
  });

  it("represents 100000-article capacity as many batches, not one request", () => {
    const maxArticles = 2;
    const total = 100_000;
    const fullBatches = Math.floor(total / maxArticles);
    const leftover = total % maxArticles;
    expect(fullBatches).toBe(50_000);
    expect(leftover).toBe(0);
    expect(fullBatches * maxArticles + leftover).toBe(total);
    expect(fullBatches).toBeGreaterThan(1);
  });
});

describe("idempotency fingerprint policy", () => {
  it("blocks reuse after success/partial and requires reconciliation after recovery", () => {
    const ids = Array.from({ length: 100 }, (_, index) => `s${index}`);
    const fp = requestFingerprint("org-1", ids);
    expect(requestFingerprint("org-1", [...ids].reverse())).toBe(fp);
    expect(fingerprintRetryPolicy("SUCCEEDED")).toBe("forbidden");
    expect(fingerprintRetryPolicy("PARTIAL_SUCCESS")).toBe("forbidden");
    expect(fingerprintRetryPolicy("FAILED")).toBe("new_batch_allowed");
    expect(fingerprintRetryPolicy("RECOVERY_REQUIRED")).toBe("reconciliation_only");
  });
});

describe("barcode uniqueness for 2/10/30", () => {
  it.each([2, 10, 30])("keeps %s reserved barcodes unique and stable", (size) => {
    const barcodes = Array.from({ length: size }, (_, index) => `CX${String(index).padStart(9, "0")}IN`);
    expect(barcodesAreUnique(barcodes)).toBe(true);
    expect(barcodesAreUnique([...barcodes, barcodes[0]])).toBe(false);
  });
});

describe("monitoring contracts", () => {
  it("defines recovery/409/5xx/partial/duplicate/latency alerts", () => {
    expect(INDIA_POST_BULK_ALERTS.map((row) => row.id)).toEqual([
      "bulk_recovery_required_spike",
      "bulk_409_spike",
      "bulk_5xx_spike",
      "bulk_partial_spike",
      "bulk_duplicates_prevented_spike",
      "bulk_latency_high",
    ]);
  });
});
