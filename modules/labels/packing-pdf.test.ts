import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { renderMerchantLabelPdf } from "@/modules/labels/packing-pdf";
import { SAMPLE_PACKING_DATA } from "@/modules/labels/packing-data";
import { PAGE_PRESETS } from "@/modules/labels/page-presets";
import { applyPaperSize, defaultLabelTemplate, parseLabelTemplate } from "@/modules/labels/template-schema";

describe("packing label template", () => {
  it("fills a default layout for A6", () => {
    const template = defaultLabelTemplate();
    expect(template.templateVersion).toBe(1);
    expect(template.page.paperSize).toBe("A6");
    expect(template.elements.products?.visible).toBe(true);
    expect(template.elements.merchantLogo?.visible).toBe(true);
  });

  it("returns the default template for empty json", () => {
    const template = parseLabelTemplate({});
    expect(template.elements.orderNumber).toBeTruthy();
  });

  it("clamps elements when switching to a smaller page", () => {
    const wide = applyPaperSize(defaultLabelTemplate("A4"), "A6");
    expect(wide.page.paperSize).toBe("A6");
    for (const element of Object.values(wide.elements)) {
      expect(element.x + element.width).toBeLessThanOrEqual(wide.page.widthPt + 0.01);
      expect(element.y + element.height).toBeLessThanOrEqual(wide.page.heightPt + 0.01);
    }
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
