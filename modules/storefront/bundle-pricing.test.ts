import { describe, expect, it } from "vitest";
import { allocateBundlePrices, bundleInputSchema } from "@/modules/storefront/bundle-pricing";
import { bundleCartLine, cartRequest, ungroupBundle } from "@/modules/storefront/cart";
import type { StoreBundle, StoreProduct } from "@/components/storefront/store-types";

function product(id: string, price: number, onHand = 5): StoreProduct {
  return {
    id, name: id, sku: id, description: null, price, compareAtPrice: null, discountPercent: null,
    imageUrls: [], onHand, inStock: onHand > 0, prepaidEnabled: true, codEnabled: true, returnAvailable: true,
  };
}

describe("bundle price allocation", () => {
  it("reconciles a percent discount to integer paise", () => {
    const priced = allocateBundlePrices(
      [{ productId: "a", price: 10.01, quantity: 1 }, { productId: "b", price: 10.01, quantity: 1 }, { productId: "c", price: 10.01, quantity: 1 }],
      "PERCENT",
      10
    );
    const paise = priced.lines.reduce((sum, line) => sum + Math.round(line.unitPrice * 100) * line.quantity, 0);
    expect(paise).toBe(Math.round(priced.total * 100));
    expect(priced.total).toBeLessThan(priced.subtotal);
  });

  it("splits a fixed total with the largest remainder and quantity extras", () => {
    const priced = allocateBundlePrices(
      [{ productId: "a", price: 1, quantity: 2 }, { productId: "b", price: 1, quantity: 1 }],
      "FIXED",
      2
    );
    const paise = priced.lines.reduce((sum, line) => sum + Math.round(line.unitPrice * 100) * line.quantity, 0);
    expect(priced.total).toBe(2);
    expect(paise).toBe(200);
    expect(priced.lines.reduce((sum, line) => sum + line.quantity, 0)).toBe(3);
  });

  it("rejects a bundle priced above its products", () => {
    expect(() => allocateBundlePrices([{ productId: "a", price: 40, quantity: 1 }, { productId: "b", price: 20, quantity: 1 }], "FIXED", 70)).toThrow(/positive/i);
  });

  it("requires distinct components", () => {
    expect(bundleInputSchema.safeParse({
      name: "Pair", pricingMode: "PERCENT", priceValue: 10, published: true, sortOrder: 0,
      items: [{ productId: "11111111-1111-4111-8111-111111111111", quantity: 1 }, { productId: "11111111-1111-4111-8111-111111111111", quantity: 1 }],
    }).success).toBe(false);
  });
});

describe("bundle cart groups", () => {
  const bundle: StoreBundle = {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Pair",
    pricingMode: "FIXED",
    priceValue: 90,
    total: 90,
    subtotal: 120,
    savings: 30,
    components: [{ product: product("a", 70), quantity: 1 }, { product: product("b", 50), quantity: 1 }],
  };

  it("sends bundle ids without client discounts and restores component prices when ungrouped", () => {
    const line = bundleCartLine(bundle);
    expect(cartRequest([line, { product: product("a", 70), quantity: 1 }])).toEqual({
      items: [{ productId: "a", quantity: 1 }],
      bundles: [{ bundleId: bundle.id, quantity: 1 }],
    });
    const split = ungroupBundle([line], line.product.id);
    expect(split.every((item) => !item.bundle)).toBe(true);
    expect(split.reduce((sum, item) => sum + item.product.price * item.quantity, 0)).toBe(120);
  });
});
