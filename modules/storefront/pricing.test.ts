import { describe, expect, it } from "vitest";
import { discountPercent } from "@/modules/storefront/pricing";
import { mapPublicProduct } from "@/modules/storefront/public";
import { publicStoreQuery, storeLinkRef } from "@/modules/storefront/schema";

describe("storefront pricing", () => {
  it("shows 30% off when compare-at is higher than offer price", () => {
    expect(discountPercent(699, 999)).toBe(30);
  });

  it("hides discount when there is no compare-at price", () => {
    expect(discountPercent(699, null)).toBeNull();
    expect(discountPercent(699, 500)).toBeNull();
  });

  it("never uses a client-supplied price on the public product card", () => {
    const mapped = mapPublicProduct({
      id: "11111111-1111-4111-8111-111111111111",
      name: "Tee",
      sku: "T1",
      price: 699,
      compare_at_price: 999,
      description: null,
      weight_grams: 200,
      prepaid_enabled: true,
      cod_enabled: true,
      image_urls: [],
      inventory_balances: [{ on_hand: 3 }],
    });
    expect(mapped.price).toBe(699);
    expect(mapped.compareAtPrice).toBe(999);
    expect(mapped.inStock).toBe(true);
  });
});

describe("storefront public link", () => {
  it("uses one merchant workspace as the permanent store ref", () => {
    expect(storeLinkRef({ workspace: "merchant-a" })).toEqual({ kind: "path", workspace: "merchant-a", publicId: undefined });
    expect(publicStoreQuery.parse({ workspace: "merchant-a" }).workspace).toBe("merchant-a");
  });

  it("marks out of stock when on-hand is zero", () => {
    const mapped = mapPublicProduct({
      id: "11111111-1111-4111-8111-111111111111",
      name: "Tee",
      sku: "T1",
      price: 699,
      inventory_balances: { on_hand: 0 },
    });
    expect(mapped.inStock).toBe(false);
  });
});
