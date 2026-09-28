import { describe, expect, it } from "vitest";
import { ptFromMm } from "@/modules/labels/layout/units";
import { calculateMultiUpLayout, type MultiUpInput, type MultiUpLayout, type MultiUpPlacement } from "@/modules/labels/multi-up/layout";

const zeroMargins = { topMm: 0, rightMm: 0, bottomMm: 0, leftMm: 0 };
const zeroGaps = { horizontalMm: 0, verticalMm: 0 };

function layout(patch: Partial<MultiUpInput> & Pick<MultiUpInput, "sheetWidthMm" | "sheetHeightMm" | "labelWidthMm" | "labelHeightMm">) {
  return calculateMultiUpLayout({
    margins: zeroMargins,
    gaps: zeroGaps,
    rotation: 0,
    items: [{ orderId: "1", copies: 1 }],
    ...patch,
  });
}

function assertInside(result: MultiUpLayout, margins = zeroMargins) {
  const left = ptFromMm(margins.leftMm);
  const top = ptFromMm(margins.topMm);
  const right = result.sheetWidthPt - ptFromMm(margins.rightMm);
  const bottom = result.sheetHeightPt - ptFromMm(margins.bottomMm);
  for (const placement of result.placements) {
    expect(placement.xPt).toBeGreaterThanOrEqual(left - 0.05);
    expect(placement.yPt).toBeGreaterThanOrEqual(top - 0.05);
    expect(placement.xPt + placement.widthPt).toBeLessThanOrEqual(right + 0.05);
    expect(placement.yPt + placement.heightPt).toBeLessThanOrEqual(bottom + 0.05);
  }
}

function overlaps(a: MultiUpPlacement, b: MultiUpPlacement) {
  return a.page === b.page && a.xPt < b.xPt + b.widthPt - 0.05 && a.xPt + a.widthPt > b.xPt + 0.05 && a.yPt < b.yPt + b.heightPt - 0.05 && a.yPt + a.heightPt > b.yPt + 0.05;
}

describe("multi-up placement", () => {
  it("places two 4×6 labels on A4 without scaling", () => {
    const result = layout({ sheetWidthMm: 210, sheetHeightMm: 297, labelWidthMm: 102, labelHeightMm: 152, items: [{ orderId: "a", copies: 2 }] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.columns).toBe(2);
    expect(result.rows).toBe(1);
    expect(result.rotation).toBe(0);
    expect(result.placements[0]?.widthPt).toBeCloseTo(ptFromMm(102), 5);
    expect(result.placements[0]?.heightPt).toBeCloseTo(ptFromMm(152), 5);
    expect(result.placements[1]?.xPt).toBeCloseTo(ptFromMm(102), 5);
    assertInside(result);
  });

  it("fits four A6 labels on A4", () => {
    const result = layout({ sheetWidthMm: 210, sheetHeightMm: 297, labelWidthMm: 105, labelHeightMm: 148, items: [{ orderId: "a", copies: 4 }] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.columns).toBe(2);
    expect(result.rows).toBe(2);
    expect(result.perSheet).toBe(4);
  });

  it("rotates an A5 label on A4 when that fits more copies", () => {
    const result = layout({
      sheetWidthMm: 210,
      sheetHeightMm: 297,
      labelWidthMm: 148,
      labelHeightMm: 210,
      rotation: "auto",
      items: [{ orderId: "a", copies: 2 }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rotation).toBe(90);
    expect(result.columns).toBe(1);
    expect(result.rows).toBe(2);
    expect(result.placements[0]?.widthPt).toBeCloseTo(ptFromMm(210), 5);
    expect(result.placements[0]?.heightPt).toBeCloseTo(ptFromMm(148), 5);
  });

  it("rotates an A6 label on A5 when that fits a second row", () => {
    const result = layout({
      sheetWidthMm: 148,
      sheetHeightMm: 210,
      labelWidthMm: 105,
      labelHeightMm: 148,
      rotation: "auto",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rotation).toBe(90);
    expect(result.perSheet).toBe(2);
  });

  it("keeps margins and gaps on a custom sheet", () => {
    const margins = { topMm: 10, rightMm: 8, bottomMm: 12, leftMm: 6 };
    const result = layout({
      sheetWidthMm: 300,
      sheetHeightMm: 400,
      labelWidthMm: 100,
      labelHeightMm: 100,
      margins,
      gaps: { horizontalMm: 5, verticalMm: 7 },
      items: [{ orderId: "a", copies: 4 }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.placements[0]?.xPt).toBeCloseTo(ptFromMm(6), 5);
    expect(result.placements[0]?.yPt).toBeCloseTo(ptFromMm(10), 5);
    expect(result.placements[1]?.xPt - (result.placements[0]!.xPt + result.placements[0]!.widthPt)).toBeCloseTo(ptFromMm(5), 5);
    expect(result.placements[2]?.yPt - (result.placements[0]!.yPt + result.placements[0]!.heightPt)).toBeCloseTo(ptFromMm(7), 5);
    assertInside(result, margins);
    for (let index = 0; index < result.placements.length; index += 1) {
      for (let other = index + 1; other < result.placements.length; other += 1) {
        expect(overlaps(result.placements[index]!, result.placements[other]!)).toBe(false);
      }
    }
  });

  it("expands copies in order and continues on the next sheet", () => {
    const result = layout({
      sheetWidthMm: 210,
      sheetHeightMm: 297,
      labelWidthMm: 105,
      labelHeightMm: 148,
      items: [
        { orderId: "1001", copies: 2 },
        { orderId: "1002", copies: 1 },
        { orderId: "1003", copies: 2 },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.placements.map((item) => item.orderId)).toEqual(["1001", "1001", "1002", "1003", "1003"]);
    expect(result.placements.map((item) => item.page)).toEqual([0, 0, 0, 0, 1]);
    expect(result.placements[0]?.xPt).toBeLessThan(result.placements[1]!.xPt);
    expect(result.placements[2]?.yPt).toBeGreaterThan(result.placements[0]!.yPt);
  });

  it("rejects a label that does not fit", () => {
    const result = layout({ sheetWidthMm: 100, sheetHeightMm: 100, labelWidthMm: 148, labelHeightMm: 210 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toMatch(/does not fit/);
  });

  it("rejects a fixed grid that would clip", () => {
    const result = layout({
      sheetWidthMm: 210,
      sheetHeightMm: 297,
      labelWidthMm: 102,
      labelHeightMm: 152,
      columns: 3,
      rows: 2,
    });
    expect(result.ok).toBe(false);
  });
});
