import { decodePDFRawStream, PDFDocument, PDFRawStream, StandardFonts } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { fitContain } from "@/modules/labels/layout/fit";
import { layoutLabel, WATERMARK_ID } from "@/modules/labels/layout/layout";
import { measureHelvetica } from "@/modules/labels/layout/measure";
import { wrapText } from "@/modules/labels/layout/text";
import { mmFromPt, ptFromMm, storedFromTopLeft, topLeftFromStored } from "@/modules/labels/layout/units";
import { validateLabel } from "@/modules/labels/layout/validate";
import { renderMerchantLabelPdf } from "@/modules/labels/packing-pdf";
import { SAMPLE_PACKING_DATA } from "@/modules/labels/packing-data";
import { labelRasterPlan } from "@/modules/print/raster-plan";
import { PAGE_PRESETS } from "@/modules/labels/page-presets";
import { indiaPostLabelTemplate, parseLabelTemplate, type LabelTemplate } from "@/modules/labels/template-schema";

const data = { ...SAMPLE_PACKING_DATA, articleId: "CL556974029IN", paymentMode: "PREPAID" as const };

function pageOf(widthMm: number, heightMm: number, paperSize: LabelTemplate["page"]["paperSize"]): LabelTemplate["page"] {
  return { paperSize, widthMm, heightMm, widthPt: ptFromMm(widthMm), heightPt: ptFromMm(heightMm) };
}

describe("label layout units", () => {
  it("locks preset millimetres and point conversion", () => {
    expect(ptFromMm(105)).toBeCloseTo((105 * 72) / 25.4, 8);
    for (const preset of PAGE_PRESETS) {
      expect(preset.widthPt).toBeCloseTo(ptFromMm(preset.widthMm), 8);
      expect(preset.heightPt).toBeCloseTo(ptFromMm(preset.heightMm), 8);
    }
    expect(PAGE_PRESETS.map((preset) => [preset.id, preset.widthMm, preset.heightMm])).toEqual([
      ["A6", 105, 148],
      ["4x6", 102, 152],
      ["A5", 148, 210],
      ["A4", 210, 297],
    ]);
  });

  it("round-trips bottom-left storage and top-left layout", () => {
    const stored = { x: 12, y: 40, width: 80, height: 24 };
    const top = topLeftFromStored(200, stored);
    expect(top).toEqual({ x: 12, y: 136, width: 80, height: 24 });
    expect(storedFromTopLeft(200, top)).toEqual(stored);
  });
});

describe("helvetica measure", () => {
  it("matches pdf-lib standard font widths", async () => {
    const document = await PDFDocument.create();
    const sample = "AV 100 W. Address, Kochi 682016";
    const faces = [
      [StandardFonts.Helvetica, "normal", false],
      [StandardFonts.HelveticaBold, "bold", false],
      [StandardFonts.HelveticaOblique, "normal", true],
    ] as const;
    for (const [fontName, weight, italic] of faces) {
      const font = await document.embedFont(fontName);
      expect(measureHelvetica(sample, 12, weight, italic)).toBeCloseTo(font.widthOfTextAtSize(sample, 12), 2);
    }
  });

  it("wraps a long address the same way twice", () => {
    const text = "42 MG Road Near City Mall Opposite the Old Railway Station Bengaluru Karnataka";
    const measure = (value: string) => measureHelvetica(value, 9, "normal");
    const first = wrapText(text, 80, measure);
    expect(first.length).toBeGreaterThan(1);
    expect(first.join(" ")).toContain("Railway");
    expect(wrapText(text, 80, measure)).toEqual(first);
  });
});

describe("layoutLabel", () => {
  it("uses one page size for A6, 4x6, A5, A4, and custom", () => {
    const template = indiaPostLabelTemplate();
    for (const preset of PAGE_PRESETS) {
      const layout = layoutLabel({ ...template, page: pageOf(preset.widthMm, preset.heightMm, preset.id) }, data);
      expect(layout.page.widthPt).toBeCloseTo(preset.widthPt, 6);
      expect(layout.page.heightPt).toBeCloseTo(preset.heightPt, 6);
    }
    const custom = layoutLabel({ ...template, page: pageOf(100, 140, "custom") }, data);
    expect(custom.page.widthPt).toBeCloseTo(ptFromMm(100), 6);
    expect(custom.page.heightPt).toBeCloseTo(ptFromMm(140), 6);
    expect(labelRasterPlan({ widthPt: custom.page.widthPt, heightPt: custom.page.heightPt, maxWidthMm: 120 }).widthMm).toBeCloseTo(
      mmFromPt(custom.page.widthPt),
      6
    );
  });

  it("keeps stored origins and does not take zoom as an input", () => {
    const template = indiaPostLabelTemplate();
    const layout = layoutLabel(template, data);
    for (const [id, element] of Object.entries(template.elements)) {
      if (!element.visible) continue;
      if (id === "codAmount") continue;
      const block = layout.blocks.find((item) => item.id === id);
      const expected = topLeftFromStored(template.page.heightPt, element);
      expect(block?.stored.x).toBeCloseTo(expected.x, 5);
      expect(block?.stored.y).toBeCloseTo(expected.y, 5);
      expect(block?.x).toBeCloseTo(expected.x, 5);
      expect(block?.y).toBeCloseTo(expected.y, 5);
      if (element.autoHeight === false) expect(block?.height).toBeCloseTo(expected.height, 5);
    }
    expect(layout.blocks.at(-1)?.id).toBe(WATERMARK_ID);
    expect(layout.blocks.some((block) => block.id === "orderNumber")).toBe(false);
  });

  it("places a visible legacy order number and hides it when the flag is off", () => {
    const template = indiaPostLabelTemplate();
    template.elements.orderNumber = { ...template.elements.orderNumber, visible: true };
    const shown = layoutLabel(template, data);
    expect(shown.blocks.some((block) => block.id === "orderNumber")).toBe(true);
    template.elements.orderNumber.visible = false;
    expect(layoutLabel(template, data).blocks.some((block) => block.id === "orderNumber")).toBe(false);
  });

  it("fits logos and barcode frames from the shared geometry", () => {
    const up = fitContain({ x: 0, y: 0, width: 100, height: 40 }, { width: 10, height: 10 }, { x: "left", y: "bottom" }, true);
    expect(up.width).toBeCloseTo(40, 5);
    expect(up.height).toBeCloseTo(40, 5);
    const down = fitContain({ x: 10, y: 4, width: 100, height: 40 }, { width: 400, height: 200 }, { x: "left", y: "bottom" }, true);
    expect(down.width).toBeCloseTo(80, 5);
    expect(down.x).toBeCloseTo(10, 5);
    expect(down.y).toBeCloseTo(4, 5);

    const template = indiaPostLabelTemplate();
    const width = ptFromMm(48.3);
    const height = ptFromMm(23.7);
    template.elements.indiaPostBarcode = {
      ...template.elements.indiaPostBarcode,
      width,
      height,
      gap: 0,
      fontSize: 10,
      showArticleText: true,
    };
    const block = layoutLabel(template, data, { barcode: { width: 400, height: 120 } }).blocks.find(
      (item) => item.id === "indiaPostBarcode"
    );
    expect(block?.image?.width).toBeLessThanOrEqual((block?.width ?? 0) + 0.05);
    const imageBottom = (block?.image?.y ?? 0) + (block?.image?.height ?? 0);
    const line = block?.lines[0];
    expect(line?.text).toContain("CL556974029IN");
    expect((line?.baseline ?? 0) - (line?.fontSize ?? 0) * 0.718).toBeGreaterThanOrEqual(imageBottom - 0.05);
    const center = (block?.x ?? 0) + (block?.width ?? 0) / 2;
    expect(Math.abs((line?.x ?? 0) + (line?.width ?? 0) / 2 - center)).toBeLessThanOrEqual(0.05);
  });

  it("shares product column geometry and warns without moving overlaps", () => {
    const template = indiaPostLabelTemplate();
    const layout = layoutLabel(template, { ...data, paymentMode: "COD" });
    const table = layout.blocks.find((block) => block.id === "products");
    expect(table?.cells?.length).toBeGreaterThan(0);
    const header = table?.cells?.filter((cell) => cell.header) ?? [];
    expect(header.map((cell) => cell.lines.map((line) => line.text).join(""))).toEqual([
      "Product name",
      "Qty",
      "Weight (g)",
      "Price",
    ]);
    template.elements.customerId = { ...template.elements.shipTo, visible: true };
    const overlap = validateLabel(layoutLabel(template, data));
    expect(overlap.some((warning) => warning.level === "info" && warning.ids.includes("customerId"))).toBe(true);
    expect(template.elements.shipTo.x).toBe(indiaPostLabelTemplate().elements.shipTo.x);
  });

  it("does not keep a rotation field", () => {
    const template = indiaPostLabelTemplate();
    const parsed = parseLabelTemplate({
      ...template,
      elements: { ...template.elements, shipTo: { ...template.elements.shipTo, rotation: 15 } },
    });
    expect(parsed.elements.shipTo).not.toHaveProperty("rotation");
  });
});

describe("pdf geometry", () => {
  it("draws text at the layout baseline", async () => {
    const template = indiaPostLabelTemplate();
    const layout = layoutLabel(template, SAMPLE_PACKING_DATA);
    const line = layout.blocks.find((block) => block.id === "orderIdDate")?.lines.find((item) => item.text.includes("Order ID"));
    expect(line).toBeTruthy();
    const bytes = await renderMerchantLabelPdf(template, SAMPLE_PACKING_DATA);
    const pdf = await PDFDocument.load(bytes);
    const parts: string[] = [];
    for (const [, object] of pdf.context.enumerateIndirectObjects()) {
      if (!(object instanceof PDFRawStream)) continue;
      parts.push(Buffer.from(decodePDFRawStream(object).decode()).toString("latin1"));
    }
    const text = parts
      .join("\n")
      .replace(/<([0-9A-Fa-f]+)>/g, (token, hex: string) =>
        hex.length % 2 === 0 ? Buffer.from(hex, "hex").toString("latin1") : token
      );
    const pdfY = template.page.heightPt - (line?.baseline ?? 0);
    expect(text).toContain("Order ID: 12345");
    const positions = [...text.matchAll(/1 0 0 1 ([0-9.]+) ([0-9.]+) Tm/g)].map((match) => ({
      x: Number(match[1]),
      y: Number(match[2]),
    }));
    expect(positions.some((position) => Math.abs(position.x - (line?.x ?? 0)) <= 0.05 && Math.abs(position.y - pdfY) <= 0.05)).toBe(
      true
    );
  });
});
