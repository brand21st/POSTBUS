import { describe, expect, it, vi } from "vitest";
import { mapShipmentToArticle } from "@/modules/india-post/article-mapper";
import {
  assertValidatedArticle,
  isParcelArticle,
  validateIndiaPostArticle,
} from "@/modules/india-post/article-validator";
import { serializeIndiaPostBookingArticle } from "@/modules/india-post/booking-payload";
import { runIndiaPostBooking } from "@/modules/india-post/booking-run";
import {
  indiaPostBookingArticleType,
  indiaPostShapeOfArticle,
  indiaPostSpeedPostKind,
} from "@/modules/india-post/endpoints";

const bookShipmentMock = vi.fn();

vi.mock("@/modules/india-post/provider", () => ({
  indiaPostFromRow: vi.fn(() => ({
    ensureSession: vi.fn().mockResolvedValue({ reused: true, tokens: null }),
    bookShipment: bookShipmentMock,
    bookShipmentFile: bookShipmentMock,
    searchPostOffices: vi.fn().mockResolvedValue([
      { office_id: "22660454", delivery_office_flag: true, pincode: "682311" },
    ]),
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

/** Documented CEPT process-articles identity. Long product codes are not booking fields. */
const CEPT_ARTICLE_TYPE = {
  SP_INLAND_PARCEL: "SP",
  BUSINESS_PARCEL: "BP",
} as const;

const PARCEL_WEIGHTS_G = [1, 32, 100, 499, 500, 501, 1000, 5000, 35_000] as const;
const PARCEL_DIMS = { lengthCm: 14, widthCm: 9, heightCm: 1 } as const;

function parcelDraft(
  serviceCode: "SP_INLAND_PARCEL" | "BUSINESS_PARCEL",
  weightGrams: number,
  dims = PARCEL_DIMS
) {
  return mapShipmentToArticle({
    orderId: "ord-1",
    orderNumber: "#32G",
    serviceCode,
    customerId: "1788590988",
    contractId: serviceCode === "BUSINESS_PARCEL" ? "41367422" : "41793509",
    barcode: "ET214330016IN",
    officeId: "22660454",
    originPin: "682311",
    weightGrams,
    ...dims,
    senderName: "Postbus Merchant",
    senderCompany: "Merchant Store",
    senderLine1: "MG Road warehouse",
    senderCity: "Ernakulam",
    senderState: "Kerala",
    senderPin: "682311",
    senderMobile: "9876543210",
    receiverName: "Priya Sharma",
    receiverLine1: "New Delhi GPO",
    receiverCity: "Delhi",
    receiverState: "Delhi",
    receiverPin: "110001",
    receiverMobile: "9944388249",
    paymentMode: "PREPAID",
    strictDimensions: true,
    strictWeight: true,
  });
}

function expectCeptParcelPayload(
  payload: Record<string, string | number>,
  serviceCode: "SP_INLAND_PARCEL" | "BUSINESS_PARCEL",
  weightGrams: number
) {
  expect(payload.article_type).toBe(CEPT_ARTICLE_TYPE[serviceCode]);
  expect(payload.article_type).not.toBe("SP_INLAND_DOC");
  expect(payload.article_type).not.toBe("SP_INLAND_PARCEL");
  expect(payload.article_type).not.toBe("BUSINESS_PARCEL");
  expect(payload.physical_weight).toBe(weightGrams);
  expect(payload.shape_of_article).toBe("NROL");
  expect(payload.length).toBe(14);
  expect(payload.breadth_diameter).toBe(9);
  expect(payload.height).toBe(1);
  expect("product_code" in payload).toBe(false);
}

function bookingDb(input: {
  serviceCode: "SP_INLAND_PARCEL" | "BUSINESS_PARCEL";
  weightGrams: number;
}) {
  const updateShipmentMock = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({}) });
  const supabase = {
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
                    service_code: input.serviceCode,
                    weight_grams: input.weightGrams,
                    length_cm: 14,
                    width_cm: 9,
                    height_cm: 1,
                    payment_mode: "PREPAID",
                    cod_amount: 0,
                    orders: { id: "ord-1", order_number: "#32G", source: "MANUAL" },
                    customers: { name: "Priya Sharma", phone: "9944388249" },
                    addresses: {
                      name: "Priya Sharma",
                      line1: "New Delhi GPO",
                      city: "Delhi",
                      state: "Delhi",
                      pincode: "110001",
                      phone: "9944388249",
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
        return { update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({}) }) };
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
                data: [
                  { service_code: "SP_INLAND_PARCEL", contract_id: "41793509" },
                  { service_code: "BUSINESS_PARCEL", contract_id: "41367422" },
                ],
              }),
            }),
          }),
        };
      }
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) };
    },
  };
  return { supabase, updateShipmentMock };
}

describe("CEPT parcel identity (documented process-articles fields only)", () => {
  it("maps Postbus products onto documented SP / BP article_type values", () => {
    expect(indiaPostBookingArticleType("SP_INLAND_PARCEL")).toBe("SP");
    expect(indiaPostBookingArticleType("BUSINESS_PARCEL")).toBe("BP");
  });

  it("does not treat selected parcel products as documents below 500 g", () => {
    for (const grams of PARCEL_WEIGHTS_G) {
      expect(indiaPostSpeedPostKind("SP_INLAND_PARCEL", grams)).toBe("PARCEL");
      expect(indiaPostSpeedPostKind("BUSINESS_PARCEL", grams)).toBe("PARCEL");
      expect(indiaPostShapeOfArticle("SP_INLAND_PARCEL", grams)).toBe("NROL");
      expect(indiaPostShapeOfArticle("BUSINESS_PARCEL", grams)).toBe("NROL");
      expect(isParcelArticle("SP_INLAND_PARCEL", grams)).toBe(true);
      expect(isParcelArticle("BUSINESS_PARCEL", grams)).toBe(true);
    }
  });
});

describe.each(["SP_INLAND_PARCEL", "BUSINESS_PARCEL"] as const)("%s process-articles payload 1 g–35 kg", (serviceCode) => {
  it.each([...PARCEL_WEIGHTS_G])("accepts %i g at 14×9×1 cm and serializes CEPT fields", (weightGrams) => {
    const draft = parcelDraft(serviceCode, weightGrams);
    expect(validateIndiaPostArticle(draft)).toEqual([]);
    const payload = serializeIndiaPostBookingArticle(assertValidatedArticle(draft));
    expectCeptParcelPayload(payload, serviceCode, weightGrams);
  });

  it("rejects 35001 g", () => {
    const issues = validateIndiaPostArticle(parcelDraft(serviceCode, 35_001));
    expect(issues.some((issue) => issue.field === "physical_weight")).toBe(true);
  });
});

describe("runIndiaPostBooking posts the CEPT article body", () => {
  it.each(
    (["SP_INLAND_PARCEL", "BUSINESS_PARCEL"] as const).flatMap((serviceCode) =>
      PARCEL_WEIGHTS_G.map((weightGrams) => [serviceCode, weightGrams] as const)
    )
  )("%s %i g reaches bookShipment({ articles })", async (serviceCode, weightGrams) => {
    bookShipmentMock.mockReset();
    bookShipmentMock.mockResolvedValueOnce({
      batch_id: "batch-weight",
      correlation_id: "corr-weight",
      valid_articles: [{ barcode_no: "ET214330016IN", calculated_tariff: 45 }],
      error_articles: [],
    });
    const { supabase } = bookingDb({ serviceCode, weightGrams });
    const outcome = await runIndiaPostBooking(supabase as never, {
      organizationId: "org-1",
      shipmentIds: ["ship-1"],
    });
    expect(outcome.booked).toBe(1);
    expect(bookShipmentMock).toHaveBeenCalledTimes(1);
    const body = bookShipmentMock.mock.calls[0][0] as { articles: Array<Record<string, string | number>> };
    expect(body).toEqual(expect.objectContaining({ articles: expect.any(Array) }));
    expectCeptParcelPayload(body.articles[0], serviceCode, weightGrams);
  });
});
