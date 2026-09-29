import { describe, expect, it } from "vitest";
import { LABEL_4X6, generate4x6Presets, gridSpacing } from "@/modules/labels/multi-up/presets";
import { applyPlacementOverrides, calculateMultiUpLayout } from "@/modules/labels/multi-up/layout";
import { ptFromMm } from "@/modules/labels/layout/units";
import { MULTI_PRINT_PAPERS, pagePreset, sheetPreset } from "@/modules/labels/page-presets";

function assertInside(
  result: Extract<ReturnType<typeof calculateMultiUpLayout>, { ok: true }>,
  widthMm = LABEL_4X6.widthMm,
  heightMm = LABEL_4X6.heightMm
) {
  for (const placement of result.placements) {
    expect(placement.widthPt).toBeCloseTo(ptFromMm(widthMm), 5);
    expect(placement.heightPt).toBeCloseTo(ptFromMm(heightMm), 5);
    expect(placement.xPt).toBeGreaterThanOrEqual(-0.05);
    expect(placement.yPt).toBeGreaterThanOrEqual(-0.05);
    expect(placement.xPt + placement.widthPt).toBeLessThanOrEqual(result.sheetWidthPt + 0.05);
    expect(placement.yPt + placement.heightPt).toBeLessThanOrEqual(result.sheetHeightPt + 0.05);
  }
}

function overlaps(
  a: { page: number; xPt: number; yPt: number; widthPt: number; heightPt: number },
  b: { page: number; xPt: number; yPt: number; widthPt: number; heightPt: number }
) {
  return (
    a.page === b.page &&
    a.xPt < b.xPt + b.widthPt - 0.05 &&
    a.xPt + a.widthPt > b.xPt + 0.05 &&
    a.yPt < b.yPt + b.heightPt - 0.05 &&
    a.yPt + a.heightPt > b.yPt + 0.05
  );
}

describe("4×6 multi-print presets", () => {
  it("keeps the 4×6 label size from the page registry", () => {
    expect(LABEL_4X6.widthMm).toBe(pagePreset("4x6").widthMm);
    expect(LABEL_4X6.heightMm).toBe(pagePreset("4x6").heightMm);
  });

  it("lists only quantities that physically fit on each named paper", () => {
    const a4 = generate4x6Presets(sheetPreset("A4").widthMm, sheetPreset("A4").heightMm, "A4");
    expect(a4.map((item) => item.quantity)).toEqual([1, 2, 4]);
    expect(a4.some((item) => item.quantity === 6)).toBe(false);
    expect(a4.find((item) => item.quantity === 2)).toMatchObject({ columns: 2, rows: 1, name: "A4 · 2 × 4×6" });
    const a4Four = a4.find((item) => item.quantity === 4);
    expect(a4Four).toMatchObject({
      columns: 2,
      rows: 2,
      name: "A4 · 4 Labels",
      labelWidthMm: pagePreset("A6").widthMm,
      labelHeightMm: pagePreset("A6").heightMm,
    });

    const a3 = generate4x6Presets(sheetPreset("A3").widthMm, sheetPreset("A3").heightMm, "A3");
    expect(a3.map((item) => item.quantity)).toEqual([1, 2, 4]);
    expect(a3.find((item) => item.quantity === 4)).toMatchObject({ columns: 2, rows: 2, name: "A3 · 4 × 4×6" });

    const a5 = generate4x6Presets(sheetPreset("A5").widthMm, sheetPreset("A5").heightMm, "A5");
    expect(a5.map((item) => item.quantity)).toEqual([1]);

    const a6 = pagePreset("A6");
    expect(generate4x6Presets(a6.widthMm, a6.heightMm, "A6")).toEqual([]);

    const fourBySix = pagePreset("4x6");
    expect(generate4x6Presets(fourBySix.widthMm, fourBySix.heightMm, "4x6").map((item) => item.quantity)).toEqual([1]);
  });

  it("covers every multi-print paper option from the shared registry", () => {
    for (const paper of MULTI_PRINT_PAPERS) {
      const presets = generate4x6Presets(paper.widthMm, paper.heightMm, paper.id);
      for (const preset of presets) {
        const result = calculateMultiUpLayout({
          sheetWidthMm: paper.widthMm,
          sheetHeightMm: paper.heightMm,
          labelWidthMm: preset.labelWidthMm,
          labelHeightMm: preset.labelHeightMm,
          margins: preset.margins,
          gaps: preset.gaps,
          rotation: 0,
          scale: 1,
          columns: preset.columns,
          rows: preset.rows,
          items: [{ orderId: "a", copies: preset.quantity }],
        });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.rotation).toBe(0);
        expect(result.perSheet).toBe(preset.quantity);
        assertInside(result, preset.labelWidthMm, preset.labelHeightMm);
        for (let index = 0; index < result.placements.length; index += 1) {
          for (let other = index + 1; other < result.placements.length; other += 1) {
            expect(overlaps(result.placements[index]!, result.placements[other]!)).toBe(false);
          }
        }
      }
    }
  });

  it("exposes valid custom quantities and none when the sheet is too small", () => {
    const custom = generate4x6Presets(400, 400, "custom");
    expect(custom.length).toBeGreaterThan(0);
    expect(custom.every((item) => item.name.startsWith("Custom · "))).toBe(true);
    expect(generate4x6Presets(50, 50, "custom")).toEqual([]);
  });

  it("does not snap back after a manual override", () => {
    const a4 = sheetPreset("A4");
    const preset = generate4x6Presets(a4.widthMm, a4.heightMm, "A4").find((item) => item.quantity === 2);
    expect(preset).toBeTruthy();
    const result = calculateMultiUpLayout({
      sheetWidthMm: a4.widthMm,
      sheetHeightMm: a4.heightMm,
      labelWidthMm: LABEL_4X6.widthMm,
      labelHeightMm: LABEL_4X6.heightMm,
      margins: preset!.margins,
      gaps: preset!.gaps,
      rotation: 0,
      scale: 1,
      columns: preset!.columns,
      rows: preset!.rows,
      items: [{ orderId: "a", copies: 2 }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const moved = applyPlacementOverrides(result, [
      { index: 0, xPt: 12, yPt: 18, widthPt: result.placements[0]!.widthPt, heightPt: result.placements[0]!.heightPt },
    ]);
    expect(moved.placements[0]?.xPt).toBeCloseTo(12, 5);
    expect(moved.placements[0]?.yPt).toBeCloseTo(18, 5);
    expect(moved.placements[0]?.widthPt).toBeCloseTo(ptFromMm(LABEL_4X6.widthMm), 5);
  });

  it("centers leftover space the same way as a 2×2 A4 grid", () => {
    const spacing = gridSpacing({
      sheetWidthMm: 210,
      sheetHeightMm: 297,
      columns: 2,
      rows: 2,
      labelWidthMm: 105,
      labelHeightMm: 148,
    });
    expect(spacing.gaps.horizontalMm).toBe(0);
    expect(spacing.gaps.verticalMm).toBe(1);
    expect(spacing.margins.leftMm).toBe(spacing.margins.rightMm);
    expect(spacing.margins.topMm).toBe(spacing.margins.bottomMm);
  });
});
