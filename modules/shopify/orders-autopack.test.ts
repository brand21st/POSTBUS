import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildShipmentComposition } from "@/modules/autopack/composition";
import type { PackagingHistoryRecord } from "@/modules/autopack/history";
import { upsertShopifyOrder } from "@/modules/shopify/orders";

/**
 * Shopify sync → AutoPack, end to end through upsertShopifyOrder with the real decision engine.
 * Only the history lookup, shipment creation and automation reads are stubbed.
 */

const { createShipmentsForOrders, getAutomationSettings, loadHistoryForKey } = vi.hoisted(() => ({
  createShipmentsForOrders: vi.fn().mockResolvedValue([]),
  getAutomationSettings: vi.fn().mockResolvedValue({}),
  loadHistoryForKey: vi.fn(),
}));

vi.mock("@/modules/shipments/service", () => ({ createShipmentsForOrders }));
vi.mock("@/modules/automation/service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/automation/service")>();
  return { ...actual, getAutomationSettings };
});
vi.mock("@/modules/autopack/history", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/autopack/history")>();
  return { ...actual, loadHistoryForKey };
});

const VARIANT = 501;
const composition = buildShipmentComposition([{ variantId: VARIANT, quantity: 2 }]);
const KEY = composition.ok ? composition.key : "";
const EVIDENCE = "99999999-9999-4999-8999-999999999999";

function verifiedRow(overrides: Partial<PackagingHistoryRecord> = {}): PackagingHistoryRecord {
  return {
    id: EVIDENCE,
    compositionKey: KEY,
    composition: [],
    unitCount: 2,
    lengthCm: 30,
    widthCm: 25,
    heightCm: 15,
    weightGrams: null,
    serviceCode: "SP_INLAND_PARCEL",
    packageSource: "custom",
    presetId: null,
    evidenceLevel: "verified",
    enteredAt: "2026-10-20T00:00:00.000Z",
    confirmedAt: null,
    verifiedAt: "2026-10-20T00:00:00.000Z",
    supersededAt: null,
    createdAt: "2026-10-20T00:00:00.000Z",
    orderId: null,
    shipmentId: null,
    shopDomain: null,
    rejectedOrderIds: [],
    ...overrides,
  };
}

const remote = {
  id: 2001,
  name: "#2001",
  fulfillment_status: null,
  cancelled_at: null,
  shipping_address: { first_name: "Asha", last_name: "Rao", phone: "9876543210", zip: "560001" },
  line_items: [
    {
      id: "7001",
      variant_id: VARIANT,
      product_id: 42,
      title: "Mug",
      quantity: 2,
      fulfillable_quantity: 2,
      unfulfilled_quantity: 2,
      requires_shipping: true,
      price: "10",
      grams: 300,
    },
  ],
};

type Shipment = {
  id: string;
  status: string;
  booked_at?: string | null;
  barcode?: string | null;
  length_cm?: number | null;
  width_cm?: number | null;
  height_cm?: number | null;
  metadata?: unknown;
};

function client(options: { shipments: Shipment[]; autoSelection: boolean }) {
  const updates: Array<{ table: string; payload: Record<string, unknown> }> = [];
  const inserts: Array<{ table: string; payload: unknown }> = [];
  const supabase = {
    rpc: async () => ({ data: { ok: true, action: "replaced", count: 1 }, error: null }),
    from: vi.fn((table: string) => {
      let data: unknown = {};
      if (table === "external_order_references") data = { order_id: "ord-1" };
      else if (table === "orders") data = { id: "ord-1", status: "READY", payment_status: "PAID", metadata: {} };
      else if (table === "customers") data = { id: "cust-1" };
      else if (table === "addresses") data = { id: "addr-1" };
      else if (table === "shipments") data = options.shipments;
      else if (table === "user_shipment_presets") data = [];
      else if (table === "automation_settings") data = { auto_package_selection: options.autoSelection };
      const payload = { data, error: null };
      const self: Record<string, unknown> = {};
      for (const method of ["select", "eq", "in", "is", "upsert", "delete", "order", "limit", "filter"]) {
        self[method] = () => self;
      }
      self.insert = (row: unknown) => {
        inserts.push({ table, payload: row });
        return self;
      };
      self.update = (row: Record<string, unknown>) => {
        updates.push({ table, payload: row });
        return self;
      };
      self.maybeSingle = async () => payload;
      self.single = async () => payload;
      self.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
        Promise.resolve(payload).then(resolve, reject);
      return self;
    }),
  };
  return { supabase, updates, inserts };
}

function shipmentUpdates(updates: Array<{ table: string; payload: Record<string, unknown> }>) {
  return updates.filter((row) => row.table === "shipments").map((row) => row.payload);
}

async function sync(shipments: Shipment[], autoSelection = true) {
  const tracked = client({ shipments, autoSelection });
  await upsertShopifyOrder(tracked.supabase as never, {
    organizationId: "org-1",
    shopDomain: "demo.myshopify.com",
    remote,
  });
  return tracked;
}

beforeEach(() => {
  loadHistoryForKey.mockReset();
  loadHistoryForKey.mockResolvedValue([verifiedRow()]);
});

describe("Shopify sync with AutoPack", () => {
  it("applies a verified past box to a multi-unit draft and records the evidence", async () => {
    const { updates, inserts } = await sync([
      { id: "shp-1", status: "DRAFT", length_cm: 14, width_cm: 9, height_cm: 1, metadata: { parcelDimensions: { source: "postbus_default" } } },
    ]);
    expect(loadHistoryForKey).toHaveBeenCalledWith(expect.anything(), "org-1", KEY);
    const patch = shipmentUpdates(updates).find((row) => row.length_cm != null) as Record<string, unknown>;
    expect(patch).toMatchObject({ length_cm: 30, width_cm: 25, height_cm: 15 });
    expect((patch.metadata as { parcelDimensions: Record<string, unknown> }).parcelDimensions).toMatchObject({
      source: "autopack_history",
      evidenceId: EVIDENCE,
    });
    expect(inserts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: "audit_logs",
          payload: expect.objectContaining({ action: "autopack.applied", entity_id: "shp-1" }),
        }),
      ])
    );
  });

  it("stores Shopify variant ids on the order lines", async () => {
    const { updates } = await sync([{ id: "shp-1", status: "DRAFT" }]);
    expect(updates).toEqual(
      expect.arrayContaining([
        { table: "order_line_items", payload: { shopify_variant_id: "501", shopify_product_id: "42" } },
      ])
    );
  });

  it("does nothing when the merchant has not opted in", async () => {
    const { updates } = await sync(
      [{ id: "shp-1", status: "DRAFT", length_cm: 14, width_cm: 9, height_cm: 1, metadata: { parcelDimensions: { source: "postbus_default" } } }],
      false
    );
    for (const patch of shipmentUpdates(updates)) expect(patch.length_cm).toBeUndefined();
  });

  it("manual override preservation: a merchant custom size is never overwritten", async () => {
    for (const source of ["postbus_custom", "postbus_preset", "postbus"]) {
      const { updates } = await sync([
        { id: "shp-1", status: "DRAFT", length_cm: 40, width_cm: 30, height_cm: 20, metadata: { parcelDimensions: { source } } },
      ]);
      for (const patch of shipmentUpdates(updates)) {
        expect(patch.length_cm).toBeUndefined();
        expect(patch.metadata).toBeUndefined();
      }
    }
  });

  it("no duplicate booking: queued, booking and booked shipments are left alone", async () => {
    for (const shipment of [
      { id: "shp-1", status: "QUEUED" },
      { id: "shp-1", status: "BOOKING", barcode: "EK123456789IN" },
      { id: "shp-1", status: "FAILED", barcode: "EK123456789IN" },
    ]) {
      const { updates } = await sync([shipment]);
      for (const patch of shipmentUpdates(updates)) expect(patch.length_cm).toBeUndefined();
    }
    expect(createShipmentsForOrders).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ enqueueBooking: true })
    );
  });

  it("already applied evidence is not rewritten on every sync", async () => {
    const { updates } = await sync([
      {
        id: "shp-1",
        status: "DRAFT",
        length_cm: 30,
        width_cm: 25,
        height_cm: 15,
        metadata: { parcelDimensions: { source: "autopack_history", evidenceId: EVIDENCE } },
      },
    ]);
    for (const patch of shipmentUpdates(updates)) expect(patch.metadata).toBeUndefined();
  });

  it("confirmed-only history is not auto-applied", async () => {
    loadHistoryForKey.mockResolvedValue([verifiedRow({ evidenceLevel: "confirmed", verifiedAt: null })]);
    const { updates } = await sync([{ id: "shp-1", status: "DRAFT" }]);
    for (const patch of shipmentUpdates(updates)) expect(patch.length_cm).toBeUndefined();
  });

  it("different quantities do not reuse the box", async () => {
    loadHistoryForKey.mockImplementation(async (_client: unknown, _org: string, key: string) =>
      key === KEY ? [verifiedRow()] : []
    );
    const tracked = client({ shipments: [{ id: "shp-1", status: "DRAFT" }], autoSelection: true });
    await upsertShopifyOrder(tracked.supabase as never, {
      organizationId: "org-1",
      shopDomain: "demo.myshopify.com",
      remote: {
        ...remote,
        line_items: [{ ...remote.line_items[0], quantity: 3, fulfillable_quantity: 3, unfulfilled_quantity: 3 }],
      },
    });
    for (const patch of shipmentUpdates(tracked.updates)) expect(patch.length_cm).toBeUndefined();
  });
});
