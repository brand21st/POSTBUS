import { describe, expect, it } from "vitest";
import { canShipOrder, itemSummary } from "@/lib/dashboard/records";

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
  it("allows imported and ready orders", () => {
    expect(canShipOrder({ status: "IMPORTED" })).toBe(true);
    expect(canShipOrder({ status: "READY" })).toBe(true);
    expect(canShipOrder({ status: "FAILED" })).toBe(true);
  });

  it("blocks queued, booked, shipped, delivered, and cancelled orders", () => {
    expect(canShipOrder({ status: "PROCESSING" })).toBe(false);
    expect(canShipOrder({ status: "BOOKED" })).toBe(false);
    expect(canShipOrder({ status: "SHIPPED" })).toBe(false);
    expect(canShipOrder({ status: "DELIVERED" })).toBe(false);
    expect(canShipOrder({ status: "CANCELLED" })).toBe(false);
  });
});
