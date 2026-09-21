import { describe, expect, it } from "vitest";
import {
  indiaPostApiRoot,
  indiaPostBookingArticleType,
  indiaPostBookingUrl,
  indiaPostMobile,
  indiaPostSessionUrl,
  indiaPostShapeOfArticle,
} from "@/modules/india-post/endpoints";

describe("indiaPostApiRoot", () => {
  it("normalizes a host to /beextcustomer", () => {
    expect(indiaPostApiRoot("https://app.indiapost.gov.in")).toBe(
      "https://app.indiapost.gov.in/beextcustomer"
    );
  });

  it("keeps an explicit /beextcustomer root", () => {
    expect(indiaPostApiRoot("https://app.indiapost.gov.in/beextcustomer")).toBe(
      "https://app.indiapost.gov.in/beextcustomer"
    );
  });

  it("strips a trailing /v1 so login can add it back without booking inheriting it", () => {
    expect(indiaPostApiRoot("https://app.indiapost.gov.in/beextcustomer/v1")).toBe(
      "https://app.indiapost.gov.in/beextcustomer"
    );
    expect(indiaPostApiRoot("https://test.cept.gov.in/beextcustomer/v1/")).toBe(
      "https://test.cept.gov.in/beextcustomer"
    );
  });
});

describe("production login and booking URLs", () => {
  it("uses /v1 for production login", () => {
    expect(indiaPostSessionUrl("PRODUCTION", "/access/login")).toBe(
      "https://app.indiapost.gov.in/beextcustomer/v1/access/login"
    );
  });

  it("uses process-articles without /v1 for production booking", () => {
    const booking = indiaPostBookingUrl("PRODUCTION", "1788590988");
    expect(booking).toBe(
      "https://app.indiapost.gov.in/beextcustomer/process-articles/1788590988"
    );
    expect(booking).not.toContain("/v1/process-articles/");
  });

  it("keeps UAT booking on the documented no-/v1 route", () => {
    expect(indiaPostBookingUrl("UAT", "3000064781")).toBe(
      "https://test.cept.gov.in/beextcustomer/process-articles/3000064781"
    );
    expect(indiaPostSessionUrl("UAT", "/access/login")).toBe(
      "https://test.cept.gov.in/beextcustomer/v1/access/login"
    );
  });
});

describe("article type and shape", () => {
  it("sends SP and BP as documented for booking", () => {
    expect(indiaPostBookingArticleType("SP_INLAND_PARCEL")).toBe("SP");
    expect(indiaPostBookingArticleType("SP_INLAND_DOC")).toBe("SP");
    expect(indiaPostBookingArticleType("BUSINESS_PARCEL")).toBe("BP");
  });

  it("uses DOC for light Speed Post and NROL for parcels", () => {
    expect(indiaPostShapeOfArticle("SP_INLAND_DOC", 250)).toBe("DOC");
    expect(indiaPostShapeOfArticle("SP_INLAND_PARCEL", 1500)).toBe("NROL");
    expect(indiaPostShapeOfArticle("BUSINESS_PARCEL", 550)).toBe("NROL");
  });
});

describe("indiaPostMobile", () => {
  it("accepts a 10 digit Indian mobile", () => {
    expect(indiaPostMobile("+91 98765 43210")).toBe("9876543210");
  });

  it("rejects numbers that do not start with 6-9", () => {
    expect(indiaPostMobile("0000000000")).toBeNull();
    expect(indiaPostMobile("")).toBeNull();
  });
});
