import { describe, expect, it } from "vitest";
import {
  customerPhone,
  labelTemplateName,
  salesInvoiceNumber,
  canFulfillOrder,
  canFulfillOrderAction,
  canMarkDelivered,
  canMarkInTransit,
  canProcessOrder,
  canProcessOrderAction,
  canShipOrder,
  fulfillSkipReason,
  isShopifyConnected,
  isWatiConnected,
  itemSummary,
  orderActionLabel,
  orderStageMenu,
  shopifyPendingBookingBlocked,
} from "@/lib/dashboard/records";

describe("customerPhone", () => {
  it("shows the 10-digit mobile even when the customer row has a 91 prefix", () => {
    expect(customerPhone({ customer: { phone: "919496821787" } })).toBe("9496821787");
    expect(customerPhone({ customer: { phone: "9496821787" } })).toBe("9496821787");
  });
});

describe("labelTemplateName", () => {
  it("uses the saved template name", () => {
    expect(
      labelTemplateName(
        { library: [{ id: "a9151c2f-0207-41ee-ad36-b94377af158a", name: "India Post" }] },
        "a9151c2f-0207-41ee-ad36-b94377af158a"
      )
    ).toBe("India Post");
    expect(labelTemplateName({ library: [] }, "a9151c2f-0207-41ee-ad36-b94377af158a")).toBe("Template");
  });
});

describe("salesInvoiceNumber", () => {
  it("uses the invoice number, then the order number, then a short id", () => {
    expect(salesInvoiceNumber({ invoiceNumber: "INV/26-27/00001", orderNumber: "#1001", id: "f0a76df8-e552-4f80-99b5-c69a02b5f97e" })).toBe(
      "INV/26-27/00001"
    );
    expect(salesInvoiceNumber({ invoiceNumber: null, orderNumber: "#2990", id: "f0a76df8-e552-4f80-99b5-c69a02b5f97e" })).toBe("#2990");
    expect(salesInvoiceNumber({ id: "f0a76df8-e552-4f80-99b5-c69a02b5f97e" })).toBe("f0a76df8");
  });
});

describe("itemSummary", () => {
  it("returns an em dash when there are no line items", () => {
    expect(itemSummary({ lineItems: [] })).toBe("—");
  });

  it("shows total quantity and product names", () => {
    expect(
      itemSummary({
        lineItems: [
          { title: "Blue Shirt", quantity: 2 },
          { title: "Mug", quantity: 1 },
        ],
      })
    ).toBe("3 items · Blue Shirt ×2, Mug ×1");
  });

  it("truncates extra products", () => {
    expect(
      itemSummary({
        lineItems: [
          { title: "A", quantity: 1 },
          { title: "B", quantity: 1 },
          { title: "C", quantity: 1 },
        ],
      })
    ).toBe("3 items · A ×1, B ×1 +1 more");
  });
});

describe("canShipOrder", () => {
  it("allows imported and ready orders to be fulfilled", () => {
    expect(canFulfillOrder({ status: "IMPORTED" })).toBe(true);
    expect(canFulfillOrder({ status: "IMPORTED", source: "WHATSAPP" })).toBe(false);
    expect(canFulfillOrder({ status: "READY", source: "WHATSAPP" })).toBe(true);
    expect(canFulfillOrder({ status: "READY" })).toBe(true);
    expect(canFulfillOrder({ status: "PROCESSING" })).toBe(true);
    expect(canFulfillOrder({ status: "PROCESSING", source: "WHATSAPP", payment_status: "PENDING" })).toBe(false);
    expect(canFulfillOrder({ status: "IMPORTED", source: "WHATSAPP" })).toBe(false);
    expect(canShipOrder({ status: "PROCESSING", source: "WHATSAPP", payment_status: "PENDING" })).toBe(false);
    expect(canShipOrder({ status: "READY", source: "WHATSAPP" })).toBe(true);
    expect(canFulfillOrder({ status: "PROCESSING", source: "MANUAL", payment_status: "PENDING" })).toBe(true);
    expect(canFulfillOrder({ status: "PROCESSING", source: "SHOPIFY", payment_status: "PENDING" })).toBe(false);
    expect(canFulfillOrder({ status: "PROCESSING", source: "SHOPIFY", payment_status: "PAID" })).toBe(true);
    expect(canFulfillOrder({ status: "PROCESSING", source: "SHOPIFY", payment_status: "COD" })).toBe(true);
    expect(canProcessOrder({ status: "READY", source: "SHOPIFY", payment_status: "PENDING" })).toBe(true);
    expect(canFulfillOrder({ status: "FAILED" })).toBe(true);
    expect(shopifyPendingBookingBlocked({ source: "SHOPIFY", payment_status: "PENDING" })).toBe(true);
  });

  it("allows processing only before a shipment is booked", () => {
    expect(canProcessOrder({ status: "IMPORTED" })).toBe(true);
    expect(canProcessOrder({ status: "READY" })).toBe(true);
    expect(canProcessOrder({ status: "PROCESSING" })).toBe(false);
    expect(canProcessOrder({ status: "BOOKED" })).toBe(false);
  });

  it("labels the action button from the next stage", () => {
    expect(orderActionLabel("READY")).toBe("Ship");
    expect(orderActionLabel("PROCESSING")).toBe("Fulfill · Booked / packed");
    expect(orderActionLabel("BOOKED")).toBe("In transit");
    expect(orderActionLabel("IN_TRANSIT")).toBe("Delivered");
    expect(orderActionLabel("DELIVERED")).toBe("Delivered");
  });

  it("shows completed stages and only the next action", () => {
    expect(orderStageMenu("READY")).toEqual({
      hideActions: false,
      completed: [],
      next: { action: "processing", label: "Ship" },
    });
    expect(orderStageMenu("PROCESSING").completed.map((step) => step.label)).toEqual(["Processing"]);
    expect(orderStageMenu("PROCESSING").completed.map((step) => step.action)).toEqual(["processing"]);
    expect(orderStageMenu("PROCESSING").next?.action).toBe("fulfill");
    expect(orderStageMenu("PROCESSING", "SHOPIFY", "PENDING").next).toBeNull();
    expect(orderStageMenu("READY", "SHOPIFY", "PENDING").next?.action).toBe("processing");
    expect(orderStageMenu("BOOKED").completed.map((step) => step.action)).toEqual(["processing", "fulfill"]);
    expect(orderStageMenu("IN_TRANSIT").next?.action).toBe("delivered");
    expect(orderStageMenu("DELIVERED").hideActions).toBe(true);
    expect(orderStageMenu("DELIVERED").next).toBeNull();
    expect(orderStageMenu("CANCELLED").hideActions).toBe(true);
    expect(orderStageMenu("IMPORTED", "WHATSAPP").hideActions).toBe(true);
    expect(orderStageMenu("IMPORTED", "WHATSAPP").next).toBeNull();
    expect(orderStageMenu("READY", "WHATSAPP").hideActions).toBe(false);
  });

  it("blocks booked, in transit, delivered, and cancelled orders", () => {
    expect(canShipOrder({ status: "BOOKED" })).toBe(false);
    expect(canShipOrder({ status: "SHIPPED" })).toBe(false);
    expect(canShipOrder({ status: "IN_TRANSIT" })).toBe(false);
    expect(canShipOrder({ status: "DELIVERED" })).toBe(false);
    expect(canShipOrder({ status: "CANCELLED" })).toBe(false);
  });

  it("explains why Booked / packed cannot run", () => {
    expect(fulfillSkipReason({ status: "PROCESSING", order_number: "1020" })).toBeNull();
    expect(
      fulfillSkipReason({
        status: "PROCESSING",
        source: "SHOPIFY",
        payment_status: "PENDING",
        order_number: "1042",
      })
    ).toContain("Prepaid or COD");
    expect(
      fulfillSkipReason({
        status: "PROCESSING",
        source: "WHATSAPP",
        payment_status: "PENDING",
        order_number: "PB-11219",
      })
    ).toContain("READY");
    expect(fulfillSkipReason({ status: "DELIVERED", order_number: "1024" })).toBe(
      "Order #1024 cannot be marked Booked / packed because it is already Delivered."
    );
    expect(fulfillSkipReason({ status: "CANCELLED", order_number: "1025" })).toBe(
      "Order #1025 cannot be marked Booked / packed because it is Cancelled."
    );
    expect(fulfillSkipReason({ status: "BOOKED", order_number: "1026" })).toBe(
      "Order #1026 cannot be marked Booked / packed because it is already Booked."
    );
  });

  it("enables every shipment action when Wati is connected", () => {
    expect(isWatiConnected({ wati: { provider: "wati", status: "CONNECTED" } })).toBe(true);
    expect(isWatiConnected({ wati: { provider: "wati", status: "NOT_CONNECTED" } })).toBe(false);
    expect(canProcessOrderAction({ status: "BOOKED" }, true)).toBe(true);
    expect(canFulfillOrderAction({ status: "IN_TRANSIT" }, true)).toBe(true);
    expect(canMarkInTransit({ status: "BOOKED" }, true)).toBe(true);
    expect(canMarkInTransit({ status: "BOOKED" }, false)).toBe(false);
    expect(canMarkInTransit({ status: "DELIVERED" }, true)).toBe(false);
    expect(canMarkDelivered({ status: "IN_TRANSIT" }, true)).toBe(true);
    expect(canMarkDelivered({ status: "CANCELLED" }, true)).toBe(false);
    expect(canProcessOrderAction({ status: "CANCELLED" }, true)).toBe(false);
    expect(canFulfillOrderAction({ status: "CANCELLED" }, true)).toBe(false);
  });

  it("enables in transit and delivered when Shopify is connected", () => {
    expect(isShopifyConnected({ shopify: { provider: "shopify", status: "CONNECTED" } })).toBe(true);
    expect(canMarkInTransit({ status: "BOOKED" }, true)).toBe(true);
    expect(canMarkDelivered({ status: "IN_TRANSIT" }, true)).toBe(true);
  });
});
