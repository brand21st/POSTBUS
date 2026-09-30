import { describe, expect, it } from "vitest";
import {
  barcodeStockForService,
  barcodesLeft,
  formatBarcode,
  indiaPostAcceptedArticleId,
  indiaPostPublicTrackingUrl,
  isCeptUatTestSeries,
  parseBarcodeRange,
  isValidIndiaPostS10,
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
    expect(isValidIndiaPostS10("CL556973995IN")).toBe(true);
    expect(isValidIndiaPostS10("CL556973990IN")).toBe(false);
  });
});

describe("barcodesLeft", () => {
  const shared = {
    prefix: "CL",
    suffix: "IN",
    startNumber: 55697399,
    endNumber: 55697999,
    nextNumber: 55697399,
    serviceCode: null,
  };

  it("counts the unused serials in an allotted series", () => {
    expect(barcodesLeft(shared)).toBe(601);
    expect(barcodesLeft({ ...shared, nextNumber: 55698000 })).toBe(0);
  });

  it("uses a service series before the shared series", () => {
    const business = { ...shared, prefix: "ET", serviceCode: "BUSINESS_PARCEL", nextNumber: 55697990 };
    expect(barcodeStockForService([shared, business], "BUSINESS_PARCEL")?.prefix).toBe("ET");
    expect(barcodesLeft(barcodeStockForService([shared, business], "SP_INLAND_PARCEL"))).toBe(601);
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

  it("accepts a 9-digit allotment number and stores the 8-digit serial", () => {
    expect(
      parseBarcodeRange({
        prefix: "CL",
        suffix: "IN",
        startNumber: 556973995,
        endNumber: "556979998",
      })
    ).toMatchObject({ startNumber: 55697399, endNumber: 55697999 });
  });

  it("rejects a 9-digit number whose check digit is wrong", () => {
    expect(() => parseBarcodeRange({ ...valid, endNumber: 556973996 })).toThrow(/check digit/);
    expect(() => parseBarcodeRange({ ...valid, endNumber: 556973996 })).toThrow(/should be 5/);
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
