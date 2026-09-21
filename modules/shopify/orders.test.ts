import { describe, expect, it, vi } from "vitest";
import { encryptSecret } from "@/lib/security/crypto";
import {
  importShopifyWebhookOrder,
  isUnfulfilledShopifyOrder,
  mapShopifyFulfillmentStatus,
  mapShopifyPaymentStatus,
  shopifyCustomerName,
  shopifyFulfillmentPayload,
  shopifyOrderNumber,
  shopifyPhone,
  shopifyPincode,
  shopifyReadyToSync,
  upsertShopifyOrder,
} from "@/modules/shopify/orders";

const { createShipmentsForOrders, getAutomationSettings } = vi.hoisted(() => ({
  createShipmentsForOrders: vi.fn().mockResolvedValue([]),
  getAutomationSettings: vi.fn(),
}));

vi.mock("@/modules/shipments/service", () => ({
  createShipmentsForOrders,
}));

vi.mock("@/modules/automation/service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/automation/service")>();
  return { ...actual, getAutomationSettings };
});

function query(data: unknown) {
  const payload = { data, error: null };
  const self: Record<string, unknown> = {};
  self.select = () => self;
  self.eq = () => self;
  self.insert = () => self;
  self.update = () => self;
  self.upsert = () => self;
  self.maybeSingle = async () => payload;
  self.single = async () => payload;
  self.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
    Promise.resolve(payload).then(resolve, reject);
  return self;
}

function newOrderClient() {
  return {
    from: vi.fn((table: string) => {
      if (table === "external_order_references") return query(null);
      if (table === "customers") return query({ id: "cust-1" });
      if (table === "addresses") return query({ id: "addr-1" });
      if (table === "orders") return query({ id: "ord-1" });
      return query({});
    }),
  };
}

const remoteOrder = {
  id: 1042,
  name: "#1042",
  fulfillment_status: null,
  cancelled_at: null,
  shipping_address: { first_name: "Asha", last_name: "Rao", phone: "9876543210", zip: "560001" },
  line_items: [{ title: "Mug", quantity: 1, price: "10", grams: 200 }],
};

describe("shopify order mapping", () => {
  it("treats open unfulfilled and partial orders as importable", () => {
    expect(isUnfulfilledShopifyOrder({ fulfillment_status: null, cancelled_at: null })).toBe(true);
    expect(isUnfulfilledShopifyOrder({ fulfillment_status: "unfulfilled", cancelled_at: null })).toBe(true);
    expect(isUnfulfilledShopifyOrder({ fulfillment_status: "partial", cancelled_at: null })).toBe(true);
    expect(isUnfulfilledShopifyOrder({ fulfillment_status: "fulfilled", cancelled_at: null })).toBe(false);
    expect(isUnfulfilledShopifyOrder({ fulfillment_status: "unfulfilled", cancelled_at: "2026-01-01" })).toBe(false);
  });

  it("maps Shopify payment and fulfillment statuses", () => {
    expect(mapShopifyPaymentStatus("paid")).toBe("PAID");
    expect(mapShopifyPaymentStatus("pending")).toBe("PENDING");
    expect(mapShopifyPaymentStatus("pending", ["cash_on_delivery"])).toBe("COD");
    expect(mapShopifyPaymentStatus("authorized", "Cash on Delivery (COD)")).toBe("COD");
    expect(mapShopifyPaymentStatus("paid", ["cash_on_delivery"])).toBe("PAID");
    expect(mapShopifyFulfillmentStatus(null, null)).toBe("UNFULFILLED");
    expect(mapShopifyFulfillmentStatus("partial", null)).toBe("PARTIAL");
    expect(mapShopifyFulfillmentStatus("unfulfilled", "2026-01-01")).toBe("CANCELLED");
  });

  it("builds a stable order number and customer name", () => {
    expect(shopifyOrderNumber({ name: "#1042", order_number: 1042 }, "1")).toBe("#1042");
    expect(shopifyOrderNumber({ order_number: 88 }, "99")).toBe("#88");
    expect(
      shopifyCustomerName({
        shipping_address: { first_name: "Asha", last_name: "Rao" },
      })
    ).toBe("Asha Rao");
  });

  it("normalizes Indian phone and pincode values", () => {
    expect(shopifyPhone("+91 98765 43210")).toBe("919876543210");
    expect(shopifyPhone("")).toBe("0000000000");
    expect(shopifyPincode("560001")).toBe("560001");
    expect(shopifyPincode("12")).toBe("120000");
  });

  it("builds a Shopify fulfillment payload from open fulfillment orders", () => {
    const payload = shopifyFulfillmentPayload({
      fulfillmentOrders: [
        { id: 11, status: "open" },
        { id: 12, status: "closed" },
        { id: 13, status: "in_progress" },
      ],
      trackingNumber: "CL556974704IN",
    });
    expect(payload.fulfillment.line_items_by_fulfillment_order).toEqual([
      { fulfillment_order_id: 11 },
      { fulfillment_order_id: 13 },
    ]);
    expect(payload.fulfillment.tracking_info).toEqual({
      company: "India Post",
      number: "CL556974704IN",
      url: "https://www.indiapost.gov.in/_layouts/15/dop.portal.tracking/trackconsignment.aspx?articleid=CL556974704IN",
    });
    expect(payload.fulfillment.notify_customer).toBe(true);
  });

  it("is ready to sync when shop domain and app credentials exist", () => {
    expect(shopifyReadyToSync({ shop_domain: "demo.myshopify.com" })).toBe(false);
    expect(
      shopifyReadyToSync({
        shop_domain: "demo.myshopify.com",
        client_id: "client-id",
        encrypted_client_secret: encryptSecret("client-secret"),
      })
    ).toBe(true);
  });
});

describe("shopify automation flags", () => {
  it("skips webhook order import when auto Shopify sync is off", async () => {
    getAutomationSettings.mockResolvedValue({
      autoShopifySync: false,
      autoShipmentCreation: true,
      autoBooking: true,
    });
    const supabase = { from: vi.fn() };
    const result = await importShopifyWebhookOrder(supabase as never, {
      organizationId: "org-1",
      shopDomain: "demo.myshopify.com",
      topic: "orders/create",
      remote: remoteOrder,
    });
    expect(result.skipped).toBe(true);
    expect(result.imported).toBe(false);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("honors auto booking when a webhook import creates a shipment", async () => {
    getAutomationSettings.mockResolvedValue({
      autoShopifySync: true,
      autoShipmentCreation: true,
      autoBooking: false,
    });
    createShipmentsForOrders.mockClear();
    const result = await importShopifyWebhookOrder(newOrderClient() as never, {
      organizationId: "org-1",
      shopDomain: "demo.myshopify.com",
      topic: "orders/create",
      remote: remoteOrder,
    });
    expect(result.imported).toBe(true);
    expect(createShipmentsForOrders).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: "org-1" }),
      ["ord-1"],
      { enqueueBooking: false }
    );
  });

  it("passes auto booking through to shipment create", async () => {
    createShipmentsForOrders.mockClear();
    const supabase = newOrderClient();
    const result = await upsertShopifyOrder(supabase as never, {
      organizationId: "org-1",
      shopDomain: "demo.myshopify.com",
      remote: remoteOrder,
      createShipment: true,
      enqueueBooking: false,
    });
    expect(result.imported).toBe(true);
    expect(createShipmentsForOrders).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: "org-1" }),
      ["ord-1"],
      { enqueueBooking: false }
    );
  });
});
