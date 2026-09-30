import { describe, expect, it } from "vitest";
import { indiaPostChargeableWeightGrams, toIndiaPostPhysicalWeightGrams } from "@/modules/india-post/weight";

describe("India Post weight conversion", () => {
  it("rounds Shopify grams to a whole number", () => {
    expect(toIndiaPostPhysicalWeightGrams(499.4)).toBe(499);
    expect(toIndiaPostPhysicalWeightGrams("1500")).toBe(1500);
    expect(toIndiaPostPhysicalWeightGrams("x")).toBeNull();
  });

  it("uses the higher of actual and volumetric weight (L×W×H/5)", () => {
    expect(indiaPostChargeableWeightGrams({ physicalGrams: 250, lengthCm: 10, widthCm: 10, heightCm: 10 })).toBe(250);
    expect(indiaPostChargeableWeightGrams({ physicalGrams: 1500, lengthCm: 30, widthCm: 21, heightCm: 10 })).toBe(1500);
    expect(indiaPostChargeableWeightGrams({ physicalGrams: 100, lengthCm: 30, widthCm: 21, heightCm: 10 })).toBe(1260);
  });
});
