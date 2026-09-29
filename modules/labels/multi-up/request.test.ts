import { describe, expect, it } from "vitest";
import { parseMultiUpRequest } from "@/modules/labels/multi-up/request";
import { pagePreset, sheetPreset } from "@/modules/labels/page-presets";

const sheet = {
  margins: { topMm: 0, rightMm: 0, bottomMm: 0, leftMm: 0 },
  gaps: { horizontalMm: 0, verticalMm: 0 },
  rotation: 0,
  scale: 1,
};

describe("multi-up sheet request", () => {
  it("uses the A3 preset and ignores client dimensions", () => {
    const parsed = parseMultiUpRequest({
      items: [{ orderId: "246072", copies: 1 }],
      sheet: { ...sheet, paperSize: "A3", widthMm: 50, heightMm: 50 },
    });
    expect(parsed.sheet.paperSize).toBe("A3");
    expect(parsed.sheet.widthMm).toBe(297);
    expect(parsed.sheet.heightMm).toBe(420);
  });

  it("accepts A6 and 4×6 sheets from the paper registry", () => {
    const a6 = pagePreset("A6");
    const parsedA6 = parseMultiUpRequest({
      items: [{ orderId: "246072", copies: 1 }],
      sheet: { ...sheet, paperSize: "A6", widthMm: 10, heightMm: 10 },
    });
    expect(parsedA6.sheet.paperSize).toBe("A6");
    expect(parsedA6.sheet.widthMm).toBe(a6.widthMm);
    expect(parsedA6.sheet.heightMm).toBe(a6.heightMm);

    const fourBySix = pagePreset("4x6");
    const parsed = parseMultiUpRequest({
      items: [{ orderId: "246072", copies: 1 }],
      sheet: { ...sheet, paperSize: "4x6", widthMm: 10, heightMm: 10, labelWidthMm: fourBySix.widthMm, labelHeightMm: fourBySix.heightMm },
    });
    expect(parsed.sheet.paperSize).toBe("4x6");
    expect(parsed.sheet.widthMm).toBe(fourBySix.widthMm);
    expect(parsed.sheet.heightMm).toBe(fourBySix.heightMm);
    expect(parsed.sheet.labelWidthMm).toBe(fourBySix.widthMm);
    expect(parsed.sheet.labelHeightMm).toBe(fourBySix.heightMm);
  });

  it("rejects unsupported sheet names", () => {
    expect(() =>
      parseMultiUpRequest({
        items: [{ orderId: "246072", copies: 1 }],
        sheet: { ...sheet, paperSize: "Letter" },
      })
    ).toThrow(/supported paper size/);
  });

  it("uses the A4 registry size", () => {
    const a4 = sheetPreset("A4");
    const parsed = parseMultiUpRequest({
      items: [{ orderId: "246072", copies: 1 }],
      sheet: { ...sheet, paperSize: "A4", widthMm: 1, heightMm: 1 },
    });
    expect(parsed.sheet.widthMm).toBe(a4.widthMm);
    expect(parsed.sheet.heightMm).toBe(a4.heightMm);
    expect(parsed.sheet.labelWidthMm).toBeNull();
  });
});
