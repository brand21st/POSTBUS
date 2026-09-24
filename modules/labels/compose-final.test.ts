import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { composeFinalLabelPdf } from "@/modules/labels/compose-final";
import { SAMPLE_PACKING_DATA } from "@/modules/labels/packing-data";
import { defaultLabelTemplate } from "@/modules/labels/template-schema";

async function officialStub() {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([297.64, 419.53]);
  page.drawText("INDIA POST OFFICIAL", { x: 24, y: 360, size: 12 });
  return pdf.save();
}

describe("composeFinalLabelPdf", () => {
  it("uses a larger A5 page so merchant fields sit under the official barcode", async () => {
    const official = await officialStub();
    const combined = await composeFinalLabelPdf(official, defaultLabelTemplate("A5"), SAMPLE_PACKING_DATA);
    const pdf = await PDFDocument.load(combined);
    const page = pdf.getPages()[0];
    expect(pdf.getPageCount()).toBe(1);
    expect(Math.round(page.getSize().height)).toBeGreaterThan(419);
    expect(Buffer.from(combined).subarray(0, 4).toString()).toBe("%PDF");
  });
});
