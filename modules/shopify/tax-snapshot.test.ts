import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { extractShopifyTaxSnapshot } from "@/modules/shopify/tax-snapshot";

describe("shopify tax snapshot", () => {
  it("stores tax lines without changing the order total fields", () => {
    const order = {
      total_price: "369.00",
      total_tax: "17.57",
      taxes_included: true,
      tax_lines: [{ title: "CGST", price: "8.78", rate: 0.025 }, { title: "SGST", price: "8.79", rate: 0.025 }],
      line_items: [{ title: "Towel", sku: "T", quantity: 1, price: "369.00", variant_title: "Large", tax_lines: [{ title: "CGST", price: "8.78", rate: 0.025 }] }],
    };
    const snapshot = extractShopifyTaxSnapshot(order);
    expect(snapshot?.taxesIncluded).toBe(true);
    expect(snapshot?.taxLines[0].amountPaise).toBe(878);
    expect(order.total_price).toBe("369.00");
    expect(order.total_tax).toBe("17.57");
  });

  it("keeps tax lines on the single-order query", () => {
    const one = readFileSync("modules/shopify/graphql/order-tax.ts", "utf8");
    expect(one).toContain("taxLines");
    expect(one).toContain("lineItems(first: 50)");
  });
});
