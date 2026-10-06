import { describe, expect, it, vi } from "vitest";
import { mapShipmentToArticle } from "@/modules/india-post/article-mapper";
import { assertValidatedArticle, validateIndiaPostArticle } from "@/modules/india-post/article-validator";
import { serializeIndiaPostBookingArticle } from "@/modules/india-post/booking-payload";
import { runIndiaPostBooking } from "@/modules/india-post/booking-run";

const bookShipmentMock = vi.fn();
const ensureSessionMock = vi.fn().mockResolvedValue({ reused: true, tokens: null });

vi.mock("@/modules/india-post/provider", () => ({
  indiaPostFromRow: vi.fn(() => ({
    ensureSession: ensureSessionMock,
    bookShipment: bookShipmentMock,
    bookShipmentFile: bookShipmentMock,
    searchPostOffices: vi.fn().mockResolvedValue([{ office_id: "22660454", delivery_office_flag: true, pincode: "682311" }]),
  })),
}));

vi.mock("@/modules/india-post/origin", () => ({
  cachedOfficeLookup: vi.fn(),
  resolveIndiaPostOrigin: vi.fn().mockResolvedValue({
    officeId: "22660454",
    pincode: "682311",
    city: "Ernakulam",
    state: "Kerala",
  }),
}));

function chainableWrite(
  data: unknown = { id: "ship-1", barcode: "ET214330016IN", status: "BOOKING", booked_at: null }
) {
  const self: Record<string, unknown> = {};
  const next = () => self;
  self.eq = next;
  self.in = next;
  self.is = next;
  self.select = next;
  self.maybeSingle = async () => ({ data, error: null });
  self.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
    Promise.resolve({ data, error: null }).then(resolve, reject);
  return self;
}

function mockOrderArticle(overrides: Record<string, unknown> = {}) {
  return mapShipmentToArticle({
    orderId: "ord-1",
    orderNumber: "#10025",
    serviceCode: "SP_INLAND_PARCEL",
    customerId: "1788590988",
    contractId: "41793509",
    barcode: "ET214330016IN",
    officeId: "22660454",
    originPin: "682311",
    weightGrams: 500,
    lengthCm: 20,
    widthCm: 15,
    heightCm: 10,
    senderName: "Postbus Merchant",
    senderCompany: "Merchant Store",
    senderLine1: "MG Road",
    senderCity: "Ernakulam",
    senderState: "Kerala",
    senderPin: "682311",
    senderMobile: "9876543210",
    receiverName: "Priya Sharma",
    receiverLine1: "Connaught Place",
    receiverCity: "New Delhi",
    receiverState: "Delhi",
    receiverPin: "110001",
    receiverMobile: "9876543211",
    paymentMode: "PREPAID",
    strictDimensions: true,
    ...overrides,
  });
}

describe("India Post Booking Dimensions Audit & Verification", () => {
  it("Shopify order with valid dimensions passes validation and serializes correctly", () => {
    const draft = mockOrderArticle({
      orderNumber: "SHOPIFY-1001",
      lengthCm: 25,
      widthCm: 18,
      heightCm: 12,
      weightGrams: 750,
      serviceCode: "SP_INLAND_PARCEL",
    });
    const issues = validateIndiaPostArticle(draft);
    expect(issues).toEqual([]);

    const validated = assertValidatedArticle(draft);
    const payload = serializeIndiaPostBookingArticle(validated);
    expect(payload.length).toBe(25);
    expect(payload.breadth_diameter).toBe(18);
    expect(payload.height).toBe(12);
    expect(payload.physical_weight).toBe(750);
    expect(payload.shape_of_article).toBe("NROL");
  });

  it("Shopify order without dimensions fails validation before booking API call", () => {
    const draft = mockOrderArticle({
      orderNumber: "SHOPIFY-1002",
      lengthCm: 0,
      widthCm: 0,
      heightCm: 0,
      weightGrams: 500,
      serviceCode: "SP_INLAND_PARCEL",
    });
    const issues = validateIndiaPostArticle(draft);
    expect(issues.some((issue) => issue.field === "length")).toBe(true);
    expect(issues[0]?.error).toMatch(/Parcel length, breadth and height are required/i);

    expect(() => assertValidatedArticle(draft)).toThrow(/Parcel length, breadth and height are required/i);
  });

  it("Manual order with valid dimensions passes validation and serializes correctly", () => {
    const draft = mockOrderArticle({
      orderNumber: "PB-10005",
      lengthCm: 30,
      widthCm: 20,
      heightCm: 15,
      weightGrams: 1200,
      serviceCode: "BUSINESS_PARCEL",
    });
    const issues = validateIndiaPostArticle(draft);
    expect(issues).toEqual([]);

    const validated = assertValidatedArticle(draft);
    const payload = serializeIndiaPostBookingArticle(validated);
    expect(payload.length).toBe(30);
    expect(payload.breadth_diameter).toBe(20);
    expect(payload.height).toBe(15);
    expect(payload.article_type).toBe("BUSINESS_PARCEL");
    expect(payload.shape_of_article).toBe("NROL");
  });

  it("Manual order without dimensions fails validation before calling India Post", () => {
    const draft = mockOrderArticle({
      orderNumber: "PB-10006",
      lengthCm: 0,
      widthCm: 0,
      heightCm: 0,
      weightGrams: 800,
      serviceCode: "BUSINESS_PARCEL",
    });
    const issues = validateIndiaPostArticle(draft);
    expect(issues.some((issue) => issue.field === "length")).toBe(true);
    expect(() => assertValidatedArticle(draft)).toThrow(/Parcel length, breadth and height are required/i);
  });

  it("enforces parcel dimension limits (Length 14-150, Width 9-150, Height 1-150)", () => {
    // Length below min limit of 14 cm
    const shortLength = mockOrderArticle({ lengthCm: 10, widthCm: 15, heightCm: 5 });
    expect(validateIndiaPostArticle(shortLength).some((i) => i.field === "length")).toBe(true);

    // Width below min limit of 9 cm
    const narrowWidth = mockOrderArticle({ lengthCm: 20, widthCm: 5, heightCm: 5 });
    expect(validateIndiaPostArticle(narrowWidth).some((i) => i.field === "breadth_diameter")).toBe(true);

    // Height below min limit of 1 cm
    const zeroHeight = mockOrderArticle({ lengthCm: 20, widthCm: 15, heightCm: 0 });
    expect(validateIndiaPostArticle(zeroHeight).some((i) => i.field === "length")).toBe(true);

    // Exceeding max limit 150 cm
    const oversized = mockOrderArticle({ lengthCm: 160, widthCm: 20, heightCm: 10 });
    expect(validateIndiaPostArticle(oversized).some((i) => i.field === "length")).toBe(true);
  });

  it("Roll/cylindrical package correctly sets shape ROLL and validates dimensions", () => {
    const draft = mockOrderArticle({
      lengthCm: 40,
      widthCm: 12, // diameter
      heightCm: 12,
      shape: "ROLL",
      serviceCode: "SP_INLAND_PARCEL",
    });
    const issues = validateIndiaPostArticle(draft);
    expect(issues).toEqual([]);

    const validated = assertValidatedArticle(draft);
    const payload = serializeIndiaPostBookingArticle(validated);
    expect(payload.shape_of_article).toBe("ROLL");
    expect(payload.breadth_diameter).toBe(12);
    expect(payload.length).toBe(40);
  });

  it("Speed Post document (<= 500g) allows document dimensions", () => {
    const docDraft = mockOrderArticle({
      serviceCode: "SP_INLAND_DOC",
      weightGrams: 250,
      lengthCm: 20,
      widthCm: 15,
      heightCm: 1,
    });
    expect(validateIndiaPostArticle(docDraft)).toEqual([]);
    const validated = assertValidatedArticle(docDraft);
    const payload = serializeIndiaPostBookingArticle(validated);
    expect(payload.shape_of_article).toBe("DOC");
  });

  it("runIndiaPostBooking uses workspace defaults when dimensions are missing", async () => {
    bookShipmentMock.mockClear();
    bookShipmentMock.mockResolvedValueOnce({
      batch_id: "batch-defaults",
      correlation_id: "corr-defaults",
      valid_articles: [{ barcode_no: "ET214330016IN", calculated_tariff: 45 }],
      error_articles: [],
    });
    const updateShipmentMock = vi.fn().mockReturnValue(chainableWrite());
    const updateOrderMock = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({}) });

    const mockSupabase = {
      from: (table: string) => {
        if (table === "india_post_connections") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    id: "conn-1",
                    status: "CONNECTED",
                    environment: "TEST",
                    bulk_customer_id: "1788590988",
                    contract_id: "41793509",
                    default_length_cm: 22,
                    default_width_cm: 16,
                    default_height_cm: 11,
                    default_weight_grams: 400,
                  },
                }),
              }),
            }),
          };
        }
        if (table === "shipments") {
          return {
            select: () => ({
              eq: () => ({
                in: async () => ({
                  data: [
                    {
                      id: "ship-1",
                      order_id: "ord-1",
                      status: "QUEUED",
                      barcode: "ET214330016IN",
                      service_code: "SP_INLAND_PARCEL",
                      weight_grams: 500,
                      length_cm: null,
                      width_cm: null,
                      height_cm: null,
                      payment_mode: "PREPAID",
                      cod_amount: 0,
                      orders: { id: "ord-1", order_number: "#1001", source: "SHOPIFY" },
                      customers: { name: "Test Customer", phone: "9876543210" },
                      addresses: {
                        name: "Test Customer",
                        line1: "123 Test St",
                        city: "Delhi",
                        state: "Delhi",
                        pincode: "110001",
                        phone: "9876543210",
                      },
                    },
                  ],
                }),
              }),
            }),
            update: updateShipmentMock,
          };
        }
        if (table === "orders") {
          return { update: updateOrderMock };
        }
        if (table === "pickup_locations") {
          return {
            select: () => ({
              eq: () => ({
                order: () => ({
                  limit: () => ({
                    maybeSingle: async () => ({
                      data: {
                        name: "Main Warehouse",
                        pincode: "682311",
                        city: "Ernakulam",
                        state: "Kerala",
                        line1: "Pickup Point 1",
                        phone: "9876543210",
                      },
                    }),
                  }),
                }),
              }),
            }),
          };
        }
        if (table === "organizations") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    name: "Merchant Org",
                    phone: "9876543210",
                    line1: "Pickup Point 1",
                    city: "Ernakulam",
                    state: "Kerala",
                    pincode: "682311",
                  },
                }),
              }),
            }),
          };
        }
        if (table === "shopify_stores") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: { shop_name: "Test Shop" } }),
              }),
            }),
          };
        }
        if (table === "india_post_contracts") {
          return {
            select: () => ({
              eq: () => ({
                eq: async () => ({
                  data: [{ service_code: "SP_INLAND_PARCEL", contract_id: "41793509" }],
                }),
              }),
            }),
          };
        }
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) };
      },
    };

    const outcome = await runIndiaPostBooking(mockSupabase as never, {
      organizationId: "org-1",
      shipmentIds: ["ship-1"],
    });

    expect(outcome.booked).toBe(1);
    expect(bookShipmentMock).toHaveBeenCalledTimes(1);
    expect(bookShipmentMock.mock.calls[0][0].articles[0]).toMatchObject({
      length: 22,
      breadth_diameter: 16,
      height: 11,
      physical_weight: 500,
    });
    expect(updateShipmentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "BOOKED",
        length_cm: 22,
        width_cm: 16,
        height_cm: 11,
      })
    );
  });

  it("runIndiaPostBooking falls back to 14×9×1 cm when Settings defaults are empty", async () => {
    bookShipmentMock.mockClear();
    bookShipmentMock.mockResolvedValueOnce({
      batch_id: "batch-fallback",
      correlation_id: "corr-fallback",
      valid_articles: [{ barcode_no: "ET214330016IN", calculated_tariff: 45 }],
      error_articles: [],
    });
    const updateShipmentMock = vi.fn().mockReturnValue(chainableWrite());
    const updateOrderMock = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({}) });

    const mockSupabase = {
      from: (table: string) => {
        if (table === "india_post_connections") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    id: "conn-1",
                    status: "CONNECTED",
                    environment: "TEST",
                    bulk_customer_id: "1788590988",
                    contract_id: "41793509",
                  },
                }),
              }),
            }),
          };
        }
        if (table === "shipments") {
          return {
            select: () => ({
              eq: () => ({
                in: async () => ({
                  data: [
                    {
                      id: "ship-1",
                      order_id: "ord-1",
                      status: "QUEUED",
                      barcode: "ET214330016IN",
                      service_code: "SP_INLAND_PARCEL",
                      weight_grams: 0,
                      length_cm: null,
                      width_cm: null,
                      height_cm: null,
                      payment_mode: "PREPAID",
                      cod_amount: 0,
                      orders: { id: "ord-1", order_number: "#1001", source: "SHOPIFY" },
                      customers: { name: "Test Customer", phone: "9876543210" },
                      addresses: {
                        name: "Test Customer",
                        line1: "123 Test St",
                        city: "Delhi",
                        state: "Delhi",
                        pincode: "110001",
                        phone: "9876543210",
                      },
                    },
                  ],
                }),
              }),
            }),
            update: updateShipmentMock,
          };
        }
        if (table === "orders") {
          return { update: updateOrderMock };
        }
        if (table === "pickup_locations") {
          return {
            select: () => ({
              eq: () => ({
                order: () => ({
                  limit: () => ({
                    maybeSingle: async () => ({
                      data: {
                        name: "Main Warehouse",
                        pincode: "682311",
                        city: "Ernakulam",
                        state: "Kerala",
                        line1: "Pickup Point 1",
                        phone: "9876543210",
                      },
                    }),
                  }),
                }),
              }),
            }),
          };
        }
        if (table === "organizations") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    name: "Merchant Org",
                    phone: "9876543210",
                    line1: "Pickup Point 1",
                    city: "Ernakulam",
                    state: "Kerala",
                    pincode: "682311",
                  },
                }),
              }),
            }),
          };
        }
        if (table === "shopify_stores") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: { shop_name: "Test Shop" } }),
              }),
            }),
          };
        }
        if (table === "india_post_contracts") {
          return {
            select: () => ({
              eq: () => ({
                eq: async () => ({
                  data: [{ service_code: "SP_INLAND_PARCEL", contract_id: "41793509" }],
                }),
              }),
            }),
          };
        }
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) };
      },
    };

    await runIndiaPostBooking(mockSupabase as never, {
      organizationId: "org-1",
      shipmentIds: ["ship-1"],
    });

    expect(bookShipmentMock.mock.calls[0][0].articles[0]).toMatchObject({
      length: 14,
      breadth_diameter: 9,
      height: 1,
      physical_weight: 100,
    });
  });

  it("runIndiaPostBooking still fails when entered dimensions are outside India Post limits", async () => {
    bookShipmentMock.mockClear();
    const updateShipmentMock = vi.fn().mockReturnValue(chainableWrite());

    const mockSupabase = {
      from: (table: string) => {
        if (table === "india_post_connections") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    id: "conn-1",
                    status: "CONNECTED",
                    environment: "TEST",
                    bulk_customer_id: "1788590988",
                    contract_id: "41793509",
                    default_length_cm: 22,
                    default_width_cm: 16,
                    default_height_cm: 11,
                  },
                }),
              }),
            }),
          };
        }
        if (table === "shipments") {
          return {
            select: () => ({
              eq: () => ({
                in: async () => ({
                  data: [
                    {
                      id: "ship-1",
                      order_id: "ord-1",
                      status: "QUEUED",
                      barcode: "ET214330016IN",
                      service_code: "SP_INLAND_PARCEL",
                      weight_grams: 500,
                      length_cm: 5,
                      width_cm: 4,
                      height_cm: 2,
                      payment_mode: "PREPAID",
                      cod_amount: 0,
                      orders: { id: "ord-1", order_number: "#1001", source: "SHOPIFY" },
                      customers: { name: "Test Customer", phone: "9876543210" },
                      addresses: {
                        name: "Test Customer",
                        line1: "123 Test St",
                        city: "Delhi",
                        state: "Delhi",
                        pincode: "110001",
                        phone: "9876543210",
                      },
                    },
                  ],
                }),
              }),
            }),
            update: updateShipmentMock,
          };
        }
        if (table === "pickup_locations") {
          return {
            select: () => ({
              eq: () => ({
                order: () => ({
                  limit: () => ({
                    maybeSingle: async () => ({
                      data: {
                        name: "Main Warehouse",
                        pincode: "682311",
                        city: "Ernakulam",
                        state: "Kerala",
                        line1: "Pickup Point 1",
                        phone: "9876543210",
                      },
                    }),
                  }),
                }),
              }),
            }),
          };
        }
        if (table === "organizations") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    name: "Merchant Org",
                    phone: "9876543210",
                    line1: "Pickup Point 1",
                    city: "Ernakulam",
                    state: "Kerala",
                    pincode: "682311",
                  },
                }),
              }),
            }),
          };
        }
        if (table === "shopify_stores") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: { shop_name: "Test Shop" } }),
              }),
            }),
          };
        }
        if (table === "india_post_contracts") {
          return {
            select: () => ({
              eq: () => ({
                eq: async () => ({
                  data: [{ service_code: "SP_INLAND_PARCEL", contract_id: "41793509" }],
                }),
              }),
            }),
          };
        }
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) };
      },
    };

    await expect(
      runIndiaPostBooking(mockSupabase as never, {
        organizationId: "org-1",
        shipmentIds: ["ship-1"],
      })
    ).rejects.toThrow(/Length must be between/i);
    expect(bookShipmentMock).not.toHaveBeenCalled();
  });

  it("runIndiaPostBooking with valid dimensions successfully dispatches and logs structured payload", async () => {
    bookShipmentMock.mockClear();
    bookShipmentMock.mockResolvedValueOnce({
      batch_id: "batch-101",
      correlation_id: "corr-101",
      valid_articles: [{ barcode_no: "ET214330016IN", calculated_tariff: 45 }],
      error_articles: [],
    });
    const updateShipmentMock = vi.fn().mockReturnValue(chainableWrite());
    const updateOrderMock = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({}) });

    const mockSupabase = {
      from: (table: string) => {
        if (table === "india_post_connections") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    id: "conn-1",
                    status: "CONNECTED",
                    environment: "TEST",
                    bulk_customer_id: "1788590988",
                    contract_id: "41793509",
                  },
                }),
              }),
            }),
          };
        }
        if (table === "shipments") {
          return {
            select: () => ({
              eq: () => ({
                in: async () => ({
                  data: [
                    {
                      id: "ship-2",
                      order_id: "ord-2",
                      status: "QUEUED",
                      barcode: "ET214330016IN",
                      service_code: "SP_INLAND_PARCEL",
                      weight_grams: 800,
                      length_cm: 20, // VALID DIMENSIONS
                      width_cm: 15,
                      height_cm: 10,
                      payment_mode: "PREPAID",
                      cod_amount: 0,
                      orders: { id: "ord-2", order_number: "#1002", source: "MANUAL" },
                      customers: { name: "Manual Customer", phone: "9876543210" },
                      addresses: {
                        name: "Manual Customer",
                        line1: "456 Market St",
                        city: "Delhi",
                        state: "Delhi",
                        pincode: "110001",
                        phone: "9876543210",
                      },
                    },
                  ],
                }),
              }),
            }),
            update: updateShipmentMock,
          };
        }
        if (table === "orders") {
          return { update: updateOrderMock };
        }
        if (table === "pickup_locations") {
          return {
            select: () => ({
              eq: () => ({
                order: () => ({
                  limit: () => ({
                    maybeSingle: async () => ({
                      data: {
                        name: "Main Warehouse",
                        pincode: "682311",
                        city: "Ernakulam",
                        state: "Kerala",
                        line1: "Pickup Point 1",
                        phone: "9876543210",
                      },
                    }),
                  }),
                }),
              }),
            }),
          };
        }
        if (table === "organizations") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    name: "Merchant Org",
                    phone: "9876543210",
                    line1: "Pickup Point 1",
                    city: "Ernakulam",
                    state: "Kerala",
                    pincode: "682311",
                  },
                }),
              }),
            }),
          };
        }
        if (table === "shopify_stores") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: { shop_name: "Test Shop" } }),
              }),
            }),
          };
        }
        if (table === "india_post_contracts") {
          return {
            select: () => ({
              eq: () => ({
                eq: async () => ({
                  data: [{ service_code: "SP_INLAND_PARCEL", contract_id: "41793509" }],
                }),
              }),
            }),
          };
        }
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) };
      },
    };

    const outcome = await runIndiaPostBooking(mockSupabase as never, {
      organizationId: "org-1",
      shipmentIds: ["ship-2"],
    });

    expect(outcome.booked).toBe(1);
    expect(outcome.failed).toBe(0);
    expect(bookShipmentMock).toHaveBeenCalledTimes(1);

    const callArgs = bookShipmentMock.mock.calls[0][0];
    expect(callArgs.articles[0]).toMatchObject({
      length: 20,
      breadth_diameter: 15,
      height: 10,
      physical_weight: 800,
      shape_of_article: "NROL",
    });
  });
});
