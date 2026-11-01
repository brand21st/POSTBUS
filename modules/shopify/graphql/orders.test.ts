import { describe, expect, it, vi } from "vitest";
import type { ShopifyGraphqlDeps } from "@/modules/shopify/graphql/client";
import {
  fetchAppOrder,
  mapGraphqlOrder,
  restFulfillmentStatus,
  unfulfilledOrdersSearch,
  type GraphqlOrder,
} from "@/modules/shopify/graphql/orders";
import { mapShopifyFulfillmentStatus, shopifyLineItemImageUrl, shopifyLineItemWeightGrams } from "@/modules/shopify/orders";
import { shopifyFinancialStatus } from "@/modules/shopify/payment";

const money = (amount: string) => ({ shopMoney: { amount } });

const order: GraphqlOrder = {
  id: "gid://shopify/Order/5551234",
  legacyResourceId: "5551234",
  name: "#1042",
  email: "asha@example.com",
  cancelledAt: null,
  updatedAt: "2026-10-22T10:00:00Z",
  displayFinancialStatus: "PENDING",
  displayFulfillmentStatus: "PARTIALLY_FULFILLED",
  currencyCode: "INR",
  sourceName: "web",
  tags: ["cod"],
  paymentGatewayNames: ["Cash on Delivery (COD)"],
  subtotalPriceSet: money("1200.00"),
  totalDiscountsSet: money("0.00"),
  totalShippingPriceSet: money("80.00"),
  totalTaxSet: money("0.00"),
  totalPriceSet: money("1280.00"),
  totalOutstandingSet: money("1280.00"),
  shippingAddress: {
    name: "Asha Rao",
    firstName: "Asha",
    lastName: "Rao",
    company: null,
    address1: "12 MG Road",
    address2: "Flat 4",
    city: "Mysuru",
    province: "Karnataka",
    provinceCode: "KA",
    zip: "570001",
    country: "India",
    countryCodeV2: "IN",
    phone: "+919876543210",
  },
  billingAddress: null,
  customer: { firstName: "Asha", lastName: "Rao", email: "asha@example.com", phone: null },
  transactions: [{ kind: "SALE", status: "PENDING", gateway: "Cash on Delivery (COD)", amountSet: money("1280.00") }],
  lineItems: {
    pageInfo: { hasNextPage: false, endCursor: null },
    nodes: [
      {
        id: "gid://shopify/LineItem/1",
        title: "Cotton Saree",
        name: "Cotton Saree - Blue",
        variantTitle: "Blue",
        sku: "SAREE-BLU",
        quantity: 2,
        currentQuantity: 2,
        unfulfilledQuantity: 2,
        requiresShipping: true,
        originalUnitPriceSet: money("600.00"),
        image: { url: "https://cdn.shopify.com/saree.jpg" },
        variant: {
          legacyResourceId: "998877",
          image: null,
          inventoryItem: { measurement: { weight: { value: 0.45, unit: "KILOGRAMS" } } },
        },
      },
    ],
  },
};

describe("GraphQL order mapping", () => {
  it("produces the REST-shaped order the existing importer understands", () => {
    const remote = mapGraphqlOrder(order);
    expect(remote.id).toBe("5551234");
    expect(remote.name).toBe("#1042");
    expect(remote.shipping_address).toMatchObject({
      first_name: "Asha",
      address1: "12 MG Road",
      zip: "570001",
      province_code: "KA",
      country_code: "IN",
      phone: "+919876543210",
    });
    expect(remote.total_price).toBe("1280.00");
    expect(remote.total_shipping_price_set?.shop_money?.amount).toBe("80.00");
    expect(remote.transactions).toEqual([
      { kind: "sale", status: "pending", gateway: "Cash on Delivery (COD)", amount: "1280.00" },
    ]);
    expect(shopifyFinancialStatus(remote)).toBe("pending");
    expect(mapShopifyFulfillmentStatus(remote.fulfillment_status, remote.cancelled_at)).toBe("PARTIAL");
  });

  it("maps current totals and discounted unit price after an order edit", () => {
    const remote = mapGraphqlOrder({
      ...order,
      edited: true,
      currentTotalPriceSet: money("4296.00"),
      currentSubtotalPriceSet: money("4196.00"),
      currentTotalTaxSet: money("0.00"),
      lineItems: {
        pageInfo: { hasNextPage: false, endCursor: null },
        nodes: [
          {
            ...order.lineItems!.nodes![0],
            id: "gid://shopify/LineItem/1",
            quantity: 1,
            currentQuantity: 0,
            originalUnitPriceSet: money("314.70"),
            discountedUnitPriceSet: money("314.70"),
          },
          {
            ...order.lineItems!.nodes![0],
            id: "gid://shopify/LineItem/2",
            quantity: 1,
            currentQuantity: 1,
            originalUnitPriceSet: money("1049.00"),
            discountedUnitPriceSet: money("1049.00"),
          },
        ],
      },
    });
    expect(remote.edited).toBe(true);
    expect(remote.current_total_price).toBe("4296.00");
    expect(remote.line_items).toEqual([
      expect.objectContaining({ id: "gid://shopify/LineItem/1", current_quantity: 0, price: "314.70" }),
      expect.objectContaining({ id: "gid://shopify/LineItem/2", current_quantity: 1, price: "1049.00" }),
    ]);
  });

  it("keeps line-item weight, image, price and variant id usable by the importer", () => {
    const [item] = mapGraphqlOrder(order).line_items ?? [];
    expect(item).toMatchObject({
      title: "Cotton Saree",
      sku: "SAREE-BLU",
      quantity: 2,
      unfulfilled_quantity: 2,
      requires_shipping: true,
      price: "600.00",
      variant_id: "998877",
    });
    expect(shopifyLineItemWeightGrams(item)).toBe(450);
    expect(shopifyLineItemImageUrl(item)).toBe("https://cdn.shopify.com/saree.jpg");
  });

  it("maps fulfillment states and cancellations", () => {
    expect(restFulfillmentStatus("FULFILLED")).toBe("fulfilled");
    expect(restFulfillmentStatus("UNFULFILLED")).toBe("unfulfilled");
    expect(restFulfillmentStatus("ON_HOLD")).toBe("on_hold");
    expect(restFulfillmentStatus("WEIRD")).toBe("unknown");
    const cancelled = mapGraphqlOrder({ ...order, cancelledAt: "2026-10-22T11:00:00Z" });
    expect(mapShopifyFulfillmentStatus(cancelled.fulfillment_status, cancelled.cancelled_at)).toBe("CANCELLED");
  });

  it("builds the unfulfilled-orders search with an optional window", () => {
    expect(unfulfilledOrdersSearch()).toBe("status:open AND (fulfillment_status:unfulfilled OR fulfillment_status:partial)");
    expect(unfulfilledOrdersSearch("2026-08-24T00:00:00.000Z")).toContain("created_at:>='2026-08-24T00:00:00.000Z'");
  });

  it("pages remaining line items for large orders", async () => {
    const extraItem = { ...order.lineItems!.nodes![0], id: "gid://shopify/LineItem/2", sku: "SAREE-RED" };
    const responses = [
      { data: { order: { ...order, lineItems: { pageInfo: { hasNextPage: true, endCursor: "c1" }, nodes: order.lineItems!.nodes } } } },
      { data: { order: { lineItems: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [extraItem] } } } },
    ];
    const deps: ShopifyGraphqlDeps = {
      fetch: vi.fn(async () => new Response(JSON.stringify(responses.shift()), { status: 200 })),
      sleep: vi.fn(async () => undefined),
    };
    const remote = await fetchAppOrder("demo.myshopify.com", "tok", "5551234", deps);
    expect(remote?.line_items?.map((item) => item.sku)).toEqual(["SAREE-BLU", "SAREE-RED"]);
    const firstBody = JSON.parse(String(vi.mocked(deps.fetch).mock.calls[0][1].body)) as { variables: { id: string } };
    expect(firstBody.variables.id).toBe("gid://shopify/Order/5551234");
  });
});
