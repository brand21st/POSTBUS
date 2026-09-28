import { PDFDocument, rgb } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { ptFromMm } from "@/modules/labels/layout/units";
import { calculateMultiUpLayout } from "@/modules/labels/multi-up/layout";
import { composeMultiUpPdf, embedDrawBox } from "@/modules/labels/multi-up/pdf";

async function labelPdf(width: number, height: number) {
  const document = await PDFDocument.create();
  const page = document.addPage([width, height]);
  page.drawRectangle({ x: 0, y: 0, width, height, color: rgb(1, 1, 1) });
  return document.save();
}

describe("multi-up PDF", () => {
  it("keeps a 90° label inside its slot after the embed rotation", () => {
    const sheetHeight = ptFromMm(297);
    const box = embedDrawBox(sheetHeight, {
      index: 0,
      orderId: "1",
      page: 0,
      xPt: 10,
      yPt: 20,
      widthPt: 100,
      heightPt: 40,
      rotation: 90,
    });
    expect(box.x - box.height).toBeCloseTo(10, 5);
    expect(box.y).toBeCloseTo(sheetHeight - 20 - 40, 5);
    expect(box.height).toBe(100);
    expect(box.width).toBe(40);
  });

  it("embeds two finished labels onto one A4 page and continues on the next sheet", async () => {
    const layout = calculateMultiUpLayout({
      sheetWidthMm: 210,
      sheetHeightMm: 297,
      labelWidthMm: 105,
      labelHeightMm: 148,
      margins: { topMm: 0, rightMm: 0, bottomMm: 0, leftMm: 0 },
      gaps: { horizontalMm: 0, verticalMm: 0 },
      rotation: 0,
      items: [
        { orderId: "1001", copies: 2 },
        { orderId: "1002", copies: 3 },
      ],
    });
    expect(layout.ok).toBe(true);
    if (!layout.ok) return;
    const first = await labelPdf(ptFromMm(105), ptFromMm(148));
    const second = await labelPdf(ptFromMm(105), ptFromMm(148));
    const bytes = await composeMultiUpPdf(
      layout,
      layout.placements.map((placement) => (placement.orderId === "1001" ? first : second))
    );
    const sheet = await PDFDocument.load(bytes);
    expect(sheet.getPageCount()).toBe(2);
    expect(sheet.getPage(0).getWidth()).toBeCloseTo(ptFromMm(210), 3);
    expect(sheet.getPage(0).getHeight()).toBeCloseTo(ptFromMm(297), 3);
    expect(sheet.getPage(1).getWidth()).toBeCloseTo(sheet.getPage(0).getWidth(), 3);
  });
});
