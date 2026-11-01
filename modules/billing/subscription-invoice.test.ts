import { describe, expect, it } from "vitest";
import { amountForCycle } from "@/modules/billing/prices";
import { assessSubscriptionInvoice, financialYearSeries, formatSubscriptionInvoiceNumber, invoiceDocumentTitle, parseInvoiceListQuery, taxInvoiceIssuanceEnabled } from "@/modules/billing/subscription-invoice";
import { renderSubscriptionInvoicePdf } from "@/modules/billing/subscription-invoice-pdf";

const ready = {
    grossPaise: BigInt(149900),
    taxablePaise: BigInt(127034),
    cgstPaise: BigInt(11433),
    sgstPaise: BigInt(11433),
    igstPaise: BigInt(0),
    totalTaxPaise: BigInt(22866),
    policyApproved: true,
    supplierLegalName: "Example Supplier",
    supplierAddress: "Example address",
    supplierGstin: "29ABCDE1234F1Z5",
    customerLegalName: "Example Merchant",
    customerAddress: "Merchant address",
    customerGstin: "",
};

describe("subscription tax invoices", () => {
    it("keeps checkout on the stored plan amount and leaves issuance off", () => {
        expect(amountForCycle({ monthly_price_paise: 350000, yearly_price_paise: 3360000 }, "monthly")).toBe(350000);
        expect(amountForCycle({ monthly_price_paise: 350000, yearly_price_paise: 3360000 }, "yearly")).toBe(3360000);
        expect(amountForCycle({ monthly_price_paise: 550000, yearly_price_paise: 5280000 }, "monthly")).toBe(550000);
        expect(taxInvoiceIssuanceEnabled()).toBe(false);
    });

    it("formats a proposed invoice number and financial year", () => {
        expect(financialYearSeries(new Date("2026-10-17T00:00:00.000Z"))).toBe("2026-27");
        expect(financialYearSeries(new Date("2026-03-31T00:00:00.000Z"))).toBe("2025-26");
        expect(formatSubscriptionInvoiceNumber("pb", "2026-27", 1)).toBe("PB/2026-27/000001");
    });

    it("blocks an unapproved policy and a missing supplier GSTIN", () => {
        expect(assessSubscriptionInvoice({ ...ready, policyApproved: false }).ready).toBe(false);
        const missing = assessSubscriptionInvoice({ ...ready, supplierGstin: "" });
        expect(missing.ready).toBe(false);
        expect(missing.blockers).toContain("Supplier GSTIN is missing");
    });

    it("allows a missing customer GSTIN when the other billing identity is present", () => {
        const result = assessSubscriptionInvoice(ready);
        expect(result.ready).toBe(true);
        expect(result.customerGstinProvided).toBe(false);
    });

    it("renders a preview PDF that is not titled as an issued tax invoice", async () => {
        const bytes = await renderSubscriptionInvoicePdf({
            issued: false,
            invoiceNumber: null,
            invoiceDate: null,
            periodLabel: "Not issued",
            planName: "Pro",
            billingCycle: "monthly",
            supplierLegalName: "",
            supplierAddress: "",
            supplierGstin: "",
            customerLegalName: "Example Merchant",
            customerAddress: "",
            customerGstin: "",
            placeOfSupply: null,
            serviceDescription: "PostBus subscription",
            grossPaise: BigInt(149900),
            taxablePaise: BigInt(0),
            cgstPaise: BigInt(0),
            sgstPaise: BigInt(0),
            igstPaise: BigInt(0),
            totalTaxPaise: BigInt(0),
            paymentStatus: "CAPTURED",
            paymentReference: "pay_test",
            blockers: ["Approved tax policy is missing"],
        });
        expect(Buffer.from(bytes).subarray(0, 5).toString()).toBe("%PDF-");
        expect(invoiceDocumentTitle(false)).toBe("INVOICE PREVIEW");
        expect(invoiceDocumentTitle(true)).toBe("TAX INVOICE");
    });

    it("validates invoice list filters and strips characters that could change a query", () => {
        const query = parseInvoiceListQuery(new URLSearchParams("q=PB/2026-27/000001,or(id)&page=2&pageSize=10&status=PREVIEW&from=2026-04-01"));
        expect(query.q).toBe("PB/2026-27/000001orid");
        expect(query.page).toBe(2);
        expect(query.status).toBe("PREVIEW");
        expect(() => parseInvoiceListQuery(new URLSearchParams("page=0"))).toThrow("Page is invalid");
    });
});
