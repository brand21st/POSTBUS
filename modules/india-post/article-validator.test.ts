import { describe, expect, it } from "vitest";
import { mapShipmentToArticle } from "@/modules/india-post/article-mapper";
import { validateIndiaPostArticle } from "@/modules/india-post/article-validator";
import { assertPayloadCoversDocumentedFields, indiaPostBookingArticle } from "@/modules/india-post/booking-payload";
import { splitIndiaPostBookingResult } from "@/modules/india-post/booking-apply";
import { chunkIds, indiaPostBookingTransport } from "@/modules/india-post/booking-batch";
import { CEPT_BOOKING_FIELD_NAMES } from "@/modules/india-post/article-fields";

function baseDraft(overrides: Record<string, unknown> = {}) {
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
    senderName: "Kerlaz",
    senderCompany: "Kerlaz Stores",
    senderLine1: "Kolenchery road",
    senderCity: "Ernakulam",
    senderState: "Kerala",
    senderPin: "682311",
    senderMobile: "9876543210",
    receiverName: "Vishnu Priya",
    receiverLine1: "Sulakkarai street",
    receiverCity: "Virudhunagar",
    receiverState: "Tamil Nadu",
    receiverPin: "626003",
    receiverMobile: "9944388249",
    paymentMode: "PREPAID",
    strictDimensions: true,
    ...overrides,
  });
}

describe("India Post article validation", () => {
  it("accepts a complete parcel article", () => {
    expect(validateIndiaPostArticle(baseDraft())).toEqual([]);
  });

  it("rejects a non-digit receiver pincode before queueing", () => {
    const issues = validateIndiaPostArticle(baseDraft({ receiverPin: "673121A" }));
    expect(issues.some((issue) => issue.field === "receiver_pincode")).toBe(true);
    expect(issues[0]?.error).toMatch(/exactly 6 digits/i);
  });

  it("does not treat unpaid prepaid as COD", () => {
    const issues = validateIndiaPostArticle(baseDraft({ paymentMode: "PREPAID", codAmount: 0 }));
    expect(issues.filter((issue) => issue.field === "value_for_codr_cod")).toHaveLength(0);
  });

  it("requires a collectable amount when COD is set", () => {
    const issues = validateIndiaPostArticle(baseDraft({ paymentMode: "COD", codAmount: 0 }));
    expect(issues.some((issue) => issue.field === "value_for_codr_cod")).toBe(true);
  });

  it("fails missing parcel dimensions instead of inventing them", () => {
    const issues = validateIndiaPostArticle(baseDraft({ lengthCm: 0, widthCm: 0, heightCm: 0, strictDimensions: true }));
    expect(issues.some((issue) => issue.field === "length")).toBe(true);
  });

  it("rejects an invalid S10 barcode instead of randomizing one", () => {
    const issues = validateIndiaPostArticle(baseDraft({ barcode: "RK000000510XX" }));
    expect(issues.some((issue) => issue.field === "barcode_no")).toBe(true);
  });

  it("fails bulk weight when missing instead of defaulting 100 g", () => {
    const issues = validateIndiaPostArticle(baseDraft({ weightGrams: 0, strictWeight: true }));
    expect(issues.some((issue) => issue.field === "physical_weight")).toBe(true);
  });

  it("applies document dimension limits to Speed Post under 500 g", () => {
    const issues = validateIndiaPostArticle(
      baseDraft({ serviceCode: "SP_INLAND_PARCEL", weightGrams: 250, lengthCm: 20, widthCm: 15, heightCm: 10, strictDimensions: true })
    );
    expect(issues.some((issue) => issue.field === "height")).toBe(true);
  });

  it("allows a 50-character bulk_reference", () => {
    const ref = "B".repeat(50);
    expect(validateIndiaPostArticle(baseDraft({ bulkReference: ref }))).toEqual([]);
    const issues = validateIndiaPostArticle(baseDraft({ bulkReference: `${ref}X` }));
    expect(issues.some((issue) => issue.field === "bulk_reference")).toBe(true);
  });

  it("does not enable insurance by default", () => {
    const payload = indiaPostBookingArticle({
      customerId: "1788590988",
      contractId: "41793509",
      barcode: "ET214330016IN",
      officeId: "22660454",
      originPin: "682311",
      serviceCode: "BUSINESS_PARCEL",
      weightGrams: 500,
      lengthCm: 20,
      widthCm: 15,
      heightCm: 10,
      senderName: "kerlaz",
      senderLine1: "Registered pickup road",
      senderCity: "Ernakulam",
      senderState: "Kerala",
      senderMobile: "9876543210",
      receiverName: "Vishnu Priya",
      receiverLine1: "Sulakkarai",
      receiverCity: "Kurakkundu",
      receiverState: "Tamil Nadu",
      receiverPin: "626003",
      receiverMobile: "9944388249",
    });
    expect(payload.otp).toBe("FALSE");
    expect(payload.insurance_type).toBe("");
    expect(payload.codr_cod).toBe("");
    expect(payload.sender_add_line_3).toBe("");
    expect(payload.receiver_add_line_3).toBe("");
    expect(assertPayloadCoversDocumentedFields(payload)).toEqual([]);
    expect(Object.keys(payload).sort()).toEqual([...CEPT_BOOKING_FIELD_NAMES].sort());
  });
});

describe("India Post booking response split", () => {
  it("keeps valid and error articles separate", () => {
    const split = splitIndiaPostBookingResult({
      batch_id: "batch_1",
      correlation_id: "corr_1",
      valid_articles: [{ barcode_no: "EB468827991IN", calculated_tariff: 17 }],
      error_articles: [{ barcode_no: "EB468790992IN", errors: ["Dropoff pincode must be exactly 6 digits"] }],
    });
    expect(split.valid.has("EB468827991IN")).toBe(true);
    expect(split.failed.get("EB468790992IN")).toMatch(/Dropoff pincode/);
    expect(split.valid.has("EB468790992IN")).toBe(false);
  });
});

describe("booking batch transport", () => {
  it("uses JSON below 1000 articles and file at 1000+", () => {
    expect(indiaPostBookingTransport(1)).toBe("json");
    expect(indiaPostBookingTransport(999)).toBe("json");
    expect(indiaPostBookingTransport(1000)).toBe("file");
    expect(chunkIds(["a", "b", "c", "d"], 2)).toEqual([["a", "b"], ["c", "d"]]);
  });

  it("splits mocked CEPT batches of 1, 5, 10, 100 and 500", () => {
    for (const size of [1, 5, 10, 100, 500]) {
      const barcodes = Array.from({ length: size }, (_, index) => formatMockBarcode(index));
      const failedBarcode = size > 1 ? barcodes[size - 1] : null;
      const split = splitIndiaPostBookingResult({
        batch_id: `batch_${size}`,
        correlation_id: `corr_${size}`,
        valid_articles: barcodes
          .filter((barcode) => barcode !== failedBarcode)
          .map((barcode_no) => ({ barcode_no })),
        error_articles: failedBarcode ? [{ barcode_no: failedBarcode, errors: ["weight"] }] : [],
      });
      expect(split.valid.size + split.failed.size).toBe(size);
      if (failedBarcode) expect(split.failed.size).toBe(1);
      expect(chunkIds(barcodes, 50).flat()).toHaveLength(size);
    }
  });
});

function formatMockBarcode(index: number) {
  return `EB${String(468790000 + index).padStart(9, "0")}IN`;
}
