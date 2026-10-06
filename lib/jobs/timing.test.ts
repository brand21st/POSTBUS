import { describe, expect, it } from "vitest";
import { queueWaitMs } from "@/lib/jobs/timing";

describe("queueWaitMs", () => {
  it("returns elapsed milliseconds from created_at", () => {
    expect(queueWaitMs("2026-10-06T06:00:00.000Z", Date.parse("2026-10-06T06:00:04.000Z"))).toBe(4000);
  });

  it("returns undefined when created_at is missing", () => {
    expect(queueWaitMs(null)).toBeUndefined();
  });
});
