import { describe, expect, it } from "vitest";
import {
  DEFAULT_INVOICE_APPEARANCE,
  displayStoreWebsite,
  formatInvoiceNumber,
  invoiceContrastWarnings,
  parseInvoiceAppearance,
  parseInvoiceSettings,
  pickStoreWebsite,
  shouldSkipInvoiceGeneration,
} from "@/modules/invoices/schema";

describe("invoice numbering and idempotency", () => {
  it("formats a stable org-year sequence", () => {
    expect(formatInvoiceNumber(2026, 1)).toBe("INV-2026-000001");
    expect(formatInvoiceNumber(2026, 12)).toBe("INV-2026-000012");
  });

  it("skips generation when a generated file already exists", () => {
    expect(shouldSkipInvoiceGeneration("GENERATED", "org/inv.pdf")).toBe(true);
    expect(shouldSkipInvoiceGeneration("FAILED", "org/inv.pdf")).toBe(false);
    expect(shouldSkipInvoiceGeneration("PENDING", null)).toBe(false);
    expect(shouldSkipInvoiceGeneration("GENERATED", null)).toBe(false);
  });
});

describe("invoice appearance", () => {
  it("falls back to defaults for empty json", () => {
    expect(parseInvoiceAppearance({})).toEqual(DEFAULT_INVOICE_APPEARANCE);
  });

  it("prefers a custom store domain over myshopify", () => {
    expect(displayStoreWebsite("https://www.aurimo.in/")).toBe("www.aurimo.in");
    expect(pickStoreWebsite(["aurimo.myshopify.com", "www.aurimo.in"])).toBe("www.aurimo.in");
    expect(pickStoreWebsite(["aurimo.in", "www.aurimo.in"])).toBe("www.aurimo.in");
    expect(pickStoreWebsite([null, "https://www.aurimo.in", "shop.myshopify.com"])).toBe("www.aurimo.in");
    expect(pickStoreWebsite(["store.myshopify.com"])).toBe("store.myshopify.com");
    expect(parseInvoiceSettings({ website: "https://www.aurimo.in/" }).website).toBe("www.aurimo.in");
  });

  it("warns on light text on a white page", () => {
    const warnings = invoiceContrastWarnings({
      ...DEFAULT_INVOICE_APPEARANCE,
      textColor: "#F5F5F5",
    });
    expect(warnings.some((warning) => warning.field === "textColor")).toBe(true);
  });
});
