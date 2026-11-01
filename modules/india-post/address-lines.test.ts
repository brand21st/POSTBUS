import { describe, expect, it } from "vitest";
import { wrapIndiaPostAddressLines } from "@/modules/india-post/address-lines";
import { INDIA_POST_ADDRESS_LINE_MAX } from "@/modules/india-post/spec";

describe("wrapIndiaPostAddressLines", () => {
  it("keeps a short two-line address", () => {
    expect(wrapIndiaPostAddressLines("12 Market Road", "Near park")).toEqual({
      line1: "12 Market Road",
      line2: "Near park",
      line3: undefined,
    });
  });

  it("drops a 1–2 character extra line by merging it", () => {
    const wrapped = wrapIndiaPostAddressLines("12 Market Road", "ab");
    expect(wrapped.line1).toBe("12 Market Road ab");
    expect(wrapped.line2).toBeUndefined();
  });

  it("splits a long line 2 across line 2 and line 3", () => {
    const line2 =
      "Near the old bus stand opposite State Bank of India, Ward 4, behind the municipal office complex";
    const wrapped = wrapIndiaPostAddressLines("House 12 Green Park", line2);
    expect(wrapped.line1.length).toBeGreaterThanOrEqual(3);
    expect(wrapped.line1.length).toBeLessThanOrEqual(INDIA_POST_ADDRESS_LINE_MAX);
    expect(wrapped.line2?.length ?? 0).toBeGreaterThanOrEqual(3);
    expect(wrapped.line2?.length ?? 0).toBeLessThanOrEqual(INDIA_POST_ADDRESS_LINE_MAX);
    expect((wrapped.line2 ?? "") + (wrapped.line3 ?? "")).toContain("municipal");
    expect(wrapped.line3?.length ?? 0).toBeLessThanOrEqual(INDIA_POST_ADDRESS_LINE_MAX);
  });
});
