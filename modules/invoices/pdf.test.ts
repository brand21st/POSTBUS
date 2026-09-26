import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { SAMPLE_INVOICE_DATA } from "@/modules/invoices/data";
import { renderInvoicePdf } from "@/modules/invoices/pdf";

describe("invoice PDF", () => {
  it("renders an A4 PDF with a dynamic product table", async () => {
    const bytes = await renderInvoicePdf({
      ...SAMPLE_INVOICE_DATA,
      items: [
        ...SAMPLE_INVOICE_DATA.items,
        {
          title: "An unusually long product name that must wrap without overlapping the price column",
          sku: "WRAP-1",
          quantity: 3,
          unitPrice: 120,
          lineTotal: 360,
        },
      ],
    });
    const pdf = await PDFDocument.load(bytes);
    const page = pdf.getPages()[0];
    const size = page.getSize();
    expect(Math.round(size.width)).toBe(595);
    expect(Math.round(size.height)).toBe(842);
    expect(Buffer.from(bytes).subarray(0, 4).toString()).toBe("%PDF");
  });

  it("prints the short shipment number and separates subtotal from total", async () => {
    const bytes = await renderInvoicePdf({
      ...SAMPLE_INVOICE_DATA,
      shipmentId: "58379dbb-6009-4948-bfb9-0310258c1a5b",
      shipmentNumber: "SHP-000013",
      items: [{ title: "Demo", sku: null, quantity: 1, unitPrice: 10, lineTotal: 10 }],
      subtotal: 10,
      total: 10,
    });
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(bytes) }).promise;
    const page = await pdf.getPage(1);
    const content = await page.getTextContent();
    const items = content.items.flatMap((item) => {
      if (!item || typeof item !== "object" || !("str" in item) || !("transform" in item)) return [];
      return [item as { str: string; transform: number[] }];
    });

    expect(items.some((item) => item.str === "SHP-000013")).toBe(true);
    expect(items.some((item) => item.str.includes("58379dbb"))).toBe(false);

    const subtotal = items.find((item) => item.str === "Subtotal");
    const summaryTotal = items
      .filter((item) => item.str === "TOTAL")
      .find((item) => subtotal && item.transform[5] < subtotal.transform[5]);
    expect(subtotal).toBeTruthy();
    expect(summaryTotal).toBeTruthy();
    expect(subtotal!.transform[5] - summaryTotal!.transform[5]).toBeGreaterThanOrEqual(23);
  });
});
