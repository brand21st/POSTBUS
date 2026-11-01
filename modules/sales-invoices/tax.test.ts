import { describe, expect, it } from "vitest";
import { billingAfterSameAddressToggle, calculateSalesInvoice, emptyParty, financialYearLabel, formatSalesInvoiceNumber, invoiceNumberRpcAllowed, paiseInWords, placeOfSupply, splitTaxComponents } from "@/modules/sales-invoices/tax";

const line = (overrides: Partial<Parameters<typeof calculateSalesInvoice>[0]["lines"][number]> = {}) => ({
  name: "Towel",
  quantity: 1,
  unitPricePaise: 100000,
  discountPaise: 0,
  rateBps: 1800,
  treatment: "TAXABLE" as const,
  ...overrides,
});

describe("sales invoice tax", () => {
  it("splits inclusive 18 percent without changing the grand total", () => {
    const result = calculateSalesInvoice({
      scheme: "REGULAR",
      taxSource: "CALCULATED",
      pricing: "INCLUSIVE",
      supplierStateCode: "32",
      posStateCode: "32",
      lines: [line({ unitPricePaise: 118000 })],
      orderDiscountPaise: 0,
      shippingAmountPaise: 0,
      shippingTaxable: false,
      shippingRateBps: null,
      importedTaxesIncluded: null,
      importedHeaderTaxPaise: null,
      importedGrandTotalPaise: null,
    });
    expect(result.status).toBe("OK");
    expect(result.grandTotalPaise).toBe(118000);
    expect(result.taxablePaise).toBe(100000);
    expect(result.cgstPaise).toBe(9000);
    expect(result.sgstPaise).toBe(9000);
    expect(result.igstPaise).toBe(0);
  });

  it("adds exclusive GST on top of the price", () => {
    const result = calculateSalesInvoice({
      scheme: "REGULAR",
      taxSource: "CALCULATED",
      pricing: "EXCLUSIVE",
      supplierStateCode: "32",
      posStateCode: "29",
      lines: [line({ unitPricePaise: 100000, quantity: 2, rateBps: 1800 })],
      orderDiscountPaise: 0,
      shippingAmountPaise: 0,
      shippingTaxable: false,
      shippingRateBps: null,
      importedTaxesIncluded: null,
      importedHeaderTaxPaise: null,
      importedGrandTotalPaise: null,
    });
    expect(result.igstPaise).toBe(36000);
    expect(result.grandTotalPaise).toBe(236000);
    expect(result.intraState).toBe(false);
  });

  it("uses UTGST for Chandigarh and does not guess IGST when the state is missing", () => {
    expect(splitTaxComponents(100, "04", "04").utgstPaise).toBe(50);
    expect(splitTaxComponents(100, "32", "04").igstPaise).toBe(100);
    expect(splitTaxComponents(100, "07", "07").sgstPaise).toBe(50);
    const result = calculateSalesInvoice({
      scheme: "REGULAR",
      taxSource: "MANUAL",
      pricing: "EXCLUSIVE",
      supplierStateCode: "32",
      posStateCode: null,
      lines: [line()],
      orderDiscountPaise: 0,
      shippingAmountPaise: 0,
      shippingTaxable: false,
      shippingRateBps: null,
      importedTaxesIncluded: null,
      importedHeaderTaxPaise: null,
      importedGrandTotalPaise: null,
    });
    expect(result.status).toBe("REVIEW");
    expect(result.igstPaise).toBe(0);
    expect(result.reasons).toContain("missing_place_of_supply");
  });

  it("blocks GST for unregistered and composition sellers", () => {
    for (const scheme of ["UNREGISTERED", "COMPOSITION"] as const) {
      const result = calculateSalesInvoice({
        scheme,
        taxSource: "MANUAL",
        pricing: "EXCLUSIVE",
        supplierStateCode: null,
        posStateCode: null,
        lines: [line()],
        orderDiscountPaise: 0,
        shippingAmountPaise: 0,
        shippingTaxable: false,
        shippingRateBps: null,
        importedTaxesIncluded: null,
        importedHeaderTaxPaise: null,
        importedGrandTotalPaise: null,
      });
      expect(result.status).toBe("BLOCKED");
    }
  });

  it("allocates an order discount and taxes shipping at an explicit rate", () => {
    const result = calculateSalesInvoice({
      scheme: "REGULAR",
      taxSource: "CALCULATED",
      pricing: "EXCLUSIVE",
      supplierStateCode: "32",
      posStateCode: "32",
      lines: [line({ unitPricePaise: 100000, rateBps: 500 }), line({ name: "Soap", unitPricePaise: 100000, rateBps: 1800 })],
      orderDiscountPaise: 20000,
      shippingAmountPaise: 5000,
      shippingTaxable: true,
      shippingRateBps: 1800,
      importedTaxesIncluded: null,
      importedHeaderTaxPaise: null,
      importedGrandTotalPaise: null,
    });
    expect(result.status).toBe("OK");
    expect(result.discountPaise).toBe(20000);
    expect(result.lines[0].taxablePaise + result.lines[1].taxablePaise).toBe(180000);
    expect(result.grandTotalPaise).toBe(result.taxablePaise + result.cgstPaise + result.sgstPaise);
  });

  it("keeps an explicit billing address when same-as-shipping is turned off", () => {
    const shipping = { ...emptyParty(), name: "Ship", line1: "Lake Road", state: "Kerala", stateCode: "32" };
    const explicit = { ...emptyParty(), name: "Bill", line1: "Market Road", state: "Karnataka", stateCode: "29", gstin: "29ABCDE1234F1Z5" };
    const copied = billingAfterSameAddressToggle({ same: true, shipping, billing: explicit, explicitBilling: explicit });
    expect(copied.line1).toBe("Lake Road");
    expect(copied.gstin).toBe(explicit.gstin);
    const restored = billingAfterSameAddressToggle({ same: false, shipping, billing: copied, explicitBilling: explicit });
    expect(restored.line1).toBe("Market Road");
  });

  it("uses the ship-to state as place of supply", () => {
    expect(placeOfSupply({ shipState: "Karnataka", billState: "Kerala" }).basis).toBe("SHIP_TO");
    expect(placeOfSupply({ shipState: "Karnataka", billState: "Kerala" }).code).toBe("29");
    expect(placeOfSupply({ shipState: "Not a state", billState: "Kerala" }).basis).toBe("BILL_TO");
  });

  it("formats a financial-year number inside 16 characters and gates the RPC", () => {
    expect(formatSalesInvoiceNumber("INV", financialYearLabel(new Date("2026-10-26T00:00:00+05:30")), 1)).toBe("INV/26-27/00001");
    expect(formatSalesInvoiceNumber("INV", "26-27", 1).length).toBeLessThanOrEqual(16);
    expect(() => formatSalesInvoiceNumber("TOOLONG", "26-27", 1)).toThrow();
    expect(invoiceNumberRpcAllowed("service_role", false)).toBe(true);
    expect(invoiceNumberRpcAllowed("authenticated", true)).toBe(true);
    expect(invoiceNumberRpcAllowed("authenticated", false)).toBe(false);
    expect(paiseInWords(118000)).toContain("One Thousand One Hundred Eighty Rupees");
  });

  it("does not recompute a complete imported Shopify total", () => {
    const result = calculateSalesInvoice({
      scheme: "REGULAR",
      taxSource: "IMPORTED",
      pricing: "INCLUSIVE",
      supplierStateCode: "32",
      posStateCode: "32",
      lines: [line({
        unitPricePaise: 36900,
        rateBps: 500,
        imported: { taxablePaise: 35143, cgstPaise: 878, sgstPaise: 879, utgstPaise: 0, igstPaise: 0, cessPaise: 0, lineTotalPaise: 36900 },
      })],
      orderDiscountPaise: 0,
      shippingAmountPaise: 0,
      shippingTaxable: false,
      shippingRateBps: null,
      importedTaxesIncluded: true,
      importedHeaderTaxPaise: 1757,
      importedGrandTotalPaise: 36900,
    });
    expect(result.grandTotalPaise).toBe(36900);
    expect(result.cgstPaise).toBe(878);
  });
});
