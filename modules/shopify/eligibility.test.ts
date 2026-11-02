import { describe, expect, it } from "vitest";
import {
  evaluateShopifyOrderEligibility,
  remainingQuantityFromLine,
  remainingShippableForLine,
  type ShopifyEligibilityFulfillmentOrder,
} from "@/modules/shopify/eligibility";

const shippable = {
  id: "gid://shopify/LineItem/1",
  quantity: 5,
  fulfillable_quantity: 5,
  requires_shipping: true,
};

const openFo = (remaining: number, extras?: Partial<ShopifyEligibilityFulfillmentOrder>): ShopifyEligibilityFulfillmentOrder => ({
  id: "gid://shopify/FulfillmentOrder/11",
  status: "OPEN",
  requestStatus: "UNSUBMITTED",
  supportedActions: ["CREATE_FULFILLMENT"],
  assignedLocationId: "gid://shopify/Location/1",
  lineItems: [
    {
      id: "gid://shopify/FulfillmentOrderLineItem/101",
      remainingQuantity: remaining,
      totalQuantity: 5,
      requiresShipping: true,
      orderLineItemId: "gid://shopify/LineItem/1",
    },
  ],
  ...extras,
});

describe("evaluateShopifyOrderEligibility", () => {
  it("imports unfulfilled and partial orders with remaining shippable quantity", () => {
    const unfulfilled = evaluateShopifyOrderEligibility({
      fulfillment_status: "unfulfilled",
      line_items: [shippable],
    });
    expect(unfulfilled.eligibleForImport).toBe(true);
    expect(unfulfilled.exclusionReason).toBeNull();

    const partial = evaluateShopifyOrderEligibility({
      displayFulfillmentStatus: "PARTIALLY_FULFILLED",
      line_items: [
        { id: "a", quantity: 5, fulfillable_quantity: 2, requires_shipping: true },
        { id: "b", quantity: 2, fulfillable_quantity: 0, requires_shipping: true },
        { id: "c", quantity: 4, fulfillable_quantity: 4, requires_shipping: true },
      ],
    });
    expect(partial.eligibleForImport).toBe(true);
    expect(partial.remainingShippableQuantity).toBe(6);
    expect(partial.remainingLineItems.map((line) => line.remainingEligibleQuantity)).toEqual([2, 0, 4]);
    expect(partial.remainingLineItems.map((line) => line.originalQuantity)).toEqual([5, 2, 4]);
  });

  it("does not import fully fulfilled historical orders", () => {
    const result = evaluateShopifyOrderEligibility({
      displayFulfillmentStatus: "FULFILLED",
      line_items: [{ quantity: 1, fulfillable_quantity: 0, requires_shipping: true }],
    });
    expect(result.eligibleForImport).toBe(false);
    expect(result.exclusionReason).toBe("fulfilled");
  });

  it("does not import cancelled orders", () => {
    const result = evaluateShopifyOrderEligibility({
      cancelled_at: "2026-10-01",
      fulfillment_status: "unfulfilled",
      line_items: [shippable],
    });
    expect(result.eligibleForImport).toBe(false);
    expect(result.exclusionReason).toBe("cancelled");
    expect(result.eligibleForBooking).toBe(false);
  });

  it("does not import digital-only or zero-remaining orders", () => {
    expect(
      evaluateShopifyOrderEligibility({
        fulfillment_status: "unfulfilled",
        line_items: [{ quantity: 1, fulfillable_quantity: 1, requires_shipping: false }],
      }).eligibleForImport
    ).toBe(false);
    expect(
      evaluateShopifyOrderEligibility({
        fulfillment_status: "partial",
        line_items: [{ quantity: 3, fulfillable_quantity: 0, requires_shipping: true }],
      }).exclusionReason
    ).toBe("no_remaining_shippable_quantity");
  });

  it("never treats original quantity as remaining", () => {
    expect(remainingQuantityFromLine({ quantity: 5 })).toBeNull();
    expect(remainingShippableForLine({ quantity: 5 }).remainingQuantityKnown).toBe(false);
    expect(
      evaluateShopifyOrderEligibility({
        fulfillment_status: "unfulfilled",
        line_items: [{ quantity: 5, requires_shipping: true }],
      }).exclusionReason
    ).toBe("remaining_quantity_unknown");
  });

  it("blocks unknown fulfillment status", () => {
    const result = evaluateShopifyOrderEligibility({
      fulfillment_status: "mystery",
      line_items: [shippable],
    });
    expect(result.eligibleForImport).toBe(false);
    expect(result.exclusionReason).toBe("unknown_fulfillment_status");
  });

  it("imports on-hold and scheduled orders but does not allow booking", () => {
    const held = evaluateShopifyOrderEligibility(
      {
        displayFulfillmentStatus: "ON_HOLD",
        line_items: [shippable],
        fulfillmentOrders: [openFo(5, { status: "ON_HOLD", supportedActions: ["HOLD"] })],
      },
      { fulfillmentOrdersFetched: true }
    );
    expect(held.eligibleForImport).toBe(true);
    expect(held.eligibleForBooking).toBe(false);
    expect(held.bookingBlockReason).toMatch(/on hold/i);

    const scheduled = evaluateShopifyOrderEligibility({
      displayFulfillmentStatus: "SCHEDULED",
      line_items: [shippable],
    });
    expect(scheduled.eligibleForImport).toBe(true);
    expect(scheduled.eligibleForBooking).toBe(false);
  });

  it("requires CREATE_FULFILLMENT on live fulfillment orders before booking", () => {
    const blocked = evaluateShopifyOrderEligibility(
      { displayFulfillmentStatus: "UNFULFILLED", line_items: [shippable] },
      {
        fulfillmentOrdersFetched: true,
        fulfillmentOrders: [openFo(5, { supportedActions: ["HOLD"] })],
      }
    );
    expect(blocked.eligibleForBooking).toBe(false);

    const allowed = evaluateShopifyOrderEligibility(
      { displayFulfillmentStatus: "UNFULFILLED", line_items: [shippable] },
      { fulfillmentOrdersFetched: true, fulfillmentOrders: [openFo(2)] }
    );
    expect(allowed.eligibleForBooking).toBe(true);
    expect(allowed.bookableFulfillmentLines[0]?.remainingQuantity).toBe(2);
  });

  it("blocks booking when fulfillment orders cannot be loaded", () => {
    const result = evaluateShopifyOrderEligibility(
      { displayFulfillmentStatus: "UNFULFILLED", line_items: [shippable] },
      { fulfillmentOrdersFetched: true, fulfillmentOrders: [] }
    );
    expect(result.eligibleForBooking).toBe(false);
    expect(result.bookingBlockReason).toMatch(/inaccessible/i);
  });

  it("subtracts other PostBus allocations from remaining FO quantity", () => {
    const result = evaluateShopifyOrderEligibility(
      { displayFulfillmentStatus: "PARTIALLY_FULFILLED", line_items: [shippable] },
      {
        fulfillmentOrdersFetched: true,
        fulfillmentOrders: [openFo(4)],
        allocations: [
          {
            fulfillmentOrderLineItemId: "gid://shopify/FulfillmentOrderLineItem/101",
            quantity: 4,
            shipmentId: "other-ship",
            status: "BOOKED",
          },
        ],
        currentShipmentId: "this-ship",
      }
    );
    expect(result.eligibleForBooking).toBe(false);
    expect(result.bookableFulfillmentLines).toEqual([]);
  });

  it("keeps split-location fulfillment orders separate", () => {
    const result = evaluateShopifyOrderEligibility(
      { displayFulfillmentStatus: "UNFULFILLED", line_items: [shippable] },
      {
        fulfillmentOrdersFetched: true,
        fulfillmentOrders: [
          openFo(2, { id: "gid://shopify/FulfillmentOrder/1", assignedLocationId: "loc-a" }),
          {
            id: "gid://shopify/FulfillmentOrder/2",
            status: "OPEN",
            requestStatus: "UNSUBMITTED",
            supportedActions: ["CREATE_FULFILLMENT"],
            assignedLocationId: "loc-b",
            lineItems: [
              {
                id: "gid://shopify/FulfillmentOrderLineItem/202",
                remainingQuantity: 3,
                totalQuantity: 3,
                requiresShipping: true,
                orderLineItemId: "gid://shopify/LineItem/2",
              },
            ],
          },
        ],
      }
    );
    expect(result.bookableFulfillmentLines).toHaveLength(2);
    expect(result.bookableFulfillmentLines.map((line) => line.assignedLocationId)).toEqual(["loc-a", "loc-b"]);
    expect(result.remainingShippableQuantity).toBe(5);
  });
});
