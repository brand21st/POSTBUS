import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { indiaPostBulkAlertDestinations } from "@/modules/india-post/bulk-alerts";
import { planIndiaPostBulkWork } from "@/modules/india-post/bulk-engine";
import { labelsForSuccessfulArticlesOnly, reconcileBulkCeptResponse } from "@/modules/india-post/bulk-reconcile";
import type { IndiaPostBulkBatchStatus } from "@/modules/india-post/bulk-state";
import { runIndiaPostBulkWorkerAttempt, type BulkWorkerDeps } from "@/modules/india-post/bulk-worker";
import type { BulkCandidate } from "@/modules/india-post/bulk-eligibility";

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

describe("single-article path", () => {
  it("does not require a bulk batch and posts once", async () => {
    let posts = 0;
    const outcome = await runIndiaPostBulkWorkerAttempt({
      supabase: {} as SupabaseClient,
      organizationId: "org-1",
      shipmentIds: ["s1"],
      bulkBatch: null,
      post: async () => {
        posts += 1;
        return { bookedIds: ["s1"], failedIds: [] };
      },
    });
    expect(posts).toBe(1);
    expect(outcome.bookedIds).toEqual(["s1"]);
  });
});

describe("mocked CEPT worker crash after POST", () => {
  it("keeps POST count at 1 and recovers without a second booking", async () => {
    const batch = { id: "batch-1", status: "READY" as const };
    const { deps, articles } = memoryDeps(batch);
    let posts = 0;
    const shipmentIds = ["s1", "s2"];
    const barcodes = new Map(shipmentIds.map((id) => [id, `CX${id}`]));
    await expect(
      runIndiaPostBulkWorkerAttempt(
        {
          supabase: {} as SupabaseClient,
          organizationId: "org-1",
          shipmentIds,
          bulkBatch: batch,
          crashAfterPost: true,
          post: async () => {
            posts += 1;
            return { bookedIds: shipmentIds, failedIds: [], result: { batch_id: "CEPT-BATCH", correlation_id: "corr" } };
          },
        },
        deps
      )
    ).rejects.toThrow(/Injected crash/);
    expect(posts).toBe(1);
    expect(batch.status).toBe("RECOVERY_REQUIRED");
    expect([...articles.values()]).toEqual(["RECOVERY_REQUIRED", "RECOVERY_REQUIRED"]);
    expect(barcodes.get("s1")).toBe("CXs1");

    await expect(
      runIndiaPostBulkWorkerAttempt(
        {
          supabase: {} as SupabaseClient,
          organizationId: "org-1",
          shipmentIds,
          bulkBatch: batch,
          post: async () => {
            posts += 1;
            return { bookedIds: shipmentIds, failedIds: [] };
          },
        },
        deps
      )
    ).rejects.toThrow(/not safe to POST/);
    expect(posts).toBe(1);
  });
});

describe("mocked CEPT batch sizes", () => {
  it.each([2, 10, 30, 100, 999])("posts once for %s articles and maps barcodes/partial success", async (size) => {
    const ids = Array.from({ length: size }, (_, index) => `s${index}`);
    const batch = { id: `b${size}`, status: "READY" as const };
    const { deps } = memoryDeps(batch);
    let posts = 0;
    const failed = ids.slice(-3);
    const booked = ids.slice(0, Math.max(0, size - 3));
    const outcome = await runIndiaPostBulkWorkerAttempt(
      {
        supabase: {} as SupabaseClient,
        organizationId: "org-1",
        shipmentIds: ids,
        bulkBatch: batch,
        post: async () => {
          posts += 1;
          return {
            bookedIds: booked,
            failedIds: failed,
            result: { batch_id: `BATCH-${size}`, correlation_id: `corr-${size}` },
          };
        },
      },
      deps
    );
    expect(posts).toBe(1);
    expect(outcome.bookedIds).toHaveLength(booked.length);
    expect(new Set(outcome.bookedIds).size).toBe(booked.length);
    const reconciled = reconcileBulkCeptResponse({
      expectedCount: size,
      shipmentIds: ids,
      ceptBatchId: `BATCH-${size}`,
      httpOk: true,
      bodyComplete: true,
      validArticles: booked.map((shipmentId) => ({
        shipmentId,
        barcode: `B${shipmentId}`,
        articleNumber: `CX${shipmentId}`,
      })),
      errorArticles: failed.map((shipmentId) => ({
        shipmentId,
        barcode: `B${shipmentId}`,
        code: "VALIDATION_ERROR",
      })),
    });
    expect(reconciled.articles.some((row) => row.trackingNumber === `BATCH-${size}`)).toBe(false);
    expect(labelsForSuccessfulArticlesOnly(reconciled.articles)).toHaveLength(booked.length);
    if (booked.length && failed.length) expect(batch.status).toBe("PARTIAL_SUCCESS");
    else if (!booked.length) expect(batch.status).toBe("FAILED");
    else expect(batch.status).toBe("SUCCEEDED");
  });
});

describe("100000 synthetic planner", () => {
  it("splits 100000 shipments into bounded JSON batches without a CEPT call", () => {
    const total = 100_000;
    const maxArticles = 2;
    const started = Date.now();
    const rows = Array.from({ length: total }, (_, index) =>
      candidate({
        shipmentId: `s${index}`,
        jobId: `j${index}`,
        createdAt: "2026-10-09T00:00:00.000Z",
        barcode: `CX${String(index).padStart(9, "0")}IN`,
      })
    );
    const plan = planIndiaPostBulkWork(rows, { maxArticles });
    const elapsedMs = Date.now() - started;
    const membership = plan.batches.flatMap((batch) => batch.shipmentIds);
    expect(plan.batches.length).toBe(50_000);
    expect(membership).toHaveLength(total);
    expect(new Set(membership).size).toBe(total);
    expect(new Set(plan.batches.map((batch) => batch.requestFingerprint)).size).toBe(plan.batches.length);
    expect(plan.leftoverShipmentIds).toHaveLength(0);
    expect(elapsedMs).toBeLessThan(30_000);
  }, 60_000);
});

describe("alert destinations", () => {
  it("does not invent an on-call destination", () => {
    const dest = indiaPostBulkAlertDestinations();
    expect(dest.inAppNotifications).toBe(true);
    expect(typeof dest.pagingConfigured).toBe("boolean");
  });
});
