import { describe, expect, it } from "vitest";
import { mapGraphqlFulfillmentOrders, mapRestFulfillmentOrders } from "@/modules/shopify/fulfillment-orders";

describe("fulfillment order mapping", () => {
  it("maps GraphQL fulfillment orders including supportedActions", () => {
    const mapped = mapGraphqlFulfillmentOrders([
      {
        id: "gid://shopify/FulfillmentOrder/11",
        status: "OPEN",
        requestStatus: "UNSUBMITTED",
        supportedActions: [{ action: "CREATE_FULFILLMENT" }],
        assignedLocation: { location: { id: "gid://shopify/Location/1" } },
        lineItems: {
          nodes: [
            {
              id: "gid://shopify/FulfillmentOrderLineItem/101",
              remainingQuantity: 2,
              totalQuantity: 5,
              requiresShipping: true,
              lineItem: { id: "gid://shopify/LineItem/1" },
            },
          ],
        },
      },
    ]);
    expect(mapped[0]?.supportedActions).toEqual(["CREATE_FULFILLMENT"]);
    expect(mapped[0]?.lineItems[0]?.remainingQuantity).toBe(2);
  });

  it("maps REST fulfillment orders without using original quantity as remaining", () => {
    const mapped = mapRestFulfillmentOrders({
      fulfillment_orders: [
        {
          id: 11,
          status: "open",
          request_status: "unsubmitted",
          supported_actions: ["create_fulfillment"],
          assigned_location_id: 9,
          line_items: [{ id: 101, remaining_quantity: 2, quantity: 5, line_item_id: 1, requires_shipping: true }],
        },
      ],
    });
    expect(mapped[0]?.lineItems[0]?.remainingQuantity).toBe(2);
    expect(mapped[0]?.lineItems[0]?.totalQuantity).toBe(5);
  });
});
