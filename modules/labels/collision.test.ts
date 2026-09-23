import { describe, expect, it } from "vitest";
import { overlapsAny, snapRect } from "@/modules/labels/collision";

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
});
