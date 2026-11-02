import { describe, expect, it } from "vitest";
import { offerCopyFromInput, offerDiscountPercent } from "@/modules/ai-image/offer";

describe("offerDiscountPercent", () => {
  it("computes 33% off from ₹1,499 to ₹999", () => {
    expect(offerDiscountPercent(99900, 149900)).toBe(33);
  });

  it("does not invent a discount when compare-at is missing or lower", () => {
    expect(offerDiscountPercent(99900, null)).toBe(0);
    expect(offerDiscountPercent(149900, 99900)).toBe(0);
  });
});

describe("offerCopyFromInput", () => {
  it("uses merchant text only", () => {
    const copy = offerCopyFromInput({
      productName: "Luxury Perfume",
      pricePaise: 99900,
      compareAtPaise: 149900,
      headline: "SPECIAL OFFER",
      cta: "SHOP NOW",
    });
    expect(copy.name).toBe("Luxury Perfume");
    expect(copy.price).toContain("999");
    expect(copy.compareAt).toContain("1,499");
    expect(copy.discountPercent).toBe(33);
    expect(copy.headline).toBe("SPECIAL OFFER");
    expect(copy.cta).toBe("SHOP NOW");
  });
});
