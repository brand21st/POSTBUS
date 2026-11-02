import { describe, expect, it } from "vitest";
import { formatBarcode } from "@/modules/india-post/barcode";
import { indiaPostArticlesFileJson } from "@/modules/india-post/spec";
import { chunkIds, indiaPostBookingTransport } from "@/modules/india-post/booking-batch";
import {
  assessImportRows,
  canResumeBulkExcelBooking,
  canStartBulkExcelBooking,
  importRowsAwaitingShipment,
  type ImportStoreDefaults,
} from "@/modules/india-post/bulk-excel-validate";
import { INDIA_POST_JSON_BOOKING_MAX } from "@/modules/india-post/spec";

function defaults(overrides: Partial<ImportStoreDefaults> = {}): ImportStoreDefaults {
  return {
    serviceCode: "SP_INLAND_PARCEL",
    allowedServices: ["SP_INLAND_PARCEL", "BUSINESS_PARCEL"],
    customerId: "3000064781",
    contractId: "12345678",
    officeId: "12345678",
    originPin: "600001",
    senderName: "PostBus Store",
    senderCompany: "PostBus Store",
    senderLine1: "Warehouse Road",
    senderCity: "Chennai",
    senderState: "Tamil Nadu",
    senderPin: "600001",
    senderMobile: "9876543210",
    allocatableBarcodes: 10,
    usedBarcodes: new Set<string>(),
    ...overrides,
  };
}

function row(excelRowNumber: number, mapped: Record<string, string>) {
  return { excelRowNumber, mapped, unmapped: { "INTERNAL SKU": "SKU" } };
}

const validMapped = {
  receiver_name: "Rajesh Kumar",
  receiver_mobile_no: "9876543210",
  receiver_add_line_1: "12 Market Road",
  receiver_city: "Chennai",
  receiver_state: "Tamil Nadu",
  receiver_pincode: "600052",
  physical_weight: "1000",
  length: "20",
  breadth_diameter: "15",
  height: "10",
  shape_of_article: "NROL",
  barcode_no: formatBarcode("EY", 12345678, "IN"),
  bulk_reference: "1001",
};

describe("bulk excel validation", () => {
  it("accepts a complete PostBridge row and keeps unmapped columns", () => {
    const result = assessImportRows([row(3, validMapped)], defaults());
    expect(result.rows[0]?.issues.map((issue) => `${issue.field}: ${issue.error}`)).toEqual([]);
    expect(result.rows[0]?.valid).toBe(true);
    expect(result.rows[0]?.unmapped["INTERNAL SKU"]).toBe("SKU");
    expect(result.rows[0]?.normalized.pincode).toBe("600052");
    expect(result.rows[0]?.normalized.paymentMode).toBe("PREPAID");
  });

  it("reports missing receiver fields, invalid COD, duplicates, and mixed rows", () => {
    const result = assessImportRows(
      [
        row(2, { ...validMapped, receiver_pincode: "", barcode_no: "" }),
        row(3, { ...validMapped, codr_cod: "MAYBE", value_for_codr_cod: "-1", barcode_no: "RK000000510IN" }),
        row(4, { ...validMapped, codr_cod: "COD", value_for_codr_cod: "0", barcode_no: "RK000000510IN" }),
        row(5, { ...validMapped, barcode_no: "9.876E+12" }),
      ],
      defaults({ usedBarcodes: new Set(["RK000000510IN"]) })
    );
    expect(result.rows[0]?.valid).toBe(false);
    expect(result.rows[0]?.issues.some((issue) => issue.field === "receiver_pincode")).toBe(true);
    expect(result.rows[1]?.issues.some((issue) => issue.field === "codr_cod")).toBe(true);
    expect(result.rows[2]?.issues.some((issue) => /duplicate barcode/i.test(issue.error))).toBe(true);
    expect(result.rows[3]?.issues.some((issue) => /scientific/i.test(issue.error))).toBe(true);
    expect(result.rows.filter((item) => item.valid)).toHaveLength(0);
  });

  it("rejects a service that is not on the contract and a second barcode inside the file", () => {
    const result = assessImportRows(
      [
        row(2, validMapped),
        row(3, { ...validMapped, article_type: "BUSINESS_PARCEL" }),
      ],
      defaults({ allowedServices: ["SP_INLAND_PARCEL"] })
    );
    expect(result.rows[1]?.issues.some((issue) => issue.field === "article_type")).toBe(true);
    expect(result.rows[1]?.issues.some((issue) => /duplicate barcode/i.test(issue.error))).toBe(true);
  });

  it("does not start booking from upload statuses and does not retry an in-flight batch", () => {
    expect(canStartBulkExcelBooking("mapped")).toBe(false);
    expect(canStartBulkExcelBooking("validated")).toBe(true);
    expect(canStartBulkExcelBooking("draft")).toBe(true);
    expect(canResumeBulkExcelBooking("booking")).toBe(true);
    expect(canStartBulkExcelBooking("booking")).toBe(false);
  });

  it("skips rows that already have a shipment after a worker restart", () => {
    const pending = importRowsAwaitingShipment([
      { status: "valid", shipment_id: null },
      { status: "valid", shipment_id: "ship-1" },
      { status: "invalid", shipment_id: null },
    ]);
    expect(pending).toHaveLength(1);
    expect(pending[0]?.shipment_id).toBeNull();
  });

  it("builds a file-booking JSON body and chunks below the JSON ceiling without calling fetch", () => {
    const fetchCalls = { count: 0 };
    const original = globalThis.fetch;
    globalThis.fetch = ((...args: Parameters<typeof fetch>) => {
      fetchCalls.count += 1;
      return original(...args);
    }) as typeof fetch;
    const articles = [{ barcode_no: formatBarcode("EY", 12345678, "IN") }];
    expect(JSON.parse(indiaPostArticlesFileJson(articles))).toEqual({ articles });
    const chunks = chunkIds(Array.from({ length: 1000 }, (_, index) => index), INDIA_POST_JSON_BOOKING_MAX);
    expect(chunks[0]?.length).toBe(999);
    expect(chunks).toHaveLength(2);
    expect(indiaPostBookingTransport(2)).toBe("json");
    expect(fetchCalls.count).toBe(0);
    globalThis.fetch = original;
  });
});
