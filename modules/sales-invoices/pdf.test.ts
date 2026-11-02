import { mkdtemp, rm, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PDFDocument, PDFRawStream, decodePDFRawStream } from "pdf-lib";
import { afterEach, describe, expect, it } from "vitest";
import { readInvoicePdfIfPresent, saveInvoicePdf } from "@/modules/invoices/storage";
import { renderSalesInvoicePdf } from "@/modules/sales-invoices/pdf";
import type { SalesInvoiceRecord, SalesInvoiceSettings } from "@/modules/sales-invoices/service";
import { emptyParty } from "@/modules/sales-invoices/tax";

const settings: SalesInvoiceSettings = {
  template: "GST",
  prefix: "INV",
  financialYearStartMonth: 4,
  terms: "Goods once sold can be exchanged within 7 days.",
  thankYou: "Thank you",
  signaturePath: "",
  showSku: true,
  showVariant: true,
  showHsn: true,
  showLineDiscount: true,
  showPaymentMethod: true,
  showOrderNumber: true,
  showShippingAddress: true,
  showSignature: true,
  autoIssue: false,
  autoIssueEvent: null,
};

function invoice(lines: SalesInvoiceRecord["lines"]): SalesInvoiceRecord {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    orderId: "33333333-3333-4333-8333-333333333333",
    orderNumber: "#1001",
    customerName: "Priya",
    documentKind: "SALES",
    source: "MANUAL",
    documentType: "TAX_INVOICE",
    taxSource: "CALCULATED",
    pricing: "INCLUSIVE",
    status: "ISSUED",
    paymentStatus: "PAID",
    paymentMethod: "UPI",
    invoiceNumber: "INV/26-27/00001",
    financialYear: "26-27",
    invoiceDate: "2026-10-26",
    currency: "INR",
    seller: {
      scheme: "REGULAR",
      gstin: "32ABCDE1234F1Z5",
      legalName: "Sample Store",
      tradeName: "Sample Store",
      pan: "",
      line1: "12 Market Road",
      line2: "",
      city: "Kochi",
      state: "Kerala",
      stateCode: "32",
      pincode: "682011",
      phone: "9999999999",
      email: "hello@example.com",
      website: "example.com",
    },
    billing: { ...emptyParty(), name: "Priya Nair", line1: "14 Lake View", city: "Ernakulam", state: "Kerala", stateCode: "32", pincode: "682016" },
    shipping: { ...emptyParty(), name: "Priya Nair", line1: "14 Lake View with a very long address that must wrap on the page", city: "Ernakulam", state: "Kerala", stateCode: "32", pincode: "682016", phone: "9876501234" },
    posBasis: "SHIP_TO",
    posStateCode: "32",
    posStateName: "Kerala",
    subtotalPaise: 36900,
    discountPaise: 0,
    shippingPaise: 0,
    shippingTaxable: false,
    shippingRateBps: null,
    taxablePaise: 35143,
    cgstPaise: 878,
    sgstPaise: 879,
    utgstPaise: 0,
    igstPaise: 0,
    cessPaise: 0,
    roundOffPaise: 0,
    grandTotalPaise: 36900,
    amountPaidPaise: 36900,
    codCollectPaise: 0,
    reviewReasons: [],
    pdfPath: null,
    lines,
    createdAt: "2026-10-26",
  };
}

const oneLine: SalesInvoiceRecord["lines"][number] = {
  id: "line",
  name: "മൈക്രോ കോട്ടൺ ബാത്ത് ടവൽ",
  variant: "Large — White",
  sku: "TOWEL-SET-02",
  hsn: "6302",
  quantity: 1,
  unit: "NOS",
  unitPricePaise: 36900,
  discountPaise: 0,
  rateBps: 500,
  treatment: "TAXABLE",
  taxablePaise: 35143,
  cgstPaise: 878,
  sgstPaise: 879,
  utgstPaise: 0,
  igstPaise: 0,
  cessPaise: 0,
  lineTotalPaise: 36900,
};

async function pdfStrings(bytes: Uint8Array) {
  const pdf = await PDFDocument.load(bytes);
  const parts: string[] = [];
  for (const [, object] of pdf.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFRawStream)) continue;
    try {
      parts.push(Buffer.from(decodePDFRawStream(object).decode()).toString("latin1"));
    } catch {
      // Image streams are not invoice text.
    }
  }
  return parts.join("\n").replace(/<([0-9A-Fa-f\s]+)>/g, (_, hex: string) => {
    const compact = hex.replace(/\s/g, "");
    if (compact.length < 2 || compact.length % 2 !== 0) return _;
    return Buffer.from(compact, "hex").toString("latin1");
  });
}

describe("sales invoice PDF", () => {
  let root = "";
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
    root = "";
  });

  it("renders a one-page GST invoice from the snapshot", async () => {
    const bytes = await renderSalesInvoicePdf({ invoice: invoice([oneLine]), settings, logo: null, logoMime: null });
    const pdf = await PDFDocument.load(bytes);
    const text = await pdfStrings(bytes);
    expect(pdf.getPageCount()).toBe(1);
    expect(text).toContain("TAX INVOICE");
    expect(text).toContain("Place of supply");
    expect(text).toContain("Authorized signatory");
    expect(text).toContain("Rs 369.00");
    expect(text).not.toContain("Rs 386.57");
  });

  it("lists inclusive tax under the classic total and says free delivery", async () => {
    const bytes = await renderSalesInvoicePdf({
      invoice: invoice([oneLine]),
      settings: { ...settings, template: "CLASSIC" },
      logo: null,
      logoMime: null,
    });
    const text = await pdfStrings(bytes);
    expect(text).toContain("Free Delivery");
    expect(text).toContain("Includes");
    expect(text).toContain("CGST Rs 8.78");
    expect(text.indexOf("TOTAL")).toBeLessThan(text.indexOf("Includes"));
  });

  it("rebuilds the PDF from the snapshot after the stored file is deleted", async () => {
    const snapshot = invoice([oneLine]);
    const bytes = await renderSalesInvoicePdf({ invoice: snapshot, settings, logo: null, logoMime: null });
    root = await mkdtemp(path.join(os.tmpdir(), "postbus-sales-pdf-"));
    const relative = await saveInvoicePdf({
      organizationId: "11111111-1111-4111-8111-111111111111",
      invoiceId: snapshot.id,
      bytes,
      root,
      relativePath: `sales/11111111-1111-4111-8111-111111111111/${snapshot.id}.pdf`,
    });
    await unlink(path.join(root, relative));
    const missing = await readInvoicePdfIfPresent({
      relativePath: relative,
      organizationId: "11111111-1111-4111-8111-111111111111",
      root,
    });
    expect(missing).toBeNull();
    const rebuilt = await renderSalesInvoicePdf({ invoice: snapshot, settings, logo: null, logoMime: null });
    expect(Buffer.from(rebuilt).subarray(0, 4).toString()).toBe("%PDF");
    expect(Buffer.from(rebuilt).equals(Buffer.from(bytes))).toBe(true);
  });

  it("paginates many long product names and can be rendered again from the same snapshot", async () => {
    const lines = Array.from({ length: 40 }, (_, index) => ({
      ...oneLine,
      id: `line-${index}`,
      name: `Micro Cotton Bath Towel Combo Set of 2 with an unusually long description ${index}`,
    }));
    const snapshot = invoice(lines);
    snapshot.grandTotalPaise = 36900 * 40;
    const first = await renderSalesInvoicePdf({ invoice: snapshot, settings: { ...settings, template: "CLASSIC" }, logo: null, logoMime: null });
    const second = await renderSalesInvoicePdf({ invoice: snapshot, settings: { ...settings, template: "CLASSIC" }, logo: null, logoMime: null });
    const pdf = await PDFDocument.load(first);
    expect(pdf.getPageCount()).toBeGreaterThan(1);
    expect(Buffer.from(first).equals(Buffer.from(second))).toBe(true);
  });
});
