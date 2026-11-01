import { describe, expect, it } from "vitest";
import {
  selectActiveShopifyLineItems,
  shopifyCurrentQuantity,
  shopifyLineSnapshotNeedsRefresh,
  shopifyOrderLooksEdited,
} from "@/modules/shopify/line-items";

const deposit = {
  id: 17109345435840,
  title: "SAND DARK WIDE",
  sku: "SAND-DARK-WIDE-34",
  quantity: 1,
  current_quantity: 0,
  price: "314.70",
};

const replacement = {
  id: 17109345763520,
  title: "SAND DARK WIDE",
  sku: "SAND-DARK-WIDE-34",
  quantity: 1,
  current_quantity: 1,
  price: "1049.00",
};

describe("selectActiveShopifyLineItems", () => {
  it("drops removed deposit lines and keeps the replacement LineItem id", () => {
    const selected = selectActiveShopifyLineItems({
      edited: true,
      tags: ["order-edited"],
      line_items: [deposit, replacement],
    });
    expect(selected.skipLineWrite).toBe(false);
    expect(selected.items).toEqual([
      expect.objectContaining({
        id: "gid://shopify/LineItem/17109345763520",
        quantity: 1,
        current_quantity: 1,
        price: "1049.00",
      }),
    ]);
  });

  it("keeps two active lines that share a SKU", () => {
    const selected = selectActiveShopifyLineItems({
      edited: true,
      line_items: [
        { id: 1, sku: "TEE", title: "Tee S", quantity: 2, current_quantity: 0, price: "40" },
        { id: 2, sku: "TEE", title: "Tee S", quantity: 2, current_quantity: 2, price: "499" },
        { id: 3, sku: "TEE", title: "Tee XL", quantity: 1, current_quantity: 1, price: "499" },
      ],
    });
    expect(selected.items.map((item) => item.id)).toEqual([
      "gid://shopify/LineItem/2",
      "gid://shopify/LineItem/3",
    ]);
    expect(selected.items.map((item) => item.quantity)).toEqual([2, 1]);
  });

  it("falls back to original quantity when the order is not edited and current quantity is omitted", () => {
    const selected = selectActiveShopifyLineItems({
      line_items: [{ id: 9, title: "Mug", quantity: 3, price: "10" }],
    });
    expect(selected.items).toEqual([
      expect.objectContaining({
        id: "gid://shopify/LineItem/9",
        quantity: 3,
        current_quantity: 3,
      }),
    ]);
    expect(selected.skipLineWrite).toBe(false);
    expect(shopifyLineSnapshotNeedsRefresh({ line_items: selected.items })).toBe(false);
  });

  it("refuses to guess original quantity on an edited order with missing current quantity", () => {
    const selected = selectActiveShopifyLineItems({
      edited: true,
      line_items: [
        { id: 1, title: "Deposit", quantity: 1, price: "314.70" },
        { id: 2, title: "Product", quantity: 1, price: "1049.00" },
      ],
    });
    expect(selected.items).toEqual([]);
    expect(selected.skipLineWrite).toBe(true);
    expect(selected.needsAuthoritativeRead).toBe(true);
    expect(shopifyLineSnapshotNeedsRefresh({ edited: true, line_items: [{ quantity: 1 }] })).toBe(true);
  });

  it("detects order-edited tags and mixed current quantities", () => {
    expect(shopifyOrderLooksEdited({ tags: "COD-Balance-1, order-edited" })).toBe(true);
    expect(shopifyCurrentQuantity({ quantity: 1, currentQuantity: 0 })).toBe(0);
    expect(
      shopifyOrderLooksEdited({
        line_items: [
          { quantity: 1, current_quantity: 0 },
          { quantity: 1, current_quantity: 1 },
        ],
      })
    ).toBe(true);
  });
});
