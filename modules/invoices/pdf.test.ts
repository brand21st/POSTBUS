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
});
