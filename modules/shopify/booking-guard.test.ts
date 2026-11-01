import { describe, expect, it, vi } from "vitest";
import { revalidateShopifyBooking } from "@/modules/shopify/booking-guard";

vi.mock("@/modules/shopify/fulfillment-orders", () => ({
  fetchShopifyOrderFulfillmentOrders: vi.fn(),
}));

vi.mock("@/modules/shopify/orders", () => ({
  loadShopifyConnection: vi.fn(),
  resolveShopifyAdminToken: vi.fn(),
}));

import { fetchShopifyOrderFulfillmentOrders } from "@/modules/shopify/fulfillment-orders";
import { loadShopifyConnection, resolveShopifyAdminToken } from "@/modules/shopify/orders";

function supabaseStub(allocations: unknown[] = []) {
  return {
    from: vi.fn((table: string) => {
      const chain: Record<string, unknown> = {};
      const self = () => chain;
      chain.select = self;
      chain.eq = self;
      chain.in = self;
      chain.delete = self;
      chain.insert = async () => ({ error: null });
      chain.update = self;
      chain.maybeSingle = async () => ({ data: null, error: null });
      chain.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
        Promise.resolve({ data: table === "shopify_shipment_allocations" ? allocations : [], error: null }).then(
          resolve,
          reject
        );
      return chain;
    }),
  };
}

const shipment = {
  id: "shp-1",
  order_id: "ord-1",
  status: "QUEUED",
  booked_at: null,
  barcode: null,
  orders: { id: "ord-1", source: "SHOPIFY", source_order_id: "1042" },
};

describe("revalidateShopifyBooking", () => {
  it("skips non-Shopify orders", async () => {
    const result = await revalidateShopifyBooking(supabaseStub() as never, {
      organizationId: "org-1",
      shipment: { ...shipment, orders: { id: "ord-1", source: "MANUAL" } },
    });
    expect(result.ok).toBe(true);
    expect(fetchShopifyOrderFulfillmentOrders).not.toHaveBeenCalled();
  });

  it("does not touch shipments that already have an India Post AWB", async () => {
    const result = await revalidateShopifyBooking(supabaseStub() as never, {
      organizationId: "org-1",
      shipment: { ...shipment, status: "BOOKED", booked_at: "2026-10-01", barcode: "EM123456789IN", tracking_number: "EM123456789IN" },
    });
    expect(result.ok).toBe(true);
    expect(result.reason).toBe("already_booked");
    expect(fetchShopifyOrderFulfillmentOrders).not.toHaveBeenCalled();
  });

  it("blocks booking when Shopify fulfillment orders cannot be loaded", async () => {
    vi.mocked(loadShopifyConnection).mockResolvedValue({ shop_domain: "demo.myshopify.com" } as never);
    vi.mocked(resolveShopifyAdminToken).mockResolvedValue("tok");
    vi.mocked(fetchShopifyOrderFulfillmentOrders).mockRejectedValueOnce(new Error("ACCESS_DENIED"));
    const result = await revalidateShopifyBooking(supabaseStub() as never, {
      organizationId: "org-1",
      shipment,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/ACCESS_DENIED/);
  });

  it("blocks booking when remaining FO quantity is already allocated elsewhere", async () => {
    vi.mocked(loadShopifyConnection).mockResolvedValue({ shop_domain: "demo.myshopify.com" } as never);
    vi.mocked(resolveShopifyAdminToken).mockResolvedValue("tok");
    vi.mocked(fetchShopifyOrderFulfillmentOrders).mockResolvedValue({
      orderGid: "gid://shopify/Order/1042",
      cancelledAt: null,
      displayFulfillmentStatus: "UNFULFILLED",
      fulfillmentOrders: [
        {
          id: "gid://shopify/FulfillmentOrder/11",
          status: "OPEN",
          requestStatus: "UNSUBMITTED",
          supportedActions: ["CREATE_FULFILLMENT"],
          assignedLocationId: "gid://shopify/Location/1",
          lineItems: [
            {
              id: "gid://shopify/FulfillmentOrderLineItem/101",
              remainingQuantity: 2,
              totalQuantity: 2,
              requiresShipping: true,
              orderLineItemId: "gid://shopify/LineItem/1",
            },
          ],
        },
      ],
    });
    const result = await revalidateShopifyBooking(
      supabaseStub([
        {
          shipment_id: "other",
          shopify_fulfillment_order_line_item_id: "gid://shopify/FulfillmentOrderLineItem/101",
          quantity: 2,
          status: "RESERVED",
        },
      ]) as never,
      { organizationId: "org-1", shipment }
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/No bookable/i);
  });
});
