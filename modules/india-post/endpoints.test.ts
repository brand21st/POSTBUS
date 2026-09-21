import { describe, expect, it } from "vitest";
import {
  indiaPostBookingArticleType,
  indiaPostBookingUrl,
  indiaPostMobile,
  indiaPostOrigin,
  indiaPostSessionUrl,
  indiaPostShapeOfArticle,
} from "@/modules/india-post/endpoints";

describe("indiaPostOrigin", () => {
  it("keeps a bare host", () => {
    expect(indiaPostOrigin("https://app.indiapost.gov.in")).toBe("https://app.indiapost.gov.in");
  });

  it("strips /beextcustomer/v1 from a session URL", () => {
    expect(indiaPostOrigin("https://app.indiapost.gov.in/beextcustomer/v1/")).toBe(
      "https://app.indiapost.gov.in"
    );
  });

  it("strips /beextcustomer from a booking URL", () => {
    expect(indiaPostOrigin("https://test.cept.gov.in/beextcustomer")).toBe("https://test.cept.gov.in");
  });
});

describe("indiaPost session and booking URLs", () => {
  it("puts login under /v1", () => {
    expect(indiaPostSessionUrl("PRODUCTION", "/access/login")).toBe(
      "https://app.indiapost.gov.in/beextcustomer/v1/access/login"
    );
  });

  it("puts booking outside /v1", () => {
    expect(indiaPostBookingUrl("PRODUCTION", "1788590988")).toBe(
      "https://app.indiapost.gov.in/beextcustomer/process-articles/1788590988"
    );
    expect(indiaPostBookingUrl("UAT", "3000064781")).toBe(
      "https://test.cept.gov.in/beextcustomer/process-articles/3000064781"
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
