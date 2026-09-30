import { describe, expect, it } from "vitest";
import { runPool } from "@/lib/async/pool";

describe("runPool", () => {
  it("caps concurrency and still visits every item", async () => {
    let current = 0;
    let peak = 0;
    const seen: number[] = [];
    await runPool([1, 2, 3, 4, 5], 2, async (item) => {
      current += 1;
      peak = Math.max(peak, current);
      await Promise.resolve();
      seen.push(item);
      current -= 1;
    });
    expect(peak).toBeLessThanOrEqual(2);
    expect(seen.sort()).toEqual([1, 2, 3, 4, 5]);
  });
});
