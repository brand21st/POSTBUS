import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/api/errors";
import { parseMultiUpRequest } from "@/modules/labels/multi-up/request";

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

  it("rejects label sizes as a sheet", () => {
    expect(() =>
      parseMultiUpRequest({
        items: [{ orderId: "246072", copies: 1 }],
        sheet: { ...sheet, paperSize: "A6" },
      })
    ).toThrow(AppError);
    expect(() =>
      parseMultiUpRequest({
        items: [{ orderId: "246072", copies: 1 }],
        sheet: { ...sheet, paperSize: "4x6" },
      })
    ).toThrow(/A4, A3, A5, or custom/);
  });
});
