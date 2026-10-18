import { describe, expect, it } from "vitest";
import { mapPool } from "@/modules/labels/multi-up/map-pool";

describe("mapPool", () => {
  it("keeps input order with a concurrency cap", async () => {
    const active = { count: 0, max: 0 };
    const result = await mapPool([1, 2, 3, 4, 5], 2, async (value) => {
      active.count += 1;
      active.max = Math.max(active.max, active.count);
      await Promise.resolve();
      active.count -= 1;
      return value * 10;
    });
    expect(result).toEqual([10, 20, 30, 40, 50]);
    expect(active.max).toBeLessThanOrEqual(2);
  });
});
