import { describe, expect, it } from "vitest";
import { formatBarcode, parseBarcodeRange } from "@/modules/india-post/barcode";

describe("formatBarcode", () => {
  it("builds a 13 character article number", () => {
    const barcode = formatBarcode("ET", 21433001, "IN");
    expect(barcode).toBe("ET021433001IN");
    expect(barcode).toHaveLength(13);
  });
});

describe("parseBarcodeRange", () => {
  const valid = { prefix: "ET", suffix: "IN", startNumber: 21433001, endNumber: 21434000 };

  it("accepts an allotted range", () => {
    expect(parseBarcodeRange(valid)).toEqual({
      prefix: "ET",
      suffix: "IN",
      startNumber: 21433001,
      endNumber: 21434000,
      serviceCode: null,
    });
  });

  it("uppercases and defaults the suffix to IN", () => {
    const range = parseBarcodeRange({ ...valid, prefix: "et", suffix: undefined });
    expect(range.prefix).toBe("ET");
    expect(range.suffix).toBe("IN");
  });

  it("keeps a service code when given", () => {
    expect(parseBarcodeRange({ ...valid, serviceCode: "BUSINESS_PARCEL" }).serviceCode).toBe(
      "BUSINESS_PARCEL"
    );
  });

  it("rejects a prefix that is not two letters", () => {
    expect(() => parseBarcodeRange({ ...valid, prefix: "#330" })).toThrow(/two letters/);
    expect(() => parseBarcodeRange({ ...valid, prefix: "E" })).toThrow(/two letters/);
    expect(() => parseBarcodeRange({ ...valid, prefix: "E1" })).toThrow(/two letters/);
  });

  it("rejects a suffix that is not two letters", () => {
    expect(() => parseBarcodeRange({ ...valid, suffix: "IND" })).toThrow(/two letters/);
  });

  it("rejects numbers that are not positive whole numbers", () => {
    expect(() => parseBarcodeRange({ ...valid, startNumber: 0 })).toThrow(/above zero/);
    expect(() => parseBarcodeRange({ ...valid, startNumber: -5 })).toThrow(/above zero/);
    expect(() => parseBarcodeRange({ ...valid, endNumber: 1.5 })).toThrow(/whole number/);
    expect(() => parseBarcodeRange({ ...valid, endNumber: "abc" })).toThrow(/whole number/);
  });

  it("rejects numbers longer than nine digits", () => {
    expect(() => parseBarcodeRange({ ...valid, endNumber: 1_000_000_000 })).toThrow(/9 digits/);
  });

  it("rejects an end below the start", () => {
    expect(() => parseBarcodeRange({ ...valid, startNumber: 500, endNumber: 400 })).toThrow(
      /same as or above/
    );
  });
});
