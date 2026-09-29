import { describe, expect, it } from "vitest";
import { nextGroupFromList, sheetGroups } from "@/modules/labels/multi-up/group";
import { calculateMultiUpLayout } from "@/modules/labels/multi-up/layout";
import { A4_FOUR_UP, a4FourUpSpacing } from "@/modules/labels/multi-up/presets";
import { ptFromMm } from "@/modules/labels/layout/units";

const chips = ["A", "B", "C", "D", "E", "F", "G", "H"];

describe("nextGroupFromList", () => {
  it("fills the clicked chip plus the next three unused chips", () => {
    expect(nextGroupFromList(chips, "A", [])).toEqual(["A", "B", "C", "D"]);
  });

  it("starts a second sheet of four from the clicked chip", () => {
    expect(nextGroupFromList(chips, "E", ["A", "B", "C", "D"])).toEqual(["E", "F", "G", "H"]);
  });

  it("adds only the clicked chip when the current sheet is already started", () => {
    expect(nextGroupFromList(chips, "C", ["A"])).toEqual(["C"]);
  });

  it("skips chips that are already selected", () => {
    expect(nextGroupFromList(["A", "B", "C", "D", "E", "F", "G", "H"], "E", ["A", "B", "C", "F"])).toEqual([
      "E",
      "G",
      "H",
    ]);
  });

  it("returns an empty list when the chip is already selected", () => {
    expect(nextGroupFromList(chips, "A", ["A"])).toEqual([]);
  });

  it("fills a group of two when the sheet quantity is two", () => {
    expect(nextGroupFromList(chips, "A", [], 2)).toEqual(["A", "B"]);
    expect(nextGroupFromList(chips, "C", ["A", "B"], 2)).toEqual(["C", "D"]);
  });

  it("fills a short group at the end of the list", () => {
    expect(nextGroupFromList(["A", "B", "C"], "A", [])).toEqual(["A", "B", "C"]);
    expect(nextGroupFromList(chips, "H", [])).toEqual(["H"]);
  });
});

describe("sheetGroups", () => {
  it("chunks by four and keeps a short last sheet", () => {
    expect(sheetGroups(["1", "2", "3", "4", "5"], 4)).toEqual([
      ["1", "2", "3", "4"],
      ["5"],
    ]);
  });
});

describe("A4 four-up spacing", () => {
  it("fits four A6 labels on A4 without scaling", () => {
    const spacing = a4FourUpSpacing(105, 148);
    const result = calculateMultiUpLayout({
      sheetWidthMm: A4_FOUR_UP.sheetWidthMm,
      sheetHeightMm: A4_FOUR_UP.sheetHeightMm,
      labelWidthMm: 105,
      labelHeightMm: 148,
      margins: spacing.margins,
      gaps: spacing.gaps,
      rotation: A4_FOUR_UP.rotation,
      scale: A4_FOUR_UP.scale,
      columns: A4_FOUR_UP.columns,
      rows: A4_FOUR_UP.rows,
      items: [{ orderId: "a", copies: 4 }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.columns).toBe(2);
    expect(result.rows).toBe(2);
    expect(result.perSheet).toBe(4);
    expect(result.rotation).toBe(0);
    expect(result.placements[0]?.widthPt).toBeCloseTo(ptFromMm(105), 5);
    expect(result.placements[0]?.heightPt).toBeCloseTo(ptFromMm(148), 5);
    const [topLeft, topRight, bottomLeft, bottomRight] = result.placements;
    expect(topLeft!.xPt).toBeLessThan(topRight!.xPt);
    expect(topLeft!.yPt).toBeLessThan(bottomLeft!.yPt);
    expect(topRight!.yPt).toBeLessThan(bottomRight!.yPt);
    expect(bottomLeft!.xPt).toBeLessThan(bottomRight!.xPt);
    const left = ptFromMm(spacing.margins.leftMm);
    const top = ptFromMm(spacing.margins.topMm);
    const right = result.sheetWidthPt - ptFromMm(spacing.margins.rightMm);
    const bottom = result.sheetHeightPt - ptFromMm(spacing.margins.bottomMm);
    for (const placement of result.placements) {
      expect(placement.xPt).toBeGreaterThanOrEqual(left - 0.05);
      expect(placement.yPt).toBeGreaterThanOrEqual(top - 0.05);
      expect(placement.xPt + placement.widthPt).toBeLessThanOrEqual(right + 0.05);
      expect(placement.yPt + placement.heightPt).toBeLessThanOrEqual(bottom + 0.05);
    }
  });

  it("pages 1 through 10 labels as 4-up sheets", () => {
    const spacing = a4FourUpSpacing(105, 148);
    const cases = [
      [1, 1],
      [2, 1],
      [3, 1],
      [4, 1],
      [5, 2],
      [8, 2],
      [9, 3],
      [10, 3],
    ] as const;
    for (const [copies, pageCount] of cases) {
      const result = calculateMultiUpLayout({
        sheetWidthMm: A4_FOUR_UP.sheetWidthMm,
        sheetHeightMm: A4_FOUR_UP.sheetHeightMm,
        labelWidthMm: 105,
        labelHeightMm: 148,
        margins: spacing.margins,
        gaps: spacing.gaps,
        rotation: 0,
        scale: 1,
        columns: 2,
        rows: 2,
        items: [{ orderId: "n", copies }],
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(Math.max(...result.placements.map((item) => item.page)) + 1).toBe(pageCount);
      expect(result.placements).toHaveLength(copies);
    }
  });

  it("rejects a 2×2 of 4×6 labels at 100% scale", () => {
    const spacing = a4FourUpSpacing(102, 152);
    const result = calculateMultiUpLayout({
      sheetWidthMm: A4_FOUR_UP.sheetWidthMm,
      sheetHeightMm: A4_FOUR_UP.sheetHeightMm,
      labelWidthMm: 102,
      labelHeightMm: 152,
      margins: spacing.margins,
      gaps: spacing.gaps,
      rotation: 0,
      scale: 1,
      columns: 2,
      rows: 2,
      items: [{ orderId: "a", copies: 4 }],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toMatch(/does not fit/);
  });
});
