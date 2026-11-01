import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TenantContext } from "@/lib/api/context";
import { permissionForTenantRoute } from "@/lib/api/v1-permissions";
import { FEATURE, lockedFeatureForApi } from "@/modules/billing/entitlements";
import { autoEnrollmentAllowed, queueEnrollmentDecision, queueSourceOf } from "@/modules/booking-queue/eligibility";
import { bookingQueueEnabledFor } from "@/modules/booking-queue/flags";
import {
  ACTIVE_QUEUE_STATES,
  BOOKING_QUEUE_STATES,
  memberMayTransitionQueueItem,
  QUEUE_SUMMARY_BUCKETS,
} from "@/modules/booking-queue/state";

const validateOrdersForBooking = vi.fn();
const createShipmentsForOrders = vi.fn();

vi.mock("@/modules/india-post/bulk-booking", () => ({
  validateOrdersForBooking: (...args: unknown[]) => validateOrdersForBooking(...args),
}));
vi.mock("@/modules/shipments/service", () => ({
  createShipmentsForOrders: (...args: unknown[]) => createShipmentsForOrders(...args),
}));
vi.mock("@/lib/supabase/admin", () => ({ hasAdminClient: () => false, createAdminClient: () => null }));

const { enqueueOrders, resolveQueueStates, syncQueueWithShipments, listQueueItems, queueSummary } = await import(
  "@/modules/booking-queue/service"
);

// ---------------------------------------------------------------------------
// Minimal in-memory Supabase for the enqueue path.
// ---------------------------------------------------------------------------
type Row = Record<string, unknown>;

function memoryDb(seed: Record<string, Row[]>) {
  const tables: Record<string, Row[]> = Object.fromEntries(Object.entries(seed).map(([k, v]) => [k, v.map((r) => ({ ...r }))]));
  let ids = 0;
  const from = (table: string) => {
    const filters: Array<(row: Row) => boolean> = [];
    let op: "select" | "insert" | "update" = "select";
    let payload: Row | null = null;
    const rows = () => (tables[table] ??= []);
    const run = () => {
      if (op === "insert") {
        const row: Row = { id: `${table}-${++ids}`, state: "PENDING_VALIDATION", ...payload! };
        if (
          table === "booking_queue_items" &&
          rows().some((other) => other.shipment_id === row.shipment_id && ACTIVE_QUEUE_STATES.has(other.state as never))
        ) {
          return { data: null, error: { code: "23505", message: "duplicate key booking_queue_items_one_active_uidx" } };
        }
        rows().push(row);
        return { data: [row], error: null };
      }
      const matched = rows().filter((row) => filters.every((test) => test(row)));
      if (op === "update") for (const row of matched) Object.assign(row, payload);
      return { data: matched, error: null };
    };
    const builder: Record<string, unknown> = {
      select: () => builder,
      insert: (value: Row) => ((op = "insert"), (payload = value), builder),
      update: (value: Row) => ((op = "update"), (payload = value), builder),
      eq: (column: string, value: unknown) => (filters.push((row) => row[column] === value), builder),
      in: (column: string, values: unknown[]) => (filters.push((row) => values.includes(row[column])), builder),
      order: () => builder,
      limit: () => builder,
      maybeSingle: async () => {
        const result = run();
        return { data: result.data?.[0] ?? null, error: result.error };
      },
      single: async () => {
        const result = run();
        return { data: result.data?.[0] ?? null, error: result.error };
      },
      then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
        Promise.resolve().then(run).then(resolve, reject),
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

function order(id: string, overrides: Row = {}): Row {
  return {
    id,
    organization_id: "org-1",
    order_number: `#${id}`,
    source: "MANUAL",
    status: "READY",
    payment_status: "PAID",
    shipments: [],
    ...overrides,
  };
}

const ORIGINAL_FLAG = process.env.BOOKING_QUEUE_ORGS;

beforeEach(() => {
  process.env.BOOKING_QUEUE_ORGS = "org-1";
  validateOrdersForBooking.mockReset();
  createShipmentsForOrders.mockReset();
  createShipmentsForOrders.mockImplementation(async (_s: unknown, _c: unknown, orderIds: string[]) => ({
    shipments: orderIds.map((id) => ({ id: `ship-${id}`, order_id: id })),
  }));
  validateOrdersForBooking.mockImplementation(async (_s: unknown, _c: unknown, orderIds: string[]) => ({
    rows: orderIds.map((orderId) => ({ orderId, valid: true, issues: [] })),
    issues: [],
  }));
});

afterEach(() => {
  process.env.BOOKING_QUEUE_ORGS = ORIGINAL_FLAG;
});

describe("rollout flag", () => {
  it("is off unless the workspace is listed", () => {
    expect(bookingQueueEnabledFor("org-1", "   ")).toBe(false);
    expect(bookingQueueEnabledFor("org-1", "")).toBe(false);
    expect(bookingQueueEnabledFor("org-1", "org-2, ORG-1")).toBe(true);
    expect(bookingQueueEnabledFor("org-3", "org-2,org-1")).toBe(false);
    expect(bookingQueueEnabledFor("org-9", "*")).toBe(true);
  });

  it("TEST 25: a workspace that has not opted in cannot enqueue and sees the queue as off", async () => {
    process.env.BOOKING_QUEUE_ORGS = "";
    const db = memoryDb({ orders: [order("o1")] });
    await expect(enqueueOrders(db.client, ctx, ["o1"])).rejects.toThrow(/not enabled/);
    expect(await listQueueItems(db.client, ctx)).toMatchObject({ enabled: false, items: [], total: 0 });
    expect(await queueSummary(db.client, ctx)).toMatchObject({ enabled: false, settings: { mode: "MANUAL" } });
    expect(createShipmentsForOrders).not.toHaveBeenCalled();
  });
});

describe("enrollment rules", () => {
  it("refuses cancelled, booked, in-flight and not-ready WhatsApp orders", () => {
    expect(queueEnrollmentDecision({ id: "o", status: "CANCELLED" })).toMatchObject({ ok: false, code: "ORDER_CANCELLED" });
    expect(
      queueEnrollmentDecision({ id: "o", shipments: [{ id: "s", status: "LABEL_READY", barcode: "EA000000001IN", booked_at: "2026-11-01" }] })
    ).toMatchObject({ ok: false, code: "ALREADY_BOOKED" });
    for (const status of ["QUEUED", "BOOKING", "RECOVERY_REQUIRED"]) {
      expect(queueEnrollmentDecision({ id: "o", shipments: [{ id: "s", status }] })).toMatchObject({
        ok: false,
        code: "BOOKING_IN_PROGRESS",
      });
    }
    expect(queueEnrollmentDecision({ id: "o", source: "WHATSAPP", status: "IMPORTED", payment_status: "PENDING" })).toMatchObject({
      ok: false,
      code: "WHATSAPP_NOT_READY",
    });
  });

  it("reuses a DRAFT or FAILED shipment and ignores cancelled ones", () => {
    expect(queueEnrollmentDecision({ id: "o", shipments: [{ id: "s1", status: "DRAFT" }] })).toMatchObject({ ok: true, shipmentId: "s1" });
    expect(
      queueEnrollmentDecision({ id: "o", shipments: [{ id: "old", status: "CANCELLED" }, { id: "s2", status: "FAILED" }] })
    ).toMatchObject({ ok: true, shipmentId: "s2" });
    expect(queueEnrollmentDecision({ id: "o", shipments: [{ id: "old", status: "CANCELLED" }] })).toMatchObject({
      ok: true,
      shipmentId: null,
    });
  });

  it("TEST 15: a partially paid order can be queued by a person but never automatically", () => {
    const partial = { id: "o", source: "SHOPIFY", payment_status: "PARTIAL" };
    const decision = queueEnrollmentDecision(partial);
    expect(decision.ok).toBe(true);
    expect(decision.ok && decision.warnings[0]).toMatch(/Partially paid/);
    expect(autoEnrollmentAllowed(partial, ["SHOPIFY"])).toBe(false);
    expect(autoEnrollmentAllowed({ ...partial, payment_status: "PENDING" }, ["SHOPIFY"])).toBe(false);
    expect(autoEnrollmentAllowed({ ...partial, payment_status: "PAID" }, ["SHOPIFY"])).toBe(true);
    expect(autoEnrollmentAllowed({ ...partial, payment_status: "COD" }, ["SHOPIFY"])).toBe(true);
    expect(autoEnrollmentAllowed({ ...partial, payment_status: "PAID" }, ["WOOCOMMERCE"])).toBe(false);
  });

  it("maps order sources onto queue sources", () => {
    expect(queueSourceOf("shopify")).toBe("SHOPIFY");
    expect(queueSourceOf("WHATSAPP")).toBe("WHATSAPP");
    expect(queueSourceOf(null)).toBe("MANUAL");
    expect(queueSourceOf("SOMETHING_NEW")).toBe("MANUAL");
  });
});

describe("enqueue", () => {
  it("TEST 1: queues one manual order for approval without booking it", async () => {
    const db = memoryDb({ orders: [order("o1")], booking_queue_items: [] });
    const result = await enqueueOrders(db.client, ctx, ["o1"]);
    expect(result.skipped).toEqual([]);
    expect(result.enqueued).toEqual([{ orderId: "o1", itemId: expect.any(String), state: "WAITING_APPROVAL", warnings: [] }]);
    expect(createShipmentsForOrders).toHaveBeenCalledWith(db.client, ctx, ["o1"], {
      enqueueBooking: false,
      runBookingNow: false,
      setOrderProcessing: false,
    });
    expect(db.tables.booking_queue_items[0]).toMatchObject({
      shipment_id: "ship-o1",
      order_id: "o1",
      source: "MANUAL",
      state: "WAITING_APPROVAL",
      enrolled_via: "ORDERS_PAGE",
      enrolled_by: "user-1",
    });
  });

  it("reuses an existing shipment instead of creating another", async () => {
    const db = memoryDb({ orders: [order("o1", { shipments: [{ id: "draft-1", status: "DRAFT" }] })], booking_queue_items: [] });
    await enqueueOrders(db.client, ctx, ["o1"]);
    expect(createShipmentsForOrders).not.toHaveBeenCalled();
    expect(db.tables.booking_queue_items[0].shipment_id).toBe("draft-1");
  });

  it("TEST 23: an order that fails validation lands in INVALID with the reasons", async () => {
    validateOrdersForBooking.mockResolvedValue({
      rows: [{ orderId: "o1", valid: false, issues: [{ field: "receiver_pincode", error: "PIN code is invalid." }] }],
      issues: [],
    });
    const db = memoryDb({ orders: [order("o1")], booking_queue_items: [] });
    const result = await enqueueOrders(db.client, ctx, ["o1"]);
    expect(result.enqueued[0].state).toBe("INVALID");
    expect(db.tables.booking_queue_items[0]).toMatchObject({
      state: "INVALID",
      last_error: "PIN code is invalid.",
      last_error_code: "VALIDATION_FAILED",
    });
  });

  it("keeps items pending when validation cannot run (for example India Post disconnected)", async () => {
    validateOrdersForBooking.mockRejectedValue(new Error("India Post is not connected."));
    const db = memoryDb({ orders: [order("o1")], booking_queue_items: [] });
    const result = await enqueueOrders(db.client, ctx, ["o1"]);
    expect(result.enqueued[0].state).toBe("PENDING_VALIDATION");
    expect(db.tables.booking_queue_items[0]).toMatchObject({
      state: "PENDING_VALIDATION",
      last_error_code: "VALIDATION_UNAVAILABLE",
    });
  });

  it("reports every skip with a reason and never queues booked or in-flight shipments", async () => {
    const db = memoryDb({
      orders: [
        order("booked", { shipments: [{ id: "s1", status: "BOOKED", barcode: "EA000000001IN", booked_at: "2026-11-01" }] }),
        order("inflight", { shipments: [{ id: "s2", status: "QUEUED" }] }),
        order("queued", { shipments: [{ id: "s3", status: "DRAFT" }] }),
        order("ok"),
      ],
      booking_queue_items: [{ id: "existing", organization_id: "org-1", order_id: "queued", shipment_id: "s3", state: "WAITING_APPROVAL" }],
    });
    const result = await enqueueOrders(db.client, ctx, ["booked", "inflight", "queued", "missing", "ok"]);
    expect(result.enqueued.map((row) => row.orderId)).toEqual(["ok"]);
    expect(Object.fromEntries(result.skipped.map((row) => [row.orderId, row.code]))).toEqual({
      booked: "ALREADY_BOOKED",
      inflight: "BOOKING_IN_PROGRESS",
      queued: "ALREADY_QUEUED",
      missing: "NOT_FOUND",
    });
    expect(validateOrdersForBooking).toHaveBeenCalledWith(db.client, ctx, ["ok"]);
  });

  it("turns a concurrent duplicate enrollment into a skip, not an error", async () => {
    const db = memoryDb({ orders: [order("o1", { shipments: [{ id: "draft-1", status: "DRAFT" }] })], booking_queue_items: [] });
    // Another request wins the insert after this one already checked for live items.
    const realFrom = db.client.from.bind(db.client);
    (db.client as unknown as { from: (table: string) => unknown }).from = (table: string) => {
      const builder = realFrom(table) as unknown as Record<string, (...args: unknown[]) => unknown>;
      if (table !== "booking_queue_items") return builder;
      const insert = builder.insert;
      builder.insert = (value: unknown) => {
        db.tables.booking_queue_items.push({ id: "other", organization_id: "org-1", order_id: "o1", shipment_id: "draft-1", state: "PENDING_VALIDATION" });
        return insert(value);
      };
      return builder;
    };
    const result = await enqueueOrders(db.client, ctx, ["o1"]);
    expect(result.enqueued).toEqual([]);
    expect(result.skipped).toEqual([expect.objectContaining({ orderId: "o1", code: "ALREADY_QUEUED" })]);
    expect(db.tables.booking_queue_items.map((row) => row.id)).toEqual(["other"]);
    expect(validateOrdersForBooking).not.toHaveBeenCalled();
  });

  it("rejects an empty or oversized request", async () => {
    const db = memoryDb({ orders: [] });
    await expect(enqueueOrders(db.client, ctx, [])).rejects.toThrow(/at least one/);
    await expect(enqueueOrders(db.client, ctx, Array.from({ length: 501 }, (_, i) => `o${i}`))).rejects.toThrow(/at most 500/);
  });
});

describe("mirroring outcomes from other booking paths", () => {
  it("marks an item BOOKED when the shipment was booked elsewhere and cancels for cancelled shipments", async () => {
    const db = memoryDb({
      booking_queue_items: [
        { id: "i1", organization_id: "org-1", shipment_id: "s1", state: "WAITING_APPROVAL" },
        { id: "i2", organization_id: "org-1", shipment_id: "s2", state: "READY_FOR_BOOKING" },
        { id: "i3", organization_id: "org-1", shipment_id: "s3", state: "INVALID" },
        { id: "other-org", organization_id: "org-2", shipment_id: "s4", state: "WAITING_APPROVAL" },
      ],
      shipments: [
        { id: "s1", organization_id: "org-1", status: "LABEL_READY", booked_at: "2026-11-01T10:00:00Z" },
        { id: "s2", organization_id: "org-1", status: "CANCELLED", booked_at: null },
        { id: "s3", organization_id: "org-1", status: "DRAFT", booked_at: null },
        { id: "s4", organization_id: "org-2", status: "LABEL_READY", booked_at: "2026-11-01T10:00:00Z" },
      ],
    });
    const result = await syncQueueWithShipments(db.client, "org-1");
    expect(result).toEqual({ booked: 1, cancelled: 1 });
    const state = (id: string) => db.tables.booking_queue_items.find((row) => row.id === id)?.state;
    expect(state("i1")).toBe("BOOKED");
    expect(state("i2")).toBe("CANCELLED");
    expect(state("i3")).toBe("INVALID");
    expect(state("other-org")).toBe("WAITING_APPROVAL");
  });
});

describe("states, filters and routes", () => {
  it("puts every queue state in exactly one dashboard bucket", () => {
    const seen = Object.values(QUEUE_SUMMARY_BUCKETS).flat();
    expect([...seen].sort()).toEqual([...BOOKING_QUEUE_STATES].sort());
    expect(new Set(seen).size).toBe(seen.length);
  });

  it("resolves bucket names and states for list filters", () => {
    expect(resolveQueueStates(undefined)).toBeNull();
    expect(resolveQueueStates(["waitingApproval"])?.sort()).toEqual(["PENDING_VALIDATION", "WAITING_APPROVAL"]);
    expect(resolveQueueStates(["BOOKED", "recovery"])?.sort()).toEqual(["BOOKED", "RECOVERY_REQUIRED"]);
    expect(resolveQueueStates(["nonsense"])).toEqual([]);
  });

  it("never lets members move items into system states", () => {
    expect(memberMayTransitionQueueItem("WAITING_APPROVAL", "READY_FOR_BOOKING")).toBe(true);
    expect(memberMayTransitionQueueItem("READY_FOR_BOOKING", "BATCHED")).toBe(false);
    expect(memberMayTransitionQueueItem("WAITING_APPROVAL", "BOOKED")).toBe(false);
    expect(memberMayTransitionQueueItem("RECOVERY_REQUIRED", "FAILED")).toBe(false);
  });

  it("gates the queue API on shipment permissions and the Bulk plan", () => {
    expect(permissionForTenantRoute("GET", "booking-queue", ["booking-queue"])).toBe("shipments.read");
    expect(permissionForTenantRoute("GET", "booking-queue/summary", ["booking-queue", "summary"])).toBe("shipments.read");
    expect(permissionForTenantRoute("POST", "booking-queue/enqueue", ["booking-queue", "enqueue"])).toBe("shipments.write");
    expect(lockedFeatureForApi("GET", "booking-queue", ["booking-queue"])).toBe(FEATURE.bulk);
    expect(lockedFeatureForApi("POST", "booking-queue/enqueue", ["booking-queue", "enqueue"])).toBe(FEATURE.bulk);
  });
});
