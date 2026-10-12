import { describe, expect, it } from "vitest";
import { formatOrderWindow, orderWindowRemaining, searchMatches, trendingProducts } from "@/modules/storefront/trending";
import type { StoreProduct } from "@/components/storefront/store-types";

function product(partial: Partial<StoreProduct> & { id: string; name: string }): StoreProduct {
  return {
    sku: partial.id, description: null, price: 100, compareAtPrice: null, discountPercent: null,
    imageUrls: [], onHand: 3, inStock: true, prepaidEnabled: true, codEnabled: true, ...partial,
  };
}

describe("trending search", () => {
  it("prefers in-stock best sellers and skips duplicates", () => {
    const items = [
      product({ id: "a", name: "Alpha" }),
      product({ id: "b", name: "Beta", bestSeller: true }),
      product({ id: "b", name: "Beta", bestSeller: true }),
      product({ id: "c", name: "Gamma", inStock: false }),
    ];
    expect(trendingProducts(items, 3).map((item) => item.id)).toEqual(["b", "a"]);
    expect(searchMatches(items, "alp").map((item) => item.id)).toEqual(["a"]);
  });
});

describe("order window", () => {
  it("counts down until 6:00 pm IST and stops after that", () => {
    expect(orderWindowRemaining(new Date("2026-10-11T15:00:00+05:30"))).toBe(3 * 3600);
    expect(orderWindowRemaining(new Date("2026-10-11T18:00:00+05:30"))).toBeNull();
    expect(formatOrderWindow(3 * 3600 + 5 * 60)).toBe("3h 05m");
  });
});
