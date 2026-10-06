import { describe, expect, it } from "vitest";
import {
  adjustInventorySchema,
  createProductSchema,
  editProductFormSchema,
  updateProductSchema,
} from "@/modules/products/schema";

describe("product schemas", () => {
  it("accepts a low-stock threshold", () => {
    expect(createProductSchema.parse({
      name: "X",
      sku: "X-1",
      price: 1,
      weightGrams: 1,
      prepaidEnabled: true,
      codEnabled: true,
      lowStockThreshold: 8,
    }).lowStockThreshold).toBe(8);
  });

  it("creates a product with opening stock and COD advance", () => {
    const parsed = createProductSchema.parse({
      name: "Premium T-Shirt",
      sku: "TSHIRT-001",
      price: 999,
      weightGrams: 250,
      openingStock: 100,
      prepaidEnabled: true,
      codEnabled: true,
      codAdvancePercent: 30,
    });
    expect(parsed.openingStock).toBe(100);
    expect(parsed.codAdvancePercent).toBe(30);
  });

  it("rejects products with neither prepaid nor COD", () => {
    expect(() =>
      createProductSchema.parse({
        name: "X",
        sku: "X-1",
        price: 1,
        weightGrams: 1,
        prepaidEnabled: false,
        codEnabled: false,
      })
    ).toThrow();
  });

  it("rejects a COD advance over 100", () => {
    expect(() =>
      createProductSchema.parse({
        name: "X",
        sku: "X-1",
        price: 1,
        weightGrams: 1,
        prepaidEnabled: true,
        codEnabled: true,
        codAdvancePercent: 120,
      })
    ).toThrow();
  });

  it("rejects a zero stock adjustment", () => {
    expect(() => adjustInventorySchema.parse({ quantityDelta: 0 })).toThrow();
  });

  it("rejects turning off both payment modes on update", () => {
    expect(() => updateProductSchema.parse({ prepaidEnabled: false, codEnabled: false })).toThrow();
  });

  it("accepts up to 3 image URLs on update", () => {
    expect(
      updateProductSchema.parse({
        imageUrls: ["https://cdn.example/a.jpg", "https://cdn.example/b.jpg", "https://cdn.example/c.jpg"],
      }).imageUrls
    ).toHaveLength(3);
  });

  it("rejects more than 3 image URLs", () => {
    expect(() =>
      updateProductSchema.parse({
        imageUrls: ["a", "b", "c", "d"],
      })
    ).toThrow();
  });

  it("edits a product without opening stock", () => {
    const parsed = editProductFormSchema.parse({
      name: "Premium T-Shirt",
      sku: "TSHIRT-001",
      price: 999,
      weightGrams: 250,
      prepaidEnabled: true,
      codEnabled: false,
      active: true,
    });
    expect(parsed).not.toHaveProperty("openingStock");
    expect(parsed.active).toBe(true);
  });

  it("rejects an edit that turns off both payment modes", () => {
    expect(() =>
      editProductFormSchema.parse({
        name: "X",
        sku: "X-1",
        price: 1,
        weightGrams: 1,
        prepaidEnabled: false,
        codEnabled: false,
      })
    ).toThrow();
  });
});
