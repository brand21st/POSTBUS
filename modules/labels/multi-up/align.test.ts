import { describe, expect, it } from "vitest";
import {
  alignBottom,
  alignCenterX,
  alignLeft,
  alignMiddleY,
  alignRight,
  alignTop,
  boxesIntersect,
  clampGroupDelta,
  marqueeRect,
} from "@/modules/labels/multi-up/align";

const a = { xPt: 10, yPt: 20, widthPt: 40, heightPt: 30 };
const b = { xPt: 80, yPt: 50, widthPt: 20, heightPt: 10 };

describe("boxesIntersect", () => {
  it("includes partial overlap and excludes disjoint boxes", () => {
    expect(boxesIntersect(a, { xPt: 40, yPt: 25, widthPt: 20, heightPt: 10 })).toBe(true);
    expect(boxesIntersect(a, { xPt: 51, yPt: 20, widthPt: 10, heightPt: 10 })).toBe(false);
  });
});

describe("marqueeRect", () => {
  it("normalizes inverted drag", () => {
    expect(marqueeRect(10, 8, 4, 2)).toEqual({ xPt: 4, yPt: 2, widthPt: 6, heightPt: 6 });
  });
});

describe("clampGroupDelta", () => {
  it("keeps every box on the sheet", () => {
    const delta = clampGroupDelta(
      [
        { xPt: 0, yPt: 10, widthPt: 40, heightPt: 20 },
        { xPt: 50, yPt: 80, widthPt: 40, heightPt: 20 },
      ],
      -20,
      50,
      100,
      100
    );
    expect(delta.dx).toBe(0);
    expect(delta.dy).toBe(0);
  });
});

describe("align", () => {
  it("aligns left, center, and right without changing size", () => {
    expect(alignLeft([a, b]).map((box) => box.xPt)).toEqual([10, 10]);
    const centered = alignCenterX([a, b]);
    expect(centered[0]!.xPt + centered[0]!.widthPt / 2).toBeCloseTo(centered[1]!.xPt + centered[1]!.widthPt / 2);
    expect(alignRight([a, b]).map((box) => box.xPt + box.widthPt)).toEqual([100, 100]);
    expect(alignLeft([a, b])[0]).toMatchObject({ widthPt: 40, heightPt: 30 });
  });

  it("aligns top, middle, and bottom without changing size", () => {
    expect(alignTop([a, b]).map((box) => box.yPt)).toEqual([20, 20]);
    const middle = alignMiddleY([a, b]);
    expect(middle[0]!.yPt + middle[0]!.heightPt / 2).toBeCloseTo(middle[1]!.yPt + middle[1]!.heightPt / 2);
    expect(alignBottom([a, b]).map((box) => box.yPt + box.heightPt)).toEqual([60, 60]);
  });
});
