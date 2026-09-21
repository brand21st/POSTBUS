import { describe, expect, it } from "vitest";
import { encryptSecret } from "@/lib/security/crypto";
import {
  isUnfulfilledShopifyOrder,
  mapShopifyFulfillmentStatus,
  mapShopifyPaymentStatus,
  shopifyCustomerName,
  shopifyFulfillmentPayload,
  shopifyOrderNumber,
  shopifyPhone,
  shopifyPincode,
  shopifyReadyToSync,
} from "@/modules/shopify/orders";

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
