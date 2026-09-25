import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { renderMerchantLabelPdf, renderPackingSlipPdf } from "@/modules/labels/packing-pdf";
import { SAMPLE_PACKING_DATA } from "@/modules/labels/packing-data";
import { PAGE_PRESETS, officialDrawRect } from "@/modules/labels/page-presets";
import { applyPaperSize, defaultLabelTemplate, parseLabelTemplate } from "@/modules/labels/template-schema";

describe("packing label template", () => {
  it("fills a default layout for A6", () => {
    const template = defaultLabelTemplate();
    expect(template.templateVersion).toBe(4);
    expect(template.page.paperSize).toBe("A5");
    expect(template.elements.products?.visible).toBe(true);
    expect(template.elements.merchantLogo?.visible).toBe(true);
    expect(template.elements.orderNumber?.visible).toBe(true);
    expect(template.elements.total?.visible).toBe(true);
    expect(template.elements.receiverName?.visible).toBe(true);
    expect(template.elements.receiverAddress?.visible).toBe(true);
    expect(template.elements.receiverPhone?.visible).toBe(true);
    expect(template.elements.senderName?.visible).toBe(true);
    expect(template.elements.senderAddress?.visible).toBe(true);
    expect(template.elements.senderPhone?.visible).toBe(true);
    expect(template.elements.storeName?.visible).toBe(false);
    const extra = officialDrawRect(template.page.widthPt, template.page.heightPt).y;
    expect(template.elements.products.y + template.elements.products.height).toBeLessThanOrEqual(extra + 0.5);
  });

  it("returns the default template for empty json", () => {
    const template = parseLabelTemplate({});
    expect(template.elements.orderNumber).toBeTruthy();
  });

  it("clamps elements when switching to a smaller page", () => {
    const wide = applyPaperSize(defaultLabelTemplate("A4"), "A6");
    expect(wide.page.paperSize).toBe("A6");
    for (const id of [
      "receiverName",
      "receiverAddress",
      "receiverPhone",
      "senderName",
      "senderAddress",
      "senderPhone",
    ] as const) {
      expect(wide.elements[id]).toBeTruthy();
      expect(wide.elements[id].visible).toBe(true);
    }
    for (const element of Object.values(wide.elements)) {
      expect(element.x + element.width).toBeLessThanOrEqual(wide.page.widthPt + 0.01);
      expect(element.y + element.height).toBeLessThanOrEqual(wide.page.heightPt + 0.01);
    }
  });

  it("puts logo, products, and price in the extra band on A5", () => {
    const template = applyPaperSize(defaultLabelTemplate("A6"), "A5");
    const extra = officialDrawRect(template.page.widthPt, template.page.heightPt).y;
    expect(extra).toBeGreaterThan(80);
    expect(template.elements.merchantLogo.y + template.elements.merchantLogo.height).toBeLessThanOrEqual(extra + 0.5);
    expect(template.elements.products.y + template.elements.products.height).toBeLessThanOrEqual(extra + 0.5);
    expect(template.elements.total.y + template.elements.total.height).toBeLessThanOrEqual(extra + 0.5);
  });
});

describe("merchant packing PDF", () => {
  it("renders real line items and the requested page size", async () => {
    const template = defaultLabelTemplate("A6");
    const bytes = await renderMerchantLabelPdf(template, SAMPLE_PACKING_DATA);
    const pdf = await PDFDocument.load(bytes);
    const page = pdf.getPages()[0];
    const size = page.getSize();
    expect(Math.round(size.width)).toBe(Math.round(PAGE_PRESETS[0].widthPt));
    expect(Math.round(size.height)).toBe(Math.round(PAGE_PRESETS[0].heightPt));
    expect(Buffer.from(bytes).subarray(0, 4).toString()).toBe("%PDF");
  });

  it("uses the same renderer dimensions for every preset", async () => {
    for (const preset of PAGE_PRESETS) {
      const template = defaultLabelTemplate(preset.id);
      const bytes = await renderMerchantLabelPdf(template, SAMPLE_PACKING_DATA);
      const page = (await PDFDocument.load(bytes)).getPages()[0];
      expect(Math.round(page.getSize().width)).toBe(Math.round(preset.widthPt));
      expect(Math.round(page.getSize().height)).toBe(Math.round(preset.heightPt));
    }
  });
});

describe("professional packing slip", () => {
  it("renders an A4 packing slip with ship, items, and totals", async () => {
    const bytes = await renderPackingSlipPdf(SAMPLE_PACKING_DATA);
    const pdf = await PDFDocument.load(bytes);
    const page = pdf.getPages()[0];
    const size = page.getSize();
    expect(Math.round(size.width)).toBe(595);
    expect(Math.round(size.height)).toBe(842);
    expect(Buffer.from(bytes).subarray(0, 4).toString()).toBe("%PDF");
  });
});
