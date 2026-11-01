import { describe, expect, it } from "vitest";
import { pdfPagePreviewScale } from "@/components/labels/pdf-page-preview-scale";
import { ptFromMm } from "@/modules/labels/layout/units";

describe("pdfPagePreviewScale", () => {
  it("keeps a 64 mm label at least scale 3 on a retina slot", () => {
    const pageWidthPt = ptFromMm(64);
    expect(pageWidthPt).toBeCloseTo(181.417, 2);
    const scale = pdfPagePreviewScale({
      pageWidthPt,
      cssWidthPx: 200,
      devicePixelRatio: 2,
    });
    expect(scale).toBeGreaterThanOrEqual(3);
    expect(scale).toBeLessThanOrEqual(5);
  });

  it("caps a huge CSS width at 5", () => {
    expect(
      pdfPagePreviewScale({
        pageWidthPt: ptFromMm(64),
        cssWidthPx: 4000,
        devicePixelRatio: 3,
      })
    ).toBe(5);
  });

  it("floors a tiny slot at 3", () => {
    expect(
      pdfPagePreviewScale({
        pageWidthPt: ptFromMm(64),
        cssWidthPx: 40,
        devicePixelRatio: 1,
      })
    ).toBe(3);
  });
});
