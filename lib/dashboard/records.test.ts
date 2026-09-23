import { describe, expect, it } from "vitest";
import {
  canFulfillOrder,
  canFulfillOrderAction,
  canMarkDelivered,
  canMarkInTransit,
  canProcessOrder,
  canProcessOrderAction,
  canShipOrder,
  isShopifyConnected,
  isWatiConnected,
  itemSummary,
  orderActionLabel,
  orderStageMenu,
} from "@/lib/dashboard/records";

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
    expect(canFulfillOrder({ status: "READY" })).toBe(true);
    expect(canFulfillOrder({ status: "PROCESSING" })).toBe(true);
    expect(canFulfillOrder({ status: "FAILED" })).toBe(true);
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
    expect(orderStageMenu("BOOKED").completed.map((step) => step.action)).toEqual(["processing", "fulfill"]);
    expect(orderStageMenu("IN_TRANSIT").next?.action).toBe("delivered");
    expect(orderStageMenu("DELIVERED").hideActions).toBe(true);
    expect(orderStageMenu("DELIVERED").next).toBeNull();
    expect(orderStageMenu("CANCELLED").hideActions).toBe(true);
  });

  it("blocks booked, in transit, delivered, and cancelled orders", () => {
    expect(canShipOrder({ status: "BOOKED" })).toBe(false);
    expect(canShipOrder({ status: "SHIPPED" })).toBe(false);
    expect(canShipOrder({ status: "IN_TRANSIT" })).toBe(false);
    expect(canShipOrder({ status: "DELIVERED" })).toBe(false);
    expect(canShipOrder({ status: "CANCELLED" })).toBe(false);
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
