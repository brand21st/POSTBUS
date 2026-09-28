import { describe, expect, it } from "vitest";
import { SAFE_MARGIN_PT, entersPrinterMargin, overlapsAny, snapRect, snapToSafeMargin } from "@/modules/labels/collision";

describe("label collision", () => {
  it("detects overlapping rects", () => {
    expect(
      overlapsAny({ x: 10, y: 10, width: 40, height: 20 }, [{ x: 30, y: 15, width: 40, height: 20 }])
    ).toBe(true);
  });

  it("snaps an overlapping rect to a free position", () => {
    const others = [{ x: 20, y: 20, width: 80, height: 40 }];
    const result = snapRect({ x: 24, y: 22, width: 40, height: 20 }, others, 300, 400);
    expect(result.snapped).toBe(true);
    expect(overlapsAny(result.rect, others)).toBe(false);
  });

  it("snaps the nearer edge onto the print-safe margin", () => {
    const margin = SAFE_MARGIN_PT;
    const near = snapToSafeMargin({ x: margin + 2, y: 40, width: 40, height: 20 }, 300, 400);
    expect(near.x).toBeCloseTo(margin, 5);
    expect(near.y).toBe(40);

    const far = snapToSafeMargin({ x: margin + 20, y: 40, width: 40, height: 20 }, 300, 400);
    expect(far.x).toBeCloseTo(margin + 20, 5);

    const both = snapToSafeMargin({ x: margin + 2, y: 40, width: 300 - margin * 2 - 1, height: 20 }, 300, 400);
    expect(both.x + both.width).toBeCloseTo(300 - margin, 5);
    expect(both.x).not.toBeCloseTo(margin, 5);
  });

  it("reports blocks that cross the printer margin", () => {
    expect(entersPrinterMargin({ x: 0, y: 40, width: 20, height: 20 }, 300, 400)).toBe(true);
    expect(entersPrinterMargin({ x: SAFE_MARGIN_PT, y: SAFE_MARGIN_PT, width: 40, height: 20 }, 300, 400)).toBe(false);
  });
});
