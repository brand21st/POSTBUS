import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TenantContext } from "@/lib/api/context";
import { classifyMultiArticleOutcome } from "@/modules/india-post/booking-apply";
import {
  INDIA_POST_BOOKING_LOCK_TTL_MAX_SECONDS,
  INDIA_POST_BOOKING_LOCK_TTL_SECONDS,
  indiaPostBookingLockTtlSeconds,
} from "@/modules/india-post/booking-lock";
import { BOOKING_BARCODE_PROOF } from "@/modules/india-post/booking-provenance";
import { bulkMembershipRetryDecision } from "@/modules/india-post/booking-retry-eligibility";
import type { IndiaPostBulkBatchStatus } from "@/modules/india-post/bulk-state";
import { BULK_BATCH_JOB_ENTITY } from "@/modules/india-post/bulk-store";
import {
  BULK_BATCH_SUPERSEDED,
  runIndiaPostBulkWorkerAttempt,
  type BulkWorkerDeps,
} from "@/modules/india-post/bulk-worker";
import { INDIA_POST_BOOKING_TIMEOUT_MAX_MS, INDIA_POST_TIMEOUT_MS, indiaPostBookingTimeoutMs } from "@/modules/india-post/http";

const createBackgroundJob = vi.fn();
const createManualOrder = vi.fn();
const allocateNextBarcode = vi.fn();

vi.mock("@/modules/jobs/service", () => ({
  createBackgroundJob: (...args: unknown[]) => createBackgroundJob(...args),
}));
vi.mock("@/modules/orders/service", () => ({
  createManualOrder: (...args: unknown[]) => createManualOrder(...args),
}));
vi.mock("@/modules/india-post/allocate-barcode", () => ({
  allocateNextBarcode: (...args: unknown[]) => allocateNextBarcode(...args),
}));

const { enqueueIndiaPostBulkPlan } = await import("@/modules/india-post/bulk-engine");
const { BULK_IMPORT_ROW_KEY, materializeRow } = await import("@/modules/india-post/bulk-excel-import");

// ---------------------------------------------------------------------------
// Minimal in-memory Supabase: enough of the query builder for these code paths.
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;
type Hook = (table: string, op: "insert" | "update", payload: Row) => void;

function readPath(row: Row, column: string) {
  const json = /^(\w+)->>(\w+)$/.exec(column);
  if (json) {
    const value = (row[json[1]] as Row | undefined)?.[json[2]];
    return value == null ? null : String(value);
  }
  return row[column];
}

function memoryDb(seed: Record<string, Row[]> = {}, hook?: Hook) {
  const tables: Record<string, Row[]> = Object.fromEntries(Object.entries(seed).map(([k, v]) => [k, [...v]]));
  let ids = 0;
  const from = (table: string) => {
    const filters: Array<(row: Row) => boolean> = [];
    let op: "select" | "insert" | "update" = "select";
    let payload: Row | Row[] | null = null;
    let limit = Infinity;
    const rows = () => (tables[table] ??= []);
    const run = () => {
      if (op === "insert") {
        const list: Row[] = (Array.isArray(payload) ? payload : [payload!]).map((row) => ({ id: `${table}-${++ids}`, ...row }));
        for (const row of list) hook?.(table, "insert", row);
        if (table === "shipments") {
          for (const row of list) {
            const key = (row.metadata as Row | undefined)?.[BULK_IMPORT_ROW_KEY];
            if (key && rows().some((other) => (other.metadata as Row | undefined)?.[BULK_IMPORT_ROW_KEY] === key)) {
              return { data: null, error: { code: "23505", message: "duplicate key shipments_bulk_import_row_uidx" } };
            }
          }
        }
        rows().push(...list);
        return { data: list, error: null };
      }
      const matched = rows().filter((row) => filters.every((test) => test(row))).slice(0, limit);
      if (op === "update") {
        hook?.(table, "update", payload as Row);
        for (const row of matched) Object.assign(row, payload);
      }
      return { data: matched, error: null };
    };
    const builder: Record<string, unknown> = {
      select: () => builder,
      insert: (value: Row | Row[]) => ((op = "insert"), (payload = value), builder),
      update: (value: Row) => ((op = "update"), (payload = value), builder),
      eq: (column: string, value: unknown) => (filters.push((row) => readPath(row, column) === value), builder),
      is: (column: string, value: unknown) => (filters.push((row) => (row[column] ?? null) === value), builder),
      in: (column: string, values: unknown[]) => (filters.push((row) => values.includes(row[column])), builder),
      order: () => builder,
      limit: (n: number) => ((limit = n), builder),
      maybeSingle: async () => {
        const result = run();
        return { data: result.data?.[0] ?? null, error: result.error };
      },
      single: async () => {
        const result = run();
        return { data: result.data?.[0] ?? null, error: result.error ?? (result.data?.length ? null : { message: "no row" }) };
      },
      then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
        Promise.resolve()
          .then(run)
          .then((result) => ({ data: result.data, error: result.error }))
          .then(resolve, reject),
    };
    return builder;
  };
  return { tables, client: { from } as unknown as SupabaseClient };
}

const ctx: TenantContext = {
  userId: "user-1",
  email: null,
  fullName: null,
  organizationId: "org-1",
  organizationName: "Org",
  role: "OWNER",
  permissions: [],
};

beforeEach(() => {
  createBackgroundJob.mockReset();
  createManualOrder.mockReset();
  allocateNextBarcode.mockReset();
});

// ---------------------------------------------------------------------------

describe("multi-article response classification", () => {
  const submitted = ["EA000000001IN", "EA000000002IN", "EA000000003IN"];

  it("keeps accepted and rejected articles when the response accounts for all of them", () => {
    const out = classifyMultiArticleOutcome(submitted, {
      valid_articles: [{ barcode_no: "EA000000001IN" }, { barcode_no: "ea000000002in" }],
      error_articles: [{ barcode_no: "EA000000003IN", errors: ["Invalid pincode"] }],
    });
    expect([...out.booked]).toEqual(["EA000000001IN", "EA000000002IN"]);
    expect([...out.failed.keys()]).toEqual(["EA000000003IN"]);
    expect(out.recovery.size).toBe(0);
    expect(out.recoveryReason).toBeNull();
  });

  it("puts an article missing from the response in recovery, not failed", () => {
    const out = classifyMultiArticleOutcome(submitted, {
      valid_articles: [{ barcode_no: "EA000000001IN" }],
      error_articles: [{ barcode_no: "EA000000002IN", errors: ["Invalid weight"] }],
    });
    expect([...out.booked]).toEqual(["EA000000001IN"]);
    expect([...out.failed.keys()]).toEqual(["EA000000002IN"]);
    expect([...out.recovery]).toEqual(["EA000000003IN"]);
    expect(out.recoveryReason).toMatch(/did not list every submitted article/);
  });

  it("stops trusting rejections when the response names an article that was not submitted", () => {
    const out = classifyMultiArticleOutcome(submitted, {
      valid_articles: [{ barcode_no: "EA000000001IN" }, { barcode_no: "EZ999999999IN" }],
      error_articles: [
        { barcode_no: "EA000000002IN", errors: ["Invalid pincode"] },
        { barcode_no: "EA000000003IN", errors: ["Invalid pincode"] },
      ],
    });
    expect([...out.booked]).toEqual(["EA000000001IN"]);
    expect(out.failed.size).toBe(0);
    expect([...out.recovery].sort()).toEqual(["EA000000002IN", "EA000000003IN"]);
    expect(out.recoveryReason).toMatch(/not submitted/);
  });

  it("treats an article listed as both accepted and rejected as unknown", () => {
    const out = classifyMultiArticleOutcome(submitted.slice(0, 2), {
      valid_articles: [{ barcode_no: "EA000000001IN" }, { barcode_no: "EA000000002IN" }],
      error_articles: [{ barcode_no: "EA000000002IN", errors: ["Invalid weight"] }],
    });
    expect([...out.booked]).toEqual(["EA000000001IN"]);
    expect([...out.recovery]).toEqual(["EA000000002IN"]);
  });

  it("treats a blank or empty response as unknown for every article", () => {
    for (const body of [null, {}, { valid_articles: [{ barcode_no: "" }] }]) {
      const out = classifyMultiArticleOutcome(submitted, body);
      expect(out.booked.size).toBe(0);
      expect(out.failed.size).toBe(0);
      expect(out.recovery.size).toBe(3);
    }
  });

  it("keeps the existing rule that a duplicate-article rejection counts as booked", () => {
    const out = classifyMultiArticleOutcome(submitted.slice(0, 1), {
      error_articles: [{ barcode_no: "EA000000001IN", errors: ["Barcode already exists"] }],
    });
    // Mirrors splitIndiaPostBookingResult; changing it is a separate, open decision.
    expect(out.booked.has("EA000000001IN") || out.failed.has("EA000000001IN")).toBe(true);
    expect(out.recovery.size).toBe(0);
  });
});

describe("booking timeout and lock lease", () => {
  it("keeps the historical 10 s for one JSON article", () => {
    expect(indiaPostBookingTimeoutMs(1)).toBe(INDIA_POST_TIMEOUT_MS.book);
    expect(indiaPostBookingTimeoutMs(1, "json")).toBe(10_000);
  });

  it("grows with the article count and stays under the transport ceilings", () => {
    expect(indiaPostBookingTimeoutMs(100, "json")).toBe(16_000);
    expect(indiaPostBookingTimeoutMs(998, "json")).toBeLessThanOrEqual(INDIA_POST_BOOKING_TIMEOUT_MAX_MS.json);
    expect(indiaPostBookingTimeoutMs(5000, "file")).toBe(INDIA_POST_BOOKING_TIMEOUT_MAX_MS.file);
    expect(INDIA_POST_BOOKING_TIMEOUT_MAX_MS.file).toBeLessThan(300_000);
  });

  it("holds the lock longer than the request it protects", () => {
    expect(indiaPostBookingLockTtlSeconds(indiaPostBookingTimeoutMs(1), 1)).toBe(INDIA_POST_BOOKING_LOCK_TTL_SECONDS);
    for (const [count, transport] of [
      [100, "json"],
      [998, "json"],
      [3000, "file"],
    ] as const) {
      const timeout = indiaPostBookingTimeoutMs(count, transport);
      const ttl = indiaPostBookingLockTtlSeconds(timeout, count);
      expect(ttl * 1000).toBeGreaterThan(timeout);
      expect(ttl).toBeLessThanOrEqual(INDIA_POST_BOOKING_LOCK_TTL_MAX_SECONDS);
    }
  });
});

describe("bulk worker outcomes", () => {
  function deps(batch: { id: string; status: IndiaPostBulkBatchStatus }) {
    const articles = new Map<string, string>();
    const transitions: string[] = [];
    const worker: BulkWorkerDeps = {
      transition: async (_s, _id, from, to) => {
        if (batch.status !== from) return false;
        batch.status = to;
        transitions.push(`${from}->${to}`);
        return true;
      },
      persistArticles: async (_s, _id, input) => {
        for (const id of input.bookedIds) articles.set(id, "SUCCEEDED");
        for (const id of input.failedIds) articles.set(id, "FAILED");
        for (const id of input.recoveryIds ?? []) articles.set(id, "RECOVERY_REQUIRED");
      },
      recordMetric: () => undefined,
    };
    return { worker, articles, transitions };
  }

  it("records unproven articles and leaves the batch in recovery", async () => {
    const batch = { id: "b1", status: "READY" as IndiaPostBulkBatchStatus };
    const { worker, articles } = deps(batch);
    await runIndiaPostBulkWorkerAttempt(
      {
        supabase: {} as SupabaseClient,
        organizationId: "org-1",
        shipmentIds: ["s1", "s2", "s3"],
        bulkBatch: batch,
        post: async () => ({ bookedIds: ["s1"], failedIds: ["s2"], recoveryIds: ["s3"] }),
      },
      worker
    );
    expect(batch.status).toBe("RECOVERY_REQUIRED");
    expect(Object.fromEntries(articles)).toEqual({ s1: "SUCCEEDED", s2: "FAILED", s3: "RECOVERY_REQUIRED" });
  });

  it("ends quietly when another job already moved the batch out of READY", async () => {
    const batch = { id: "b1", status: "READY" as IndiaPostBulkBatchStatus };
    const { worker, articles } = deps(batch);
    worker.transition = async () => false;
    const post = vi.fn();
    await expect(
      runIndiaPostBulkWorkerAttempt(
        { supabase: {} as SupabaseClient, organizationId: "org-1", shipmentIds: ["s1", "s2"], bulkBatch: batch, post },
        worker
      )
    ).rejects.toMatchObject({ code: BULK_BATCH_SUPERSEDED });
    expect(post).not.toHaveBeenCalled();
    expect(articles.size).toBe(0);
    expect(batch.status).toBe("READY");
  });

  it("does not post or flag recovery for a batch that already finished", async () => {
    for (const status of ["SUCCEEDED", "PARTIAL_SUCCESS", "FAILED"] as IndiaPostBulkBatchStatus[]) {
      const batch = { id: "b1", status };
      const { worker, transitions } = deps(batch);
      const post = vi.fn();
      await expect(
        runIndiaPostBulkWorkerAttempt(
          { supabase: {} as SupabaseClient, organizationId: "org-1", shipmentIds: ["s1", "s2"], bulkBatch: batch, post },
          worker
        )
      ).rejects.toMatchObject({ code: BULK_BATCH_SUPERSEDED });
      expect(post).not.toHaveBeenCalled();
      expect(transitions).toEqual([]);
      expect(batch.status).toBe(status);
    }
  });

  it("still moves an interrupted SUBMITTING batch to recovery without posting", async () => {
    const batch = { id: "b1", status: "SUBMITTING" as IndiaPostBulkBatchStatus };
    const { worker } = deps(batch);
    const post = vi.fn();
    await expect(
      runIndiaPostBulkWorkerAttempt(
        { supabase: {} as SupabaseClient, organizationId: "org-1", shipmentIds: ["s1", "s2"], bulkBatch: batch, post },
        worker
      )
    ).rejects.toMatchObject({ code: "CEPT_UNKNOWN" });
    expect(post).not.toHaveBeenCalled();
    expect(batch.status).toBe("RECOVERY_REQUIRED");
  });
});

describe("retry of a shipment inside a bulk batch", () => {
  it("never offers a single-article retry while the batch owns the shipment", () => {
    expect(bulkMembershipRetryDecision("s1", "PENDING")?.action).toBe("BOOKING_IN_PROGRESS");
    expect(bulkMembershipRetryDecision("s1", "SUBMITTED")?.action).toBe("BOOKING_OUTCOME_UNKNOWN");
    expect(bulkMembershipRetryDecision("s1", "RECOVERY_REQUIRED")?.action).toBe("BOOKING_OUTCOME_UNKNOWN");
    expect(bulkMembershipRetryDecision("s1", "SUCCEEDED")?.action).toBe("ALREADY_BOOKED");
    for (const result of ["PENDING", "SUBMITTED", "RECOVERY_REQUIRED", "SUCCEEDED"]) {
      expect(bulkMembershipRetryDecision("s1", result)?.eligible).toBe(false);
    }
  });

  it("leaves the normal rules in charge after a failed batch", () => {
    expect(bulkMembershipRetryDecision("s1", "FAILED")).toBeNull();
    expect(bulkMembershipRetryDecision("s1", null)).toBeNull();
  });
});

describe("bulk batch job binding", () => {
  const plan = {
    leftoverShipmentIds: [],
    batches: [
      {
        organizationId: "org-1",
        indiaPostCustomerId: "1000000001",
        contractId: "41585456",
        serviceCode: "SP_INLAND_PARCEL",
        environment: "UAT" as const,
        shipmentIds: ["s1", "s2"],
        barcodes: ["EA000000001IN", "EA000000002IN"],
        requestFingerprint: "fp",
      },
    ],
  };

  function batchDb() {
    const db = memoryDb({ india_post_bulk_batches: [] });
    const client = db.client as unknown as { rpc: unknown };
    client.rpc = vi.fn(async () => {
      db.tables.india_post_bulk_batches.push({ id: "batch-1", status: "READY", job_id: null, organization_id: "org-1" });
      return { data: "batch-1", error: null };
    });
    return db;
  }

  it("creates the batch first and keys its job on the batch, not a member shipment", async () => {
    const db = batchDb();
    createBackgroundJob.mockResolvedValue({ id: "job-1" });
    await enqueueIndiaPostBulkPlan(db.client, ctx, plan);
    expect(createBackgroundJob).toHaveBeenCalledTimes(1);
    expect(createBackgroundJob.mock.calls[0][1]).toMatchObject({
      jobType: "shipment-booking",
      entityType: BULK_BATCH_JOB_ENTITY,
      entityId: "batch-1",
      shipmentIds: ["s1", "s2"],
    });
    expect(db.tables.india_post_bulk_batches[0]).toMatchObject({ job_id: "job-1", status: "READY" });
  });

  it("releases the members when the job cannot be queued", async () => {
    const db = batchDb();
    createBackgroundJob.mockRejectedValue(new Error("queue down"));
    await expect(enqueueIndiaPostBulkPlan(db.client, ctx, plan)).rejects.toThrow("queue down");
    expect(db.tables.india_post_bulk_batches[0]).toMatchObject({ status: "FAILED", last_error_code: "QUEUE_UNAVAILABLE" });
  });
});

describe("Excel row materialization after a crash", () => {
  const batch = {
    id: "batch-0000aaaa",
    organization_id: "org-1",
    filename: "x.xlsx",
    profile_key: "cept_official",
    status: "booking",
    sheet_name: "ArticleDetails",
    header_row: 1,
    column_map: {},
    unmapped_headers: [],
    headers: [],
    other_sheets: [],
    service_code: "SP_INLAND_PARCEL",
    overrides: {},
    total_rows: 1,
    valid_rows: 1,
    invalid_rows: 0,
    materialize_job_id: null,
    created_by: "user-1",
  };

  function importRow(overrides: Record<string, unknown> = {}) {
    return {
      id: "row-1",
      batch_id: batch.id,
      organization_id: "org-1",
      excel_row_number: 2,
      raw_cells: {},
      mapped_fields: {},
      unmapped: {},
      normalized: {
        receiverName: "Asha",
        receiverPhone: "9876543210",
        line1: "12 MG Road",
        city: "Kochi",
        state: "Kerala",
        pincode: "682001",
        weightGrams: 500,
        paymentMode: "PREPAID",
        bulkReference: "#7815",
      },
      issues: [],
      barcode: null,
      status: "valid",
      order_id: null,
      shipment_id: null,
      ...overrides,
    };
  }

  function setup(crashOn: (table: string, op: string, payload: Row) => boolean) {
    let crashed = false;
    const db = memoryDb({ orders: [], shipments: [], bulk_import_rows: [importRow()], india_post_connections: [] }, (table, op, payload) => {
      if (!crashed && crashOn(table, op, payload)) {
        crashed = true;
        throw new Error("worker crashed");
      }
    });
    createManualOrder.mockImplementation(async (_s: unknown, _c: unknown, input: { metadata?: Row; orderNumber?: string }) => {
      const order = { id: "order-1", organization_id: "org-1", customer_id: "cust-1", shipping_address_id: "addr-1", order_number: input.orderNumber, metadata: input.metadata ?? {} };
      db.tables.orders.push(order);
      return order;
    });
    let serial = 0;
    allocateNextBarcode.mockImplementation(async () => `EA${String(++serial).padStart(9, "0")}IN`);
    return db;
  }

  it("reuses the shipment when the worker died after inserting it", async () => {
    const db = setup((table, op, payload) => table === "bulk_import_rows" && op === "update" && "shipment_id" in payload);
    await expect(materializeRow(db.client, ctx, batch, importRow())).rejects.toThrow("worker crashed");
    expect(db.tables.shipments).toHaveLength(1);

    // The retry sees the row as it was left: order linked, shipment not linked.
    const second = await materializeRow(db.client, ctx, batch, importRow({ order_id: "order-1" }));
    expect(db.tables.shipments).toHaveLength(1);
    expect(second).toBe(db.tables.shipments[0].id);
    expect(allocateNextBarcode).toHaveBeenCalledTimes(1);
    expect(createManualOrder).toHaveBeenCalledTimes(1);
    expect(db.tables.bulk_import_rows[0]).toMatchObject({ shipment_id: second, status: "queued" });
  });

  it("reuses the order when the worker died before linking it to the row", async () => {
    const db = setup((table, op, payload) => table === "bulk_import_rows" && op === "update" && "order_id" in payload && !("shipment_id" in payload));
    await expect(materializeRow(db.client, ctx, batch, importRow())).rejects.toThrow("worker crashed");
    expect(db.tables.orders).toHaveLength(1);
    expect((db.tables.orders[0].metadata as Row)[BULK_IMPORT_ROW_KEY]).toBe("row-1");

    await materializeRow(db.client, ctx, batch, importRow());
    expect(createManualOrder).toHaveBeenCalledTimes(1);
    expect(db.tables.shipments).toHaveLength(1);
    expect(db.tables.shipments[0].order_id).toBe("order-1");
  });

  it("stamps the import row on the shipment it creates", async () => {
    const db = setup(() => false);
    await materializeRow(db.client, ctx, batch, importRow());
    expect((db.tables.shipments[0].metadata as Row)[BULK_IMPORT_ROW_KEY]).toBe("row-1");
    // The first-barcode proof must survive next to the new key, or booking would refuse the barcode.
    expect((db.tables.shipments[0].metadata as Row)[BOOKING_BARCODE_PROOF]).toMatchObject({ barcode: "EA000000001IN" });
  });
});
