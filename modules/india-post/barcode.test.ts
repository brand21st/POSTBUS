import { describe, expect, it } from "vitest";
import {
  formatBarcode,
  indiaPostAcceptedArticleId,
  indiaPostPublicTrackingUrl,
  isCeptUatTestSeries,
  parseBarcodeRange,
} from "@/modules/india-post/barcode";

describe("formatBarcode", () => {
  it("builds a 13 character S10 article number with check digit", () => {
    const barcode = formatBarcode("ET", 21433001, "IN");
    expect(barcode).toBe("ET214330016IN");
    expect(barcode).toHaveLength(13);
  });

  it("matches the UPU S10 example EE123456785GB", () => {
    expect(formatBarcode("EE", 12345678, "GB")).toBe("EE123456785GB");
  });

  it("matches the live Kolenchery Business Parcel article", () => {
    expect(formatBarcode("CL", 55697399, "IN")).toBe("CL556973995IN");
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

  it("rejects numbers longer than eight digits", () => {
    expect(() => parseBarcodeRange({ ...valid, endNumber: 100_000_000 })).toThrow(/8 digits/);
  });

  it("rejects an end below the start", () => {
    expect(() => parseBarcodeRange({ ...valid, startNumber: 500, endNumber: 400 })).toThrow(
      /same as or above/
    );
  });
});

describe("isCeptUatTestSeries", () => {
  it("flags the documented UAT serial range even if the prefix was changed to CL", () => {
    expect(isCeptUatTestSeries("ET", 21433001, 21434000)).toBe(true);
    expect(isCeptUatTestSeries("CL", 21433001, 21434000)).toBe(true);
    expect(isCeptUatTestSeries("CL", 55697399, 55697499)).toBe(false);
  });
});

describe("india post public tracking", () => {
  it("uses the article number India Post accepted on booking", () => {
    expect(
      indiaPostAcceptedArticleId({ article_number: "cl556974704in" }, "CL000000001IN")
    ).toBe("CL556974704IN");
  });

  it("builds the India Post consignment tracking URL", () => {
    expect(indiaPostPublicTrackingUrl("CL556974704IN")).toBe(
      "https://www.indiapost.gov.in/_layouts/15/dop.portal.tracking/trackconsignment.aspx?articleid=CL556974704IN"
    );
  });
});
