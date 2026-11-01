import { describe, expect, it } from "vitest";
import {
  documentTypeLabel,
  paymentBadge,
  rowGstPaise,
  salesInvoiceFilename,
  salesInvoiceHasPdf,
  salesStatusBadge,
  shippingStatusBadge,
} from "@/lib/invoices/labels";

describe("invoice labels", () => {
  it("uses plain labels and tones for sales invoice status", () => {
    expect(salesStatusBadge("DRAFT")).toEqual({ label: "Draft", tone: "default" });
    expect(salesStatusBadge("REVIEW")).toEqual({ label: "Needs review", tone: "warning" });
    expect(salesStatusBadge("ISSUED")).toEqual({ label: "Issued", tone: "success" });
    expect(salesStatusBadge("CANCELLED")).toEqual({ label: "Cancelled", tone: "error" });
    expect(salesStatusBadge("SOMETHING")).toEqual({ label: "SOMETHING", tone: "default" });
  });

  it("labels payment and GST document types", () => {
    expect(paymentBadge("PARTIAL")).toEqual({ label: "Partly paid", tone: "warning" });
    expect(paymentBadge("paid")).toEqual({ label: "Paid", tone: "success" });
    expect(documentTypeLabel("BILL_OF_SUPPLY")).toBe("Bill of supply");
    expect(documentTypeLabel(null)).toBe("—");
  });

  it("shows a pending shipping document as generating, not as an error", () => {
    expect(shippingStatusBadge("PENDING")).toEqual({ label: "Generating", tone: "warning" });
    expect(shippingStatusBadge("GENERATED")).toEqual({ label: "Ready", tone: "success" });
    expect(shippingStatusBadge("FAILED")).toEqual({ label: "Failed", tone: "error" });
  });

  it("only offers a PDF once the invoice is issued", () => {
    expect(salesInvoiceHasPdf("DRAFT")).toBe(false);
    expect(salesInvoiceHasPdf("REVIEW")).toBe(false);
    expect(salesInvoiceHasPdf("ISSUED")).toBe(true);
    expect(salesInvoiceHasPdf("CANCELLED")).toBe(true);
  });

  it("includes cess in row GST", () => {
    expect(rowGstPaise({ cgstPaise: 900, sgstPaise: 900, utgstPaise: 0, igstPaise: 0, cessPaise: 120 })).toBe(1920);
    expect(rowGstPaise({})).toBe(0);
  });

  it("makes GST invoice numbers safe as filenames", () => {
    expect(salesInvoiceFilename("PB/2026-27/0007", "abc")).toBe("PB-2026-27-0007.pdf");
    expect(salesInvoiceFilename(null, "12345678-aaaa")).toBe("invoice-12345678.pdf");
  });
});
