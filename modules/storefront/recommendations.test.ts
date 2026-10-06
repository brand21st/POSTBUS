import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/api/errors";
import { quoteCatalogPayment } from "@/modules/storefront/quote";
import { pickStoreRecommendations } from "@/modules/storefront/recommendations";
import { assertStorePublished } from "@/modules/storefront/public";
import type { StoreProduct } from "@/components/storefront/store-types";

function product(partial: Partial<StoreProduct> & { id: string; name: string }): StoreProduct {
  return {
    sku: partial.id,
    description: null,
    price: 100,
    compareAtPrice: null,
    discountPercent: null,
    imageUrls: [],
    onHand: 4,
    inStock: true,
    prepaidEnabled: true,
    codEnabled: true,
    ...partial,
  };
}

describe("store recommendations", () => {
  it("prefers configured ids then same-category fallback within a 4-item cap", () => {
    const catalog = [
      product({ id: "a", name: "A", categoryIds: ["c1"] }),
      product({ id: "b", name: "B", categoryIds: ["c1"] }),
      product({ id: "c", name: "C", categoryIds: ["c2"] }),
      product({ id: "d", name: "D", categoryIds: ["c1"] }),
      product({ id: "e", name: "E", categoryIds: ["c1"] }),
    ];
    const picked = pickStoreRecommendations(catalog, [{ product: catalog[0], quantity: 1 }], ["c"], {
      categoryIds: ["c1"],
      excludeId: "a",
      limit: 4,
    });
    expect(picked.map((item) => item.id)).toEqual(["c", "b", "d", "e"]);
  });
});

describe("unpublished stores", () => {
  it("blocks public catalog access when the store is unpublished", async () => {
    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: { published: false }, error: null }),
          }),
        }),
      }),
    };
    await expect(assertStorePublished(supabase as never, "org-1")).rejects.toThrow(AppError);
    await expect(assertStorePublished(supabase as never, "org-1")).rejects.toThrow(/unavailable/i);
  });
});

describe("quote validation", () => {
  it("rejects mixed prepaid-ineligible carts", () => {
    expect(() =>
      quoteCatalogPayment({
        preference: "PREPAID",
        lines: [
          {
            unitPrice: 100,
            quantity: 1,
            prepaidEnabled: false,
            codEnabled: true,
            codAdvancePercent: 0,
          },
        ],
      })
    ).toThrow(/prepaid/i);
  });
});
