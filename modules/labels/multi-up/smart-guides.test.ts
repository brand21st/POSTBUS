import { describe, expect, it } from "vitest";
import { clampGroupDelta } from "@/modules/labels/multi-up/align";
import {
  applySmartSnap,
  emptySnapLocks,
  formatMmFromPt,
  groupBounds,
  neighborGaps,
  paperGaps,
  SNAP_PX,
  snapThresholdPt,
  shiftBox,
} from "@/modules/labels/multi-up/smart-guides";
import { mmFromPt, ptFromMm } from "@/modules/labels/layout/units";
import { MULTI_PRINT_PAPERS } from "@/modules/labels/page-presets";

const label = { xPt: ptFromMm(20), yPt: ptFromMm(10), widthPt: ptFromMm(40), heightPt: ptFromMm(30) };

function snapNear(origin: typeof label, dx: number, dy: number, sheetW: number, sheetH: number, others: typeof label[] = [], locked = emptySnapLocks(), thresholdPt = 8) {
  return applySmartSnap({
    originBbox: origin,
    others,
    sheetWidthPt: sheetW,
    sheetHeightPt: sheetH,
    intendedDx: dx,
    intendedDy: dy,
    thresholdPt,
    locked,
  });
}

describe("groupBounds", () => {
  it("uses the union box so group drag shares one origin", () => {
    const bounds = groupBounds([
      { xPt: 10, yPt: 20, widthPt: 40, heightPt: 30 },
      { xPt: 80, yPt: 40, widthPt: 20, heightPt: 10 },
    ]);
    expect(bounds).toEqual({ xPt: 10, yPt: 20, widthPt: 90, heightPt: 30 });
  });
});

describe("paperGaps", () => {
  it.each(MULTI_PRINT_PAPERS)("matches canonical mm on $id", (paper) => {
    const box = {
      xPt: ptFromMm(12.5),
      yPt: ptFromMm(8),
      widthPt: ptFromMm(40),
      heightPt: ptFromMm(30),
    };
    const gaps = paperGaps(box, paper.widthPt, paper.heightPt);
    expect(mmFromPt(gaps.leftPt)).toBeCloseTo(12.5, 5);
    expect(mmFromPt(gaps.topPt)).toBeCloseTo(8, 5);
    expect(mmFromPt(gaps.rightPt)).toBeCloseTo(paper.widthMm - 52.5, 5);
    expect(mmFromPt(gaps.bottomPt)).toBeCloseTo(paper.heightMm - 38, 5);
  });

  it("uses custom sheet size without a named preset", () => {
    const widthPt = ptFromMm(300);
    const heightPt = ptFromMm(400);
    const gaps = paperGaps(label, widthPt, heightPt);
    expect(mmFromPt(gaps.rightPt)).toBeCloseTo(300 - 60, 5);
    expect(mmFromPt(gaps.bottomPt)).toBeCloseTo(400 - 40, 5);
  });
});

describe("neighborGaps", () => {
  it("measures edge-to-edge, not center-to-center", () => {
    const a = { xPt: 0, yPt: 0, widthPt: 40, heightPt: 30 };
    const b = { xPt: 50, yPt: 0, widthPt: 40, heightPt: 30 };
    const gaps = neighborGaps(a, [b]);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]?.axis).toBe("x");
    expect(gaps[0]?.gapPt).toBe(10);
    const centers = (50 + 20) - 20;
    expect(gaps[0]?.gapPt).not.toBe(centers);
  });

  it("measures a stacked vertical edge gap", () => {
    const a = { xPt: 0, yPt: 0, widthPt: 40, heightPt: 20 };
    const b = { xPt: 0, yPt: 26.5, widthPt: 40, heightPt: 20 };
    expect(neighborGaps(a, [b])[0]?.gapPt).toBeCloseTo(6.5, 5);
  });
});

describe("applySmartSnap", () => {
  const a4 = MULTI_PRINT_PAPERS.find((item) => item.id === "A4")!;

  it("snaps to the paper left edge at 0 pt and reports 0.0 mm", () => {
    const origin = { xPt: 20, yPt: 40, widthPt: 50, heightPt: 40 };
    const result = snapNear(origin, -16, 0, a4.widthPt, a4.heightPt);
    expect(result.dx).toBeCloseTo(-20, 5);
    expect(shiftBox(origin, result.dx, result.dy).xPt).toBe(0);
    expect(formatMmFromPt(result.overlay.paperGaps.leftPt)).toBe("0.0 mm");
  });

  it("snaps to paper center X and Y from the actual sheet size", () => {
    const origin = { xPt: 10, yPt: 10, widthPt: 40, heightPt: 20 };
    const targetX = a4.widthPt / 2 - 20;
    const targetY = a4.heightPt / 2 - 10;
    const result = snapNear(origin, targetX - origin.xPt + 3, targetY - origin.yPt + 3, a4.widthPt, a4.heightPt);
    expect(shiftBox(origin, result.dx, result.dy).xPt + 20).toBeCloseTo(a4.widthPt / 2, 5);
    expect(shiftBox(origin, result.dx, result.dy).yPt + 10).toBeCloseTo(a4.heightPt / 2, 5);
  });

  it("snaps to another label left edge", () => {
    const origin = { xPt: 52, yPt: 80, widthPt: 30, heightPt: 20 };
    const other = { xPt: 50, yPt: 10, widthPt: 40, heightPt: 20 };
    const result = snapNear(origin, 0, 0, 400, 400, [other]);
    expect(shiftBox(origin, result.dx, result.dy).xPt).toBe(50);
  });

  it("snaps to another label center", () => {
    const origin = { xPt: 10, yPt: 80, widthPt: 30, heightPt: 20 };
    const other = { xPt: 50, yPt: 10, widthPt: 40, heightPt: 20 };
    const otherMid = 70;
    const originMid = 25;
    const result = snapNear(origin, otherMid - originMid, 0, 400, 400, [other]);
    expect(shiftBox(origin, result.dx, result.dy).xPt + 15).toBeCloseTo(70, 5);
  });

  it("prefers edge alignment over center when both are in range", () => {
    const origin = { xPt: 50.4, yPt: 80, widthPt: 40, heightPt: 20 };
    const other = { xPt: 50, yPt: 10, widthPt: 40, heightPt: 20 };
    const result = snapNear(origin, 0, 0, 400, 400, [other]);
    expect(shiftBox(origin, result.dx, result.dy).xPt).toBe(50);
    expect(result.overlay.guides.some((guide) => guide.kind === "edge" && guide.at === 50)).toBe(true);
  });

  it("keeps a group snap as one delta so relative spacing is unchanged", () => {
    const a = { xPt: 12, yPt: 20, widthPt: 40, heightPt: 20 };
    const b = { xPt: 80, yPt: 20, widthPt: 40, heightPt: 20 };
    const originBbox = groupBounds([a, b])!;
    const result = applySmartSnap({
      originBbox,
      others: [],
      sheetWidthPt: 400,
      sheetHeightPt: 400,
      intendedDx: -10,
      intendedDy: 0,
      thresholdPt: 8,
      locked: emptySnapLocks(),
    });
    const nextA = shiftBox(a, result.dx, result.dy);
    const nextB = shiftBox(b, result.dx, result.dy);
    expect(nextA.xPt).toBe(0);
    expect(nextB.xPt - nextA.xPt).toBe(b.xPt - a.xPt);
    const clamped = clampGroupDelta([a, b], result.dx, result.dy, 400, 400);
    expect(clamped.dx).toBe(result.dx);
  });

  it("stays locked inside the hysteresis band then releases", () => {
    const origin = { xPt: 20, yPt: 40, widthPt: 50, heightPt: 40 };
    const first = snapNear(origin, -16, 0, 400, 400, [], emptySnapLocks(), 8);
    expect(shiftBox(origin, first.dx, first.dy).xPt).toBe(0);

    const held = snapNear(origin, -20 + 10, 0, 400, 400, [], first.locked, 8);
    expect(shiftBox(origin, held.dx, held.dy).xPt).toBe(0);

    const released = snapNear(origin, -20 + 13, 0, 400, 400, [], first.locked, 8);
    expect(shiftBox(origin, released.dx, released.dy).xPt).toBeCloseTo(13, 5);
    expect(released.locked.x).toBeNull();
  });

  it("scales the snap threshold with canvasScale", () => {
    expect(snapThresholdPt(1)).toBe(SNAP_PX);
    expect(snapThresholdPt(2)).toBe(SNAP_PX / 2);
    const origin = { xPt: SNAP_PX, yPt: 40, widthPt: 50, heightPt: 40 };
    const loose = snapNear(origin, 0, 0, 400, 400, [], emptySnapLocks(), snapThresholdPt(1));
    expect(shiftBox(origin, loose.dx, loose.dy).xPt).toBe(0);
    const tight = snapNear(origin, 0, 0, 400, 400, [], emptySnapLocks(), snapThresholdPt(2));
    expect(shiftBox(origin, tight.dx, tight.dy).xPt).toBe(SNAP_PX);
  });
});
