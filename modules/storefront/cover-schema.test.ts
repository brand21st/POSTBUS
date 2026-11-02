import { describe, expect, it } from "vitest";
import { parseSafeCoverHref, storefrontCoverSchema } from "@/modules/storefront/schema";

describe("parseSafeCoverHref", () => {
  it("allows store paths hashes and https", () => {
    expect(parseSafeCoverHref("/store/samanga")).toBe("/store/samanga");
    expect(parseSafeCoverHref("#sarees")).toBe("#sarees");
    expect(parseSafeCoverHref("https://example.com/sale")).toBe("https://example.com/sale");
    expect(parseSafeCoverHref("/store/samanga#sale")).toBe("/store/samanga#sale");
  });

  it("rejects javascript data and protocol-relative urls", () => {
    expect(parseSafeCoverHref("javascript:alert(1)")).toBeNull();
    expect(parseSafeCoverHref("data:text/html,hi")).toBeNull();
    expect(parseSafeCoverHref("//evil.example/x")).toBeNull();
    expect(parseSafeCoverHref("http://example.com/sale")).toBeNull();
  });
});

describe("storefrontCoverSchema", () => {
  it("rejects unsafe CTAs and invalid discounts", () => {
    expect(() => storefrontCoverSchema.parse({ ctaHref: "javascript:alert(1)" })).toThrow();
    expect(() => storefrontCoverSchema.parse({ discountPercent: 91 })).toThrow();
  });

  it("rejects an end date before the start date", () => {
    expect(() =>
      storefrontCoverSchema.parse({
        startsAt: "2026-10-12T00:00:00.000Z",
        endsAt: "2026-10-11T00:00:00.000Z",
      })
    ).toThrow(/End date/);
  });
});
