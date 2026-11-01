import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TenantContext } from "@/lib/api/context";
import { permissionForTenantRoute } from "@/lib/api/v1-permissions";

const adminRpc = vi.fn();
const adminRows: Record<string, Array<Record<string, unknown>>> = {};
const startQueuedBookingJobs = vi.fn(async () => ({ claimed: 0, succeeded: 0, failed: 0 }));
const checkQuota = vi.fn(async () => undefined);
const validateOrdersForBooking = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  hasAdminClient: () => true,
  createAdminClient: () => ({ rpc: adminRpc, from: (table: string) => memory(adminRows, table) }),
}));
vi.mock("@/lib/env", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/env")>()),
  usesDatabaseJobRunner: () => true,
}));
vi.mock("@/lib/jobs/drain", () => ({
  claimedJobFromRow: (row: unknown) => row,
  startQueuedBookingJobs: (...args: unknown[]) => startQueuedBookingJobs(...(args as [])),
}));
vi.mock("@/modules/billing/usage", () => ({ checkQuota: (...args: unknown[]) => checkQuota(...(args as [])) }));
vi.mock("@/modules/india-post/bulk-booking", () => ({
  validateOrdersForBooking: (...args: unknown[]) => validateOrdersForBooking(...args),
}));
vi.mock("@/modules/shipments/service", () => ({ createShipmentsForOrders: vi.fn() }));

const { approveAllWaiting, approveItems, dispatchItems, excludeItems, revalidateItems } = await import(
  "@/modules/booking-queue/actions"
);
const { queueMirrorTarget, rollUpRun, syncQueueWithShipments } = await import("@/modules/booking-queue/service");
const { dispatchMessage, queueActionMessage, newIdempotencyKey, TYPED_CONFIRM_THRESHOLD } = await import(
  "@/components/booking-queue/queue-actions"
);

// ---------------------------------------------------------------------------
// In-memory query builder: eq / in / select / update / insert / count / maybeSingle.
// ---------------------------------------------------------------------------
type Row = Record<string, unknown>;

function memory(tables: Record<string, Row[]>, table: string) {
  const filters: Array<(row: Row) => boolean> = [];
  let op: "select" | "update" | "insert" = "select";
  let payload: Row | null = null;
  let head = false;
  const rows = () => (tables[table] ??= []);
  const run = () => {
    if (op === "insert") {
      rows().push({ ...payload! });
      return { data: [payload], error: null, count: null };
    }
    const matched = rows().filter((row) => filters.every((test) => test(row)));
    if (op === "update") for (const row of matched) Object.assign(row, payload);
    return { data: head ? null : matched, error: null, count: matched.length };
  };
  const builder: Record<string, unknown> = {
    select: (_columns?: string, options?: { head?: boolean }) => ((head = Boolean(options?.head)), builder),
    update: (value: Row) => ((op = "update"), (payload = value), builder),
    insert: (value: Row) => ((op = "insert"), (payload = value), builder),
    eq: (column: string, value: unknown) => (filters.push((row) => row[column] === value), builder),
    in: (column: string, values: unknown[]) => (filters.push((row) => values.includes(row[column])), builder),
    order: () => builder,
    limit: () => builder,
    maybeSingle: async () => {
      const result = run();
      return { data: result.data?.[0] ?? null, error: null };
    },
    then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve().then(run).then(resolve, reject),
  };
  return builder;
}

function memoryClient(tables: Record<string, Row[]>) {
  return { from: (table: string) => memory(tables, table) } as unknown as SupabaseClient;
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

function item(id: string, state: string, overrides: Row = {}): Row {
  return { id, organization_id: "org-1", order_id: `order-${id}`, shipment_id: `ship-${id}`, state, ...overrides };
}

const ORIGINAL_FLAG = process.env.BOOKING_QUEUE_ORGS;

beforeEach(() => {
  process.env.BOOKING_QUEUE_ORGS = "org-1";
  adminRpc.mockReset();
  startQueuedBookingJobs.mockClear();
  checkQuota.mockClear();
  validateOrdersForBooking.mockReset();
  for (const key of Object.keys(adminRows)) delete adminRows[key];
});

afterEach(() => {
  process.env.BOOKING_QUEUE_ORGS = ORIGINAL_FLAG;
});

describe("approval and exclusion", () => {
  it("TEST 2: approves only items waiting for approval and records who approved", async () => {
    const tables = {
      booking_queue_items: [item("a", "WAITING_APPROVAL"), item("b", "WAITING_APPROVAL"), item("c", "INVALID"), item("d", "BOOKED")],
    };
    const result = await approveItems(memoryClient(tables), ctx, ["a", "b", "c", "d", "a"]);
    expect(result.applied.sort()).toEqual(["a", "b"]);
    expect(result.skipped.map((row) => row.itemId).sort()).toEqual(["c", "d"]);
    expect(tables.booking_queue_items[0]).toMatchObject({ state: "READY_FOR_BOOKING", approved_by: "user-1" });
    expect(tables.booking_queue_items[2].state).toBe("INVALID");
    expect(adminRpc).not.toHaveBeenCalled();
  });

  it("approves all waiting only when the count still matches what was confirmed", async () => {
    const tables = { booking_queue_items: [item("a", "WAITING_APPROVAL"), item("b", "WAITING_APPROVAL"), item("c", "READY_FOR_BOOKING")] };
    await expect(approveAllWaiting(memoryClient(tables), ctx, 3)).rejects.toThrow(/2 orders are waiting/);
    expect(tables.booking_queue_items.filter((row) => row.state === "READY_FOR_BOOKING")).toHaveLength(1);
    const result = await approveAllWaiting(memoryClient(tables), ctx, 2);
    expect(result.applied.sort()).toEqual(["a", "b"]);
  });

  it("excludes waiting items but never booking or booked ones", async () => {
    const tables = { booking_queue_items: [item("a", "READY_FOR_BOOKING"), item("b", "BATCHED"), item("c", "BOOKED")] };
    const result = await excludeItems(memoryClient(tables), ctx, ["a", "b", "c"]);
    expect(result.applied).toEqual(["a"]);
    expect(tables.booking_queue_items.map((row) => row.state)).toEqual(["EXCLUDED", "BATCHED", "BOOKED"]);
  });

  it("checks items again through the same validation as enrollment", async () => {
    validateOrdersForBooking.mockResolvedValue({ rows: [{ orderId: "order-a", valid: true, issues: [] }], issues: [] });
    const tables = { booking_queue_items: [item("a", "INVALID", { issues: [{ error: "bad PIN" }] }), item("b", "SUBMITTING")] };
    const result = await revalidateItems(memoryClient(tables), ctx, ["a", "b"]);
    expect(result.applied).toEqual(["a"]);
    expect(tables.booking_queue_items[0]).toMatchObject({ state: "WAITING_APPROVAL", issues: [] });
    expect(tables.booking_queue_items[1].state).toBe("SUBMITTING");
  });

  it("refuses everything when the workspace is not in the rollout", async () => {
    process.env.BOOKING_QUEUE_ORGS = "";
    const client = memoryClient({ booking_queue_items: [item("a", "WAITING_APPROVAL")] });
    await expect(approveItems(client, ctx, ["a"])).rejects.toThrow(/not enabled/);
    await expect(dispatchItems(client, ctx, { itemIds: ["a"], idempotencyKey: "key-123456" })).rejects.toThrow(/not enabled/);
  });
});

describe("booking dispatch", () => {
  it("calls the dispatch transaction as the service role and starts the new jobs", async () => {
    adminRpc.mockResolvedValue({
      data: { runId: "run-1", replayed: false, dispatched: [{ itemId: "a", shipmentId: "ship-a", jobId: "job-1" }], skipped: [] },
      error: null,
    });
    adminRows.background_jobs = [{ id: "job-1", organization_id: "org-1", job_type: "shipment-booking", status: "QUEUED", entity_id: "ship-a" }];
    const member = memoryClient({ booking_queue_items: [item("a", "READY_FOR_BOOKING")] });
    const result = await dispatchItems(member, ctx, { itemIds: ["a"], idempotencyKey: "confirm-key-1" });
    expect(result).toMatchObject({ runId: "run-1", replayed: false });
    expect(checkQuota).toHaveBeenCalledWith(member, "org-1", 1);
    expect(adminRpc).toHaveBeenCalledWith("dispatch_booking_run", {
      p_organization_id: "org-1",
      p_item_ids: ["a"],
      p_idempotency_key: "confirm-key-1",
      p_trigger: "MANUAL",
      p_group_key: "MANUAL",
      p_created_by: "user-1",
    });
    expect(startQueuedBookingJobs).toHaveBeenCalledTimes(1);
  });

  it("does not start jobs again when the same confirmation is replayed", async () => {
    adminRpc.mockResolvedValue({ data: { runId: "run-1", replayed: true, dispatched: [{ itemId: "a", shipmentId: "ship-a" }], skipped: [] }, error: null });
    await dispatchItems(memoryClient({ booking_queue_items: [] }), ctx, { itemIds: ["a"], idempotencyKey: "confirm-key-1" });
    expect(startQueuedBookingJobs).not.toHaveBeenCalled();
  });

  it("skips the quota check when nothing selected is ready, and needs a confirmation key", async () => {
    adminRpc.mockResolvedValue({ data: { runId: null, dispatched: [], skipped: [{ itemId: "a", reason: "NOT_READY" }] }, error: null });
    await dispatchItems(memoryClient({ booking_queue_items: [item("a", "WAITING_APPROVAL")] }), ctx, {
      itemIds: ["a"],
      idempotencyKey: "confirm-key-2",
    });
    expect(checkQuota).not.toHaveBeenCalled();
    await expect(dispatchItems(memoryClient({}), ctx, { itemIds: ["a"], idempotencyKey: "x" })).rejects.toThrow(/confirmation key/);
  });

  it("gates the action routes on shipment write permission", () => {
    for (const action of ["approve", "exclude", "revalidate", "dispatch"]) {
      expect(permissionForTenantRoute("POST", `booking-queue/${action}`, ["booking-queue", action])).toBe("shipments.write");
    }
  });
});

describe("mirroring booking job outcomes", () => {
  it("only marks BOOKED from a confirmed booking", () => {
    expect(queueMirrorTarget("SUBMITTING", { status: "LABEL_READY", booked_at: "2026-11-01" })?.state).toBe("BOOKED");
    expect(queueMirrorTarget("INVALID", { status: "BOOKED", booked_at: "2026-11-01" })?.state).toBe("BOOKED");
    expect(queueMirrorTarget("BATCHED", { status: "BOOKED", booked_at: null })).toBeNull();
  });

  it("marks SUBMITTING only after a submit intent was recorded", () => {
    expect(queueMirrorTarget("BATCHED", { status: "BOOKING", metadata: {} })).toBeNull();
    expect(queueMirrorTarget("BATCHED", { status: "BOOKING", metadata: { ceptSubmitIntentAt: "2026-11-01T10:00:00Z" } })?.state).toBe(
      "SUBMITTING"
    );
  });

  it("carries failures and unknown outcomes for items in a run, and leaves retries alone", () => {
    expect(queueMirrorTarget("BATCHED", { status: "FAILED", last_error: "Invalid PIN", last_error_code: "INDIA_POST_VALIDATION" })).toEqual({
      state: "FAILED",
      lastError: "Invalid PIN",
      lastErrorCode: "INDIA_POST_VALIDATION",
    });
    expect(queueMirrorTarget("SUBMITTING", { status: "RECOVERY_REQUIRED" })?.state).toBe("RECOVERY_REQUIRED");
    expect(queueMirrorTarget("BATCHED", { status: "QUEUED" })).toBeNull();
    // Outside a run, a failed shipment does not change the queue item.
    expect(queueMirrorTarget("WAITING_APPROVAL", { status: "FAILED" })).toBeNull();
  });

  it("rolls a run up from its items", () => {
    expect(rollUpRun(["BOOKED", "BATCHED"])).toMatchObject({ status: "ACTIVE", booked: 1, active: 1 });
    expect(rollUpRun(["BOOKED", "BOOKED"])).toMatchObject({ status: "COMPLETED", booked: 2 });
    expect(rollUpRun(["BOOKED", "FAILED"])).toMatchObject({ status: "COMPLETED_WITH_ERRORS", failed: 1 });
    expect(rollUpRun(["BOOKED", "FAILED", "RECOVERY_REQUIRED"])).toMatchObject({ status: "RECOVERY_REQUIRED", recovery: 1 });
  });

  it("TEST 10: a run with mixed results ends with each article's own outcome", async () => {
    const tables: Record<string, Row[]> = {
      booking_queue_items: [
        item("a", "BATCHED", { run_id: "run-1" }),
        item("b", "SUBMITTING", { run_id: "run-1" }),
        item("c", "SUBMITTING", { run_id: "run-1" }),
      ],
      shipments: [
        { id: "ship-a", organization_id: "org-1", status: "LABEL_PENDING", booked_at: "2026-11-01T10:00:00Z" },
        { id: "ship-b", organization_id: "org-1", status: "FAILED", booked_at: null, last_error: "Invalid PIN" },
        { id: "ship-c", organization_id: "org-1", status: "RECOVERY_REQUIRED", booked_at: null },
      ],
      booking_runs: [{ id: "run-1", organization_id: "org-1", status: "ACTIVE" }],
    };
    const result = await syncQueueWithShipments(memoryClient(tables), "org-1");
    expect(result).toMatchObject({ booked: 1, failed: 1, recovery: 1, runs: 1 });
    expect(tables.booking_queue_items.map((row) => row.state)).toEqual(["BOOKED", "FAILED", "RECOVERY_REQUIRED"]);
    expect(tables.booking_runs[0]).toMatchObject({ status: "RECOVERY_REQUIRED", booked_count: 1, failed_count: 1, recovery_count: 1 });
  });
});

describe("dashboard messages", () => {
  it("explains action and booking results", () => {
    expect(queueActionMessage("approved", { applied: ["a", "b"], skipped: [{ itemId: "c", reason: "Only orders waiting for approval can be approved." }] })).toBe(
      "2 orders approved. 1 skipped: Only orders waiting for approval can be approved."
    );
    expect(dispatchMessage({ runId: "abcdef123456", replayed: false, dispatched: [{ itemId: "a", shipmentId: "s" }], skipped: [] })).toBe(
      "Booking started for 1 order (batch abcdef12)."
    );
    expect(dispatchMessage({ runId: "abcdef123456", replayed: true, dispatched: [], skipped: [] })).toMatch(/already started/);
    expect(dispatchMessage({ runId: null, replayed: false, dispatched: [], skipped: [{ itemId: "a", reason: "NOT_READY" }] })).toBe(
      "Nothing was booked. 1 order is not ready to book."
    );
  });

  it("makes a fresh confirmation key each time and asks for typing above the threshold", () => {
    expect(newIdempotencyKey()).not.toBe(newIdempotencyKey());
    expect(newIdempotencyKey().length).toBeGreaterThanOrEqual(8);
    expect(TYPED_CONFIRM_THRESHOLD).toBe(500);
  });
});
