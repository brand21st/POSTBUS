import { describe, expect, it, vi } from "vitest";
import { encryptSecret } from "@/lib/security/crypto";
import {
  canReportShopifyFulfillmentProgress,
  fulfillShopifyShipment,
  importShopifyWebhookOrder,
  isUnfulfilledShopifyOrder,
  mapShopifyCollectable,
  mapShopifyFulfillmentStatus,
  mapShopifyPaymentStatus,
  nextShopifyOrderStatus,
  parseShopifyProgressReported,
  shopifyCustomerName,
  shopifyFulfillmentEventStatus,
  shopifyFulfillmentGid,
  shopifyFulfillmentOrderGid,
  shopifyFulfillmentPayload,
  shopifyNumericId,
  shopifyOrderGid,
  shopifyTrackingInfo,
  nextShopifyStageTags,
  shopifyOrderNumber,
  shopifyLineItemTitle,
  shopifyLineItemWeightGrams,
  shopifyDimensionToCm,
  shopifyParcelFromLineItems,
  shopifyShipmentParcelExtras,
  shopifyResolvedShipmentDims,
  parseShopifyVariantShippingNode,
  applyShopifyProductShippingToLineItem,
  shopifyLineItemImageUrl,
  shopifyImageLookupKey,
  applyShopifyCatalogToLineItems,
  shopifyCatalogImageForLineItem,
  indexShopifyProductsForLineItemImages,
  shopifyStageFromJobProgress,
  shopifyRemoteSignalsProcessing,
  shouldNotifyWatiForShopifyProcessing,
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
  self.delete = () => self;
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

  it("maps Shopify outstanding balance onto remaining COD", () => {
    expect(
      mapShopifyCollectable(
        { total_price: "1000.00", total_outstanding: "400.00" },
        "PARTIAL"
      )
    ).toEqual({
      paymentStatus: "PARTIAL",
      amountPaid: 600,
      codAmount: 400,
    });
    expect(mapShopifyCollectable({ total_price: "499.00" }, "COD")).toEqual({
      paymentStatus: "COD",
      amountPaid: 0,
      codAmount: 499,
    });
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

  it("stores the Shopify product name, including the variant", () => {
    expect(shopifyLineItemTitle({ name: "Cotton Shirt - Black / M", title: "Cotton Shirt" })).toBe(
      "Cotton Shirt - Black / M"
    );
    expect(shopifyLineItemTitle({ title: "Cotton Shirt", variant_title: "Black / M" })).toBe(
      "Cotton Shirt — Black / M"
    );
    expect(shopifyLineItemTitle({ title: "Mug" })).toBe("Mug");
  });

  it("converts Shopify product weight into per-unit grams", () => {
    expect(shopifyLineItemWeightGrams({ grams: 200 })).toBe(200);
    expect(shopifyLineItemWeightGrams({ weight: { value: 0.5, unit: "KILOGRAMS" } })).toBe(500);
    expect(shopifyLineItemWeightGrams({ weight: 250, weight_unit: "g" })).toBe(250);
    expect(shopifyLineItemWeightGrams({ weight: 1, weight_unit: "lb" })).toBe(454);
    expect(shopifyLineItemWeightGrams({ weight: 1, weight_unit: "oz" })).toBe(28);
    expect(shopifyLineItemWeightGrams({ grams: 0.5 })).toBe(500);
    expect(shopifyLineItemWeightGrams({ grams: 0 })).toBeNull();
    expect(shopifyLineItemWeightGrams({})).toBeNull();
    expect(
      shopifyLineItemWeightGrams({ grams: 0, variant: { weight: 0.25, weight_unit: "kg" } })
    ).toBe(250);
  });

  it("normalizes Indian phone and pincode values", () => {
    expect(shopifyPhone("+91 98765 43210")).toBe("919876543210");
    expect(shopifyPhone("")).toBe("0000000000");
    expect(shopifyPincode("560001")).toBe("560001");
    expect(shopifyPincode("12")).toBe("120000");
  });

  it("keeps processing and later statuses when Shopify is still unfulfilled", () => {
    expect(
      nextShopifyOrderStatus({ fulfillmentStatus: "UNFULFILLED", currentStatus: "PROCESSING" })
    ).toBe("PROCESSING");
    expect(nextShopifyOrderStatus({ fulfillmentStatus: "UNFULFILLED", currentStatus: "READY" })).toBe("READY");
    expect(nextShopifyOrderStatus({ fulfillmentStatus: "FULFILLED", currentStatus: "PROCESSING" })).toBe("SHIPPED");
    expect(nextShopifyOrderStatus({ fulfillmentStatus: "FULFILLED", currentStatus: "BOOKED" })).toBe("BOOKED");
    expect(nextShopifyOrderStatus({ fulfillmentStatus: "FULFILLED", currentStatus: "IN_TRANSIT" })).toBe(
      "IN_TRANSIT"
    );
    expect(nextShopifyOrderStatus({ fulfillmentStatus: "UNFULFILLED", cancelledAt: "2026-09-22" })).toBe(
      "CANCELLED"
    );
  });

  it("marks open fulfillment orders as reportable for in-progress", () => {
    expect(canReportShopifyFulfillmentProgress("open")).toBe(true);
    expect(canReportShopifyFulfillmentProgress("in_progress")).toBe(true);
    expect(canReportShopifyFulfillmentProgress("closed")).toBe(false);
    expect(shopifyFulfillmentOrderGid(5014440902678)).toBe("gid://shopify/FulfillmentOrder/5014440902678");
    expect(shopifyFulfillmentGid(3286469410838)).toBe("gid://shopify/Fulfillment/3286469410838");
    expect(shopifyNumericId("gid://shopify/FulfillmentOrder/11")).toBe(11);
    expect(shopifyOrderGid(18799791538429)).toBe("gid://shopify/Order/18799791538429");
    expect(shopifyOrderGid("gid://shopify/Order/1")).toBe("gid://shopify/Order/1");
    expect(nextShopifyStageTags(["vip", "postbus-booked"], "processing")).toEqual([
      "vip",
      "postbus-processing",
    ]);
    expect(nextShopifyStageTags("vip, postbus-processing", "in_transit")).toEqual([
      "vip",
      "postbus-in-transit",
    ]);
    expect(shopifyFulfillmentEventStatus("booked")).toBe("confirmed");
    expect(shopifyFulfillmentEventStatus("in_transit")).toBe("in_transit");
    expect(shopifyFulfillmentEventStatus("delivered")).toBe("delivered");
    expect(shopifyStageFromJobProgress({ event: "processing" })).toBe("processing");
    expect(shopifyStageFromJobProgress({ event: "booked" })).toBe("booked");
    expect(shopifyStageFromJobProgress({})).toBeNull();
    expect(shopifyRemoteSignalsProcessing({ tags: "vip, postbus-processing" })).toBe(true);
    expect(shopifyRemoteSignalsProcessing({ tags: ["ready"] })).toBe(false);
    expect(shouldNotifyWatiForShopifyProcessing("READY")).toBe(true);
    expect(shouldNotifyWatiForShopifyProcessing("PROCESSING")).toBe(true);
    expect(shouldNotifyWatiForShopifyProcessing("BOOKED")).toBe(false);
  });

  it("parses Shopify progress-reported webhooks", () => {
    expect(
      parseShopifyProgressReported({
        fulfillment_order: { id: 9, order_id: 1042, status: "in_progress" },
      })
    ).toEqual({ status: "in_progress", sourceOrderId: "1042", inProgress: true });
    expect(parseShopifyProgressReported({ order_id: 88, status: "open" }).inProgress).toBe(false);
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
    expect(payload.fulfillment.lineItemsByFulfillmentOrder).toEqual([
      { fulfillmentOrderId: "gid://shopify/FulfillmentOrder/11" },
      { fulfillmentOrderId: "gid://shopify/FulfillmentOrder/13" },
    ]);
    expect(payload.fulfillment.trackingInfo).toEqual({
      company: "PostBus",
      number: "CL556974704IN",
      url: "https://www.postbus.in/track?tracking=CL556974704IN",
    });
    expect(payload.fulfillment.notifyCustomer).toBe(true);
  });

  it("always sends the public PostBus tracking page with the article id", () => {
    const payload = shopifyFulfillmentPayload({
      fulfillmentOrders: [{ id: 11, status: "open" }],
      trackingNumber: "CL556974704IN",
    });
    expect(payload.fulfillment.trackingInfo?.company).toBe("PostBus");
    expect(payload.fulfillment.trackingInfo?.number).toBe("CL556974704IN");
    expect(payload.fulfillment.trackingInfo?.url).toBe(
      "https://www.postbus.in/track?tracking=CL556974704IN"
    );
    expect(payload.fulfillment.trackingInfo?.url).not.toContain("indiapost.gov.in");
    expect(payload.fulfillment.trackingInfo?.url).not.toContain("localhost");
  });

  it("does not invent Shopify tracking info when the AWB is empty", () => {
    expect(shopifyTrackingInfo("")).toBeNull();
    expect(shopifyTrackingInfo("   ")).toBeNull();
    expect(
      shopifyFulfillmentPayload({
        fulfillmentOrders: [{ id: 11, status: "open" }],
        trackingNumber: "",
      }).fulfillment.trackingInfo
    ).toBeNull();
  });

  it("gives each shipment AWB its own PostBus tracking URL", () => {
    const first = shopifyTrackingInfo("EM123456789IN");
    const second = shopifyTrackingInfo("CL556974704IN");
    expect(first?.url).toBe("https://www.postbus.in/track?tracking=EM123456789IN");
    expect(second?.url).toBe("https://www.postbus.in/track?tracking=CL556974704IN");
    expect(first?.url).not.toBe(second?.url);
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
      { enqueueBooking: false, runBookingNow: false }
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
      { enqueueBooking: false, runBookingNow: false }
    );
  });
});

function trackedOrderClient(options: {
  existingOrderId?: string | null;
  orderStatus?: string;
  shipments?: Array<{ status: string }>;
  lineItems?: unknown;
  inserts: Array<{ table: string; payload: unknown }>;
  deletes: string[];
  updates?: Array<{ table: string; payload: unknown }>;
}) {
  return {
    from: vi.fn((table: string) => {
      let data: unknown = {};
      if (table === "external_order_references") {
        data = options.existingOrderId ? { order_id: options.existingOrderId } : null;
      } else if (table === "orders") {
        data = { id: options.existingOrderId ?? "ord-1", status: options.orderStatus ?? "READY" };
      } else if (table === "customers") data = { id: "cust-1" };
      else if (table === "addresses") data = { id: "addr-1" };
      else if (table === "shipments") data = options.shipments ?? [];
      else if (table === "order_line_items") data = options.lineItems ?? {};
      const payload = { data, error: null };
      const self: Record<string, unknown> = {};
      self.select = () => self;
      self.eq = () => self;
      self.insert = (row: unknown) => {
        options.inserts.push({ table, payload: row });
        return self;
      };
      self.update = (row: unknown) => {
        options.updates?.push({ table, payload: row });
        return self;
      };
      self.upsert = () => self;
      self.delete = () => {
        options.deletes.push(table);
        return self;
      };
      self.maybeSingle = async () => payload;
      self.single = async () => payload;
      self.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
        Promise.resolve(payload).then(resolve, reject);
      return self;
    }),
  };
}

describe("shopify line item images", () => {
  it("normalizes titles so catalog matching ignores colon spacing", () => {
    expect(shopifyImageLookupKey("RADHA ORANGE : SEMI BANARASI SAREE")).toBe(
      shopifyImageLookupKey("RADHA ORANGE:SEMI BANARASI SAREE")
    );
  });

  it("reads the image URL from the Shopify line item payload", () => {
    expect(
      shopifyLineItemImageUrl({
        title: "Saree",
        image: { src: "https://cdn.shopify.com/s/files/saree.jpg" },
      })
    ).toBe("https://cdn.shopify.com/s/files/saree.jpg");
  });

  it("falls back to the variant product image", () => {
    expect(
      shopifyLineItemImageUrl(
        { title: "Saree", variant_id: 22 },
        {
          image: { src: "https://cdn.shopify.com/featured.jpg" },
          images: [{ id: 9, src: "https://cdn.shopify.com/variant.jpg" }],
          variants: [{ id: 22, image_id: 9 }],
        }
      )
    ).toBe("https://cdn.shopify.com/variant.jpg");
  });

  it("stores the image URL when a Shopify order is imported", async () => {
    const inserts: Array<{ table: string; payload: unknown }> = [];
    const supabase = trackedOrderClient({ inserts, deletes: [] });
    await upsertShopifyOrder(supabase as never, {
      organizationId: "org-1",
      shopDomain: "demo.myshopify.com",
      remote: {
        ...remoteOrder,
        line_items: [
          {
            title: "Kurta",
            quantity: 1,
            price: "499",
            grams: 200,
            image: { src: "https://cdn.shopify.com/kurta.jpg" },
          },
        ],
      },
    });
    const items = inserts.find((row) => row.table === "order_line_items");
    expect(items?.payload).toEqual([
      expect.objectContaining({ image_url: "https://cdn.shopify.com/kurta.jpg" }),
    ]);
  });

  it("applies catalog images onto order line items missing image_url", () => {
    const catalog = indexShopifyProductsForLineItemImages([
      {
        title: "Cotton Kurta",
        image: { src: "https://cdn.shopify.com/kurta.jpg" },
        variants: [{ sku: "K-1", title: "Default Title" }],
      },
    ]);
    const items = [{ id: "li-1", title: "Cotton Kurta", sku: "K-1", image_url: null }];
    const patches = applyShopifyCatalogToLineItems(items, catalog);
    expect(items[0]?.image_url).toBe("https://cdn.shopify.com/kurta.jpg");
    expect(patches).toEqual([{ id: "li-1", src: "https://cdn.shopify.com/kurta.jpg" }]);
  });

  it("matches catalog images by SKU and product title", () => {
    const catalog = indexShopifyProductsForLineItemImages([
      {
        title: "Kurta",
        image: { src: "https://cdn.shopify.com/kurta.jpg" },
        variants: [{ sku: "K-1", title: "Default Title" }],
      },
      {
        title: "Saree",
        images: [
          { id: 1, src: "https://cdn.shopify.com/saree.jpg" },
          { id: 2, src: "https://cdn.shopify.com/saree-red.jpg" },
        ],
        variants: [{ sku: "S-RED", title: "Red", image_id: 2 }],
      },
    ]);
    expect(shopifyCatalogImageForLineItem("Kurta", "K-1", catalog)).toBe("https://cdn.shopify.com/kurta.jpg");
    expect(shopifyCatalogImageForLineItem("Kurta", null, catalog)).toBe("https://cdn.shopify.com/kurta.jpg");
    expect(shopifyCatalogImageForLineItem("Saree - Red", null, catalog)).toBe(
      "https://cdn.shopify.com/saree-red.jpg"
    );
    expect(
      shopifyCatalogImageForLineItem("RADHA ORANGE:SEMI BANARASI SAREE", null, {
        ...indexShopifyProductsForLineItemImages([
          {
            title: "RADHA ORANGE : SEMI BANARASI SAREE",
            image: { src: "https://cdn.shopify.com/radha.jpg" },
          },
        ]),
      })
    ).toBe("https://cdn.shopify.com/radha.jpg");
  });

  it("fills a missing image on a booked order without rewriting line items", async () => {
    const updates: Array<{ table: string; payload: unknown }> = [];
    const deletes: string[] = [];
    await upsertShopifyOrder(
      trackedOrderClient({
        existingOrderId: "ord-1",
        orderStatus: "BOOKED",
        lineItems: [{ id: "li-1", title: "Kurta", sku: null, image_url: null }],
        inserts: [],
        deletes,
        updates,
      }) as never,
      {
        organizationId: "org-1",
        shopDomain: "demo.myshopify.com",
        remote: {
          ...remoteOrder,
          line_items: [
            {
              title: "Kurta",
              quantity: 1,
              price: "499",
              image: { src: "https://cdn.shopify.com/kurta.jpg" },
            },
          ],
        },
      }
    );
    expect(deletes).not.toContain("order_line_items");
    expect(updates).toEqual(
      expect.arrayContaining([
        { table: "order_line_items", payload: { image_url: "https://cdn.shopify.com/kurta.jpg" } },
      ])
    );
  });
});

describe("shopify line item weight persistence", () => {
  it("stores converted grams when a Shopify order is imported", async () => {
    const inserts: Array<{ table: string; payload: unknown }> = [];
    const supabase = trackedOrderClient({ inserts, deletes: [] });
    const result = await upsertShopifyOrder(supabase as never, {
      organizationId: "org-1",
      shopDomain: "demo.myshopify.com",
      remote: {
        ...remoteOrder,
        line_items: [{ title: "Kurta", quantity: 2, price: "499", grams: 0.5 }],
      },
    });
    expect(result.imported).toBe(true);
    const items = inserts.find((row) => row.table === "order_line_items");
    expect(items?.payload).toEqual([
      expect.objectContaining({ title: "Kurta", quantity: 2, weight_grams: 500 }),
    ]);
  });

  it("refreshes line-item weight when an open Shopify order is updated", async () => {
    const inserts: Array<{ table: string; payload: unknown }> = [];
    const deletes: string[] = [];
    const supabase = trackedOrderClient({
      existingOrderId: "ord-1",
      orderStatus: "READY",
      inserts,
      deletes,
    });
    const result = await upsertShopifyOrder(supabase as never, {
      organizationId: "org-1",
      shopDomain: "demo.myshopify.com",
      remote: {
        ...remoteOrder,
        line_items: [{ title: "Kurta", quantity: 1, price: "499", weight: { value: 0.5, unit: "KILOGRAMS" } }],
      },
    });
    expect(result.updated).toBe(true);
    expect(deletes).toContain("order_line_items");
    const items = inserts.find((row) => row.table === "order_line_items");
    expect(items?.payload).toEqual([expect.objectContaining({ weight_grams: 500 })]);
  });

  it("keeps a manually edited product weight when Shopify updates the order", async () => {
    const inserts: Array<{ table: string; payload: unknown }> = [];
    const supabase = trackedOrderClient({
      existingOrderId: "ord-1",
      orderStatus: "READY",
      lineItems: [{ title: "Kurta", sku: null, weight_grams: 800, weight_edited: true }],
      inserts,
      deletes: [],
    });
    const result = await upsertShopifyOrder(supabase as never, {
      organizationId: "org-1",
      shopDomain: "demo.myshopify.com",
      remote: {
        ...remoteOrder,
        line_items: [{ title: "Kurta", quantity: 1, price: "499", grams: 200 }],
      },
    });
    expect(result.updated).toBe(true);
    const items = inserts.find((row) => row.table === "order_line_items");
    expect(items?.payload).toEqual([
      expect.objectContaining({ title: "Kurta", weight_grams: 800, weight_edited: true }),
    ]);
  });

  it("leaves line items alone once a shipment is queued or the order is booked", async () => {
    const queued = { inserts: [] as Array<{ table: string; payload: unknown }>, deletes: [] as string[] };
    await upsertShopifyOrder(
      trackedOrderClient({
        existingOrderId: "ord-1",
        orderStatus: "READY",
        shipments: [{ status: "QUEUED" }],
        ...queued,
      }) as never,
      {
        organizationId: "org-1",
        shopDomain: "demo.myshopify.com",
        remote: remoteOrder,
      }
    );
    expect(queued.deletes).not.toContain("order_line_items");

    const booked = { inserts: [] as Array<{ table: string; payload: unknown }>, deletes: [] as string[] };
    await upsertShopifyOrder(
      trackedOrderClient({
        existingOrderId: "ord-1",
        orderStatus: "BOOKED",
        ...booked,
      }) as never,
      {
        organizationId: "org-1",
        shopDomain: "demo.myshopify.com",
        remote: remoteOrder,
      }
    );
    expect(booked.deletes).not.toContain("order_line_items");
  });
});

describe("shopify product shipping hydrate", () => {
  it("converts Shopify dimension strings and JSON into centimetres", () => {
    expect(shopifyDimensionToCm(20)).toBe(20);
    expect(shopifyDimensionToCm("10 in")).toBe(25.4);
    expect(shopifyDimensionToCm("50", "mm")).toBe(5);
    expect(shopifyDimensionToCm({ value: 8, unit: "INCHES" })).toBe(20.32);
    expect(shopifyDimensionToCm('{"value":12,"unit":"CENTIMETERS"}')).toBe(12);
  });

  it("uses variant product weight when order grams are zero", () => {
    const item = applyShopifyProductShippingToLineItem(
      { title: "Kurta", quantity: 2, grams: 0, variant_id: 22, product_id: 9 },
      {
        id: 9,
        variants: [{ id: 22, grams: 0, weight: 0.5, weight_unit: "kg" }],
      }
    );
    expect(shopifyLineItemWeightGrams(item)).toBe(500);
  });

  it("clamps Shopify box size to India Post parcel limits", () => {
    expect(
      shopifyParcelFromLineItems([
        { title: "Kurta", quantity: 1, grams: 400, length_cm: 10, width_cm: 8, height_cm: 5 },
      ])
    ).toEqual({ weightGrams: 400, lengthCm: 14, widthCm: 9, heightCm: 5 });
  });

  it("takes the max box across line items and sums weight", () => {
    expect(
      shopifyParcelFromLineItems([
        { title: "A", quantity: 2, grams: 200, length_cm: 20, width_cm: 10, height_cm: 8 },
        { title: "B", quantity: 1, grams: 300, length_cm: 30, width_cm: 12, height_cm: 4 },
      ])
    ).toEqual({ weightGrams: 700, lengthCm: 30, widthCm: 12, heightCm: 8 });
  });

  it("keeps size empty when Shopify has weight but no dimensions", () => {
    expect(shopifyParcelFromLineItems([{ title: "Kurta", quantity: 1, grams: 500 }])).toEqual({
      weightGrams: 500,
      lengthCm: null,
      widthCm: null,
      heightCm: null,
    });
    expect(shopifyShipmentParcelExtras([{ title: "Kurta", quantity: 1, grams: 500 }])).toEqual({});
  });

  it("reads aliased GraphQL metafields and prefers them over workspace defaults", () => {
    expect(
      parseShopifyVariantShippingNode({
        id: "gid://shopify/ProductVariant/22",
        customLength: { value: "10 in" },
        customWidth: { value: "15" },
        customHeight: { value: "10" },
      })
    ).toEqual({ grams: null, weight: null, lengthCm: 25.4, widthCm: 15, heightCm: 10 });
    expect(parseShopifyVariantShippingNode({ id: "gid://shopify/ProductVariant/1" })).toEqual({
      grams: null,
      weight: null,
      lengthCm: null,
      widthCm: null,
      heightCm: null,
    });
    const metafieldDims = shopifyResolvedShipmentDims(
      [{ title: "Kurta", quantity: 1, grams: 500, length_cm: 20, width_cm: 15, height_cm: 10 }],
      { lengthCm: 30, widthCm: 20, heightCm: 12, weightGrams: 800 }
    );
    expect(metafieldDims).toEqual({ lengthCm: 20, widthCm: 15, heightCm: 10 });
    expect(
      shopifyResolvedShipmentDims([{ title: "Kurta", quantity: 1, grams: 500 }], {
        lengthCm: 30,
        widthCm: 20,
        heightCm: 12,
        weightGrams: 800,
      })
    ).toEqual({ lengthCm: 30, widthCm: 20, heightCm: 12 });
  });

  it("does not invent Shopify saved-package dimensions when none were fetched", () => {
    expect(shopifyResolvedShipmentDims([{ title: "Kurta", quantity: 1, grams: 200 }])).toEqual({});
  });

  it("stores converted grams when order grams are zero and the variant has weight", async () => {
    const inserts: Array<{ table: string; payload: unknown }> = [];
    const result = await upsertShopifyOrder(trackedOrderClient({ inserts, deletes: [] }) as never, {
      organizationId: "org-1",
      shopDomain: "demo.myshopify.com",
      remote: {
        ...remoteOrder,
        line_items: [
          {
            title: "Kurta",
            quantity: 2,
            price: "499",
            grams: 0,
            variant: { weight: 0.5, weight_unit: "kg" },
          },
        ],
      },
    });
    expect(result.imported).toBe(true);
    const items = inserts.find((row) => row.table === "order_line_items");
    expect(items?.payload).toEqual([
      expect.objectContaining({ title: "Kurta", quantity: 2, weight_grams: 500 }),
    ]);
  });

  it("passes clamped Shopify dimensions into shipment create", async () => {
    createShipmentsForOrders.mockClear();
    const result = await upsertShopifyOrder(newOrderClient() as never, {
      organizationId: "org-1",
      shopDomain: "demo.myshopify.com",
      remote: {
        ...remoteOrder,
        line_items: [
          {
            title: "Kurta",
            quantity: 1,
            price: "499",
            grams: 450,
            length_cm: 10,
            width_cm: 8,
            height_cm: 5,
          },
        ],
      },
      createShipment: true,
      enqueueBooking: false,
    });
    expect(result.imported).toBe(true);
    expect(createShipmentsForOrders).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: "org-1" }),
      ["ord-1"],
      { enqueueBooking: false, runBookingNow: false, lengthCm: 14, widthCm: 9, heightCm: 5 }
    );
  });

  it("writes Shopify dimensions onto an unlocked draft shipment", async () => {
    const updates: Array<{ table: string; payload: unknown }> = [];
    const result = await upsertShopifyOrder(
      trackedOrderClient({
        existingOrderId: "ord-1",
        orderStatus: "READY",
        shipments: [{ id: "shp-1", status: "DRAFT", length_cm: null, width_cm: null, height_cm: null }],
        inserts: [],
        deletes: [],
        updates,
      }) as never,
      {
        organizationId: "org-1",
        shopDomain: "demo.myshopify.com",
        remote: {
          ...remoteOrder,
          line_items: [
            {
              title: "Kurta",
              quantity: 1,
              price: "499",
              grams: 500,
              length_cm: 20,
              width_cm: 15,
              height_cm: 10,
            },
          ],
        },
      }
    );
    expect(result.updated).toBe(true);
    expect(updates).toEqual(
      expect.arrayContaining([
        {
          table: "shipments",
          payload: { length_cm: 20, width_cm: 15, height_cm: 10, weight_grams: 500 },
        },
      ])
    );
  });

  it("does not overwrite a merchant-saved box size or a queued shipment", async () => {
    const saved: Array<{ table: string; payload: unknown }> = [];
    await upsertShopifyOrder(
      trackedOrderClient({
        existingOrderId: "ord-1",
        orderStatus: "READY",
        shipments: [{ id: "shp-1", status: "DRAFT", length_cm: 30, width_cm: 20, height_cm: 12 }],
        inserts: [],
        deletes: [],
        updates: saved,
      }) as never,
      {
        organizationId: "org-1",
        shopDomain: "demo.myshopify.com",
        remote: {
          ...remoteOrder,
          line_items: [{ title: "Kurta", quantity: 1, price: "499", grams: 500, length_cm: 20, width_cm: 15, height_cm: 10 }],
        },
      }
    );
    expect(saved.filter((row) => row.table === "shipments")).toEqual([
      { table: "shipments", payload: { weight_grams: 500 } },
    ]);

    const queued: Array<{ table: string; payload: unknown }> = [];
    await upsertShopifyOrder(
      trackedOrderClient({
        existingOrderId: "ord-1",
        orderStatus: "READY",
        shipments: [{ id: "shp-1", status: "QUEUED", length_cm: null, width_cm: null, height_cm: null }],
        inserts: [],
        deletes: [],
        updates: queued,
      }) as never,
      {
        organizationId: "org-1",
        shopDomain: "demo.myshopify.com",
        remote: {
          ...remoteOrder,
          line_items: [{ title: "Kurta", quantity: 1, price: "499", grams: 900, length_cm: 20, width_cm: 15, height_cm: 10 }],
        },
      }
    );
    expect(queued.filter((row) => row.table === "shipments")).toEqual([]);
  });

  it("hydrates webhook line items from Shopify product weight and metafield size", async () => {
    getAutomationSettings.mockResolvedValue({
      autoShopifySync: true,
      autoShipmentCreation: true,
      autoBooking: false,
    });
    createShipmentsForOrders.mockClear();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const href = String(input);
      if (href.includes("/products.json")) {
        return new Response(
          JSON.stringify({
            products: [
              {
                id: 9,
                variants: [{ id: 22, grams: 500, weight: 0.5, weight_unit: "kg" }],
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      if (href.includes("graphql.json")) {
        return new Response(
          JSON.stringify({
            data: {
              nodes: [
                {
                  id: "gid://shopify/ProductVariant/22",
                  customLength: { value: "20" },
                  customWidth: { value: "15" },
                  customHeight: { value: "10" },
                },
              ],
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
    });
    const inserts: Array<{ table: string; payload: unknown }> = [];
    const tracked = trackedOrderClient({ inserts, deletes: [] });
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === "shopify_connections") {
          return query({
            shop_domain: "demo.myshopify.com",
            encrypted_access_token: encryptSecret("shpat_test"),
          });
        }
        return tracked.from(table);
      }),
    };

    try {
      const result = await importShopifyWebhookOrder(supabase as never, {
        organizationId: "org-1",
        shopDomain: "demo.myshopify.com",
        topic: "orders/create",
        remote: {
          ...remoteOrder,
          line_items: [
            {
              title: "Kurta",
              quantity: 1,
              price: "499",
              grams: 0,
              product_id: 9,
              variant_id: 22,
            },
          ],
        },
      });
      expect(result.imported).toBe(true);
      const items = inserts.find((row) => row.table === "order_line_items");
      expect(items?.payload).toEqual([expect.objectContaining({ weight_grams: 500 })]);
      expect(createShipmentsForOrders).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ organizationId: "org-1" }),
        ["ord-1"],
        { enqueueBooking: false, runBookingNow: false, lengthCm: 20, widthCm: 15, heightCm: 10 }
      );
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("keeps importing weight when GraphQL dimension enrichment fails", async () => {
    getAutomationSettings.mockResolvedValue({
      autoShopifySync: true,
      autoShipmentCreation: true,
      autoBooking: false,
    });
    createShipmentsForOrders.mockClear();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const href = String(input);
      if (href.includes("/products.json")) {
        return new Response(
          JSON.stringify({
            products: [{ id: 9, variants: [{ id: 22, grams: 400, weight: 0.4, weight_unit: "kg" }] }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      if (href.includes("graphql.json")) {
        return new Response(JSON.stringify({ errors: [{ message: "ACCESS_DENIED" }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
    });
    const inserts: Array<{ table: string; payload: unknown }> = [];
    const tracked = trackedOrderClient({ inserts, deletes: [] });
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === "shopify_connections") {
          return query({
            shop_domain: "demo.myshopify.com",
            encrypted_access_token: encryptSecret("shpat_test"),
          });
        }
        if (table === "india_post_connections") {
          return query({
            default_length_cm: 22,
            default_width_cm: 16,
            default_height_cm: 11,
          });
        }
        return tracked.from(table);
      }),
    };
    try {
      const result = await importShopifyWebhookOrder(supabase as never, {
        organizationId: "org-1",
        shopDomain: "demo.myshopify.com",
        topic: "orders/create",
        remote: {
          ...remoteOrder,
          line_items: [{ title: "Kurta", quantity: 1, price: "499", grams: 0, product_id: 9, variant_id: 22 }],
        },
      });
      expect(result.imported).toBe(true);
      const items = inserts.find((row) => row.table === "order_line_items");
      expect(items?.payload).toEqual([expect.objectContaining({ weight_grams: 400 })]);
      expect(createShipmentsForOrders).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ organizationId: "org-1" }),
        ["ord-1"],
        { enqueueBooking: false, runBookingNow: false, lengthCm: 22, widthCm: 16, heightCm: 11 }
      );
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("stamps workspace parcel defaults onto a new Shopify shipment when metafields are absent", async () => {
    createShipmentsForOrders.mockClear();
    const base = newOrderClient();
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === "india_post_connections") {
          return query({
            default_length_cm: 25,
            default_width_cm: 18,
            default_height_cm: 12,
            default_weight_grams: 900,
          });
        }
        return base.from(table);
      }),
    };
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
      { enqueueBooking: false, runBookingNow: false, lengthCm: 25, widthCm: 18, heightCm: 12 }
    );
  });

  it("creates a draft shipment from Shopify dimensions when auto-create is off", async () => {
    createShipmentsForOrders.mockClear();
    const result = await upsertShopifyOrder(newOrderClient() as never, {
      organizationId: "org-1",
      shopDomain: "demo.myshopify.com",
      remote: {
        ...remoteOrder,
        line_items: [
          {
            title: "Kurta",
            quantity: 1,
            price: "499",
            grams: 500,
            length_cm: 20,
            width_cm: 15,
            height_cm: 10,
          },
        ],
      },
      createShipment: false,
    });
    expect(result.imported).toBe(true);
    expect(createShipmentsForOrders).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: "org-1" }),
      ["ord-1"],
      { enqueueBooking: false, runBookingNow: false, lengthCm: 20, widthCm: 15, heightCm: 10 }
    );
  });
});

describe("fulfillShopifyShipment tracking", () => {
  const postbusUrl = "https://www.postbus.in/track?tracking=EM123456789IN";

  function shipmentClient(tracking: { barcode?: string | null; tracking_number?: string | null }) {
    return {
      from: vi.fn((table: string) => {
        if (table === "shipments") {
          return query({
            id: "shp-1",
            barcode: tracking.barcode ?? null,
            tracking_number: tracking.tracking_number ?? null,
            order_id: "ord-1",
            orders: {
              id: "ord-1",
              source: "SHOPIFY",
              source_order_id: "1042",
              fulfillment_status: "UNFULFILLED",
            },
          });
        }
        if (table === "shopify_connections") {
          return query({
            shop_domain: "demo.myshopify.com",
            encrypted_access_token: encryptSecret("shpat_test"),
          });
        }
        if (table === "external_order_references") return query(null);
        return query({});
      }),
    };
  }

  function graphqlResponse(query: string, variables: Record<string, unknown>, mode: "create" | "retry" | "update") {
    if (query.includes("ShopifyOrderFulfillmentOrders")) {
      const status = mode === "update" ? "CLOSED" : "OPEN";
      return {
        data: {
          order: {
            tags: ["vip"],
            displayFulfillmentStatus: mode === "create" ? "UNFULFILLED" : "FULFILLED",
            fulfillmentOrders: { nodes: [{ id: "gid://shopify/FulfillmentOrder/11", status }] },
          },
        },
      };
    }
    if (query.includes("fulfillmentCreate")) {
      if (mode === "retry") {
        return {
          data: {
            fulfillmentCreate: {
              fulfillment: null,
              userErrors: [{ field: ["fulfillment"], message: "The fulfillment order is already closed." }],
            },
          },
        };
      }
      expect(variables.fulfillment.trackingInfo).toEqual({
        company: "PostBus",
        number: "EM123456789IN",
        url: postbusUrl,
      });
      expect(JSON.stringify(variables)).not.toContain("indiapost.gov.in");
      return {
        data: {
          fulfillmentCreate: {
            fulfillment: {
              id: "gid://shopify/Fulfillment/99",
              status: "SUCCESS",
              trackingInfo: [{ company: "PostBus", number: "EM123456789IN", url: postbusUrl }],
            },
            userErrors: [],
          },
        },
      };
    }
    if (query.includes("ShopifyOrderFulfillments")) {
      return { data: { order: { id: "gid://shopify/Order/1042", fulfillments: [{ id: "gid://shopify/Fulfillment/99", createdAt: "2026-10-08T00:00:00Z" }] } } };
    }
    if (query.includes("fulfillmentTrackingInfoUpdate")) {
      expect(variables.trackingInfoInput).toEqual({
        company: "PostBus",
        number: "EM123456789IN",
        url: postbusUrl,
      });
      expect(JSON.stringify(variables)).not.toContain("indiapost.gov.in");
      return {
        data: {
          fulfillmentTrackingInfoUpdate: {
            fulfillment: {
              id: "gid://shopify/Fulfillment/99",
              status: "SUCCESS",
              trackingInfo: [{ company: "PostBus", number: "EM123456789IN", url: postbusUrl }],
            },
            userErrors: [],
          },
        },
      };
    }
    if (query.includes("orderUpdate")) {
      return { data: { orderUpdate: { order: { id: "gid://shopify/Order/1042", tags: ["vip", "postbus-booked"] }, userErrors: [] } } };
    }
    return { data: {} };
  }

  it("creates a Shopify fulfillment with the India Post AWB and PostBus URL", async () => {
    const calls: Array<{ query: string; variables: Record<string, unknown> }> = [];
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { query?: string; variables?: Record<string, unknown> };
      calls.push({ query: body.query ?? "", variables: body.variables ?? {} });
      return new Response(JSON.stringify(graphqlResponse(body.query ?? "", body.variables ?? {}, "create")), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    try {
      const result = await fulfillShopifyShipment(shipmentClient({ barcode: "EM123456789IN" }) as never, {
        organizationId: "org-1",
        shipmentId: "shp-1",
      });
      expect(result).toEqual({ skipped: false, fulfilled: true });
      expect(calls.some((call) => call.query.includes("fulfillmentCreate"))).toBe(true);
      expect(calls.every((call) => !JSON.stringify(call.variables).includes("indiapost.gov.in"))).toBe(true);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("skips Shopify fulfillment when the AWB is missing", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      throw new Error("Shopify should not be called without an AWB");
    });
    try {
      const result = await fulfillShopifyShipment(shipmentClient({ barcode: null, tracking_number: "  " }) as never, {
        organizationId: "org-1",
        shipmentId: "shp-1",
      });
      expect(result).toEqual({ skipped: true, reason: "no_barcode" });
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("updates existing tracking instead of creating a duplicate fulfillment", async () => {
    const created: string[] = [];
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { query?: string; variables?: Record<string, unknown> };
      if (body.query?.includes("fulfillmentCreate")) created.push("create");
      if (body.query?.includes("fulfillmentTrackingInfoUpdate")) created.push("update");
      return new Response(JSON.stringify(graphqlResponse(body.query ?? "", body.variables ?? {}, "retry")), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    try {
      const result = await fulfillShopifyShipment(shipmentClient({ barcode: "EM123456789IN" }) as never, {
        organizationId: "org-1",
        shipmentId: "shp-1",
      });
      expect(result.fulfilled).toBe(true);
      expect(created.filter((item) => item === "create")).toHaveLength(1);
      expect(created.filter((item) => item === "update")).toHaveLength(1);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("keeps the PostBus tracking URL when updating an existing fulfillment", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { query?: string; variables?: Record<string, unknown> };
      return new Response(JSON.stringify(graphqlResponse(body.query ?? "", body.variables ?? {}, "update")), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    try {
      const result = await fulfillShopifyShipment(shipmentClient({ tracking_number: "EM123456789IN" }) as never, {
        organizationId: "org-1",
        shipmentId: "shp-1",
      });
      expect(result.fulfilled).toBe(true);
      expect(result.skipped).toBe(false);
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
