import { describe, expect, it } from "vitest";
import { setupSteps } from "@/modules/ai-accountant/status";

const base = { gstReady: false, productsMissingRate: 3, hasDefaultRate: false, costsReady: false, lastSyncedAt: null, codToReview: 2 };

describe("setupSteps", () => {
  it("lists every step in order, all pending for a new workspace", () => {
    const steps = setupSteps(base);
    expect(steps.map((s) => s.key)).toEqual(["gst", "tax_rates", "costs", "sync", "cod"]);
    expect(steps.every((s) => !s.done)).toBe(true);
  });

  it("treats a default rate as covering products without their own rate", () => {
    expect(setupSteps({ ...base, hasDefaultRate: true }).find((s) => s.key === "tax_rates")?.done).toBe(true);
    expect(setupSteps({ ...base, productsMissingRate: 0 }).find((s) => s.key === "tax_rates")?.done).toBe(true);
  });

  it("is complete once everything is in place", () => {
    const steps = setupSteps({ gstReady: true, productsMissingRate: 0, hasDefaultRate: false, costsReady: true, lastSyncedAt: "2026-10-26T00:00:00Z", codToReview: 0 });
    expect(steps.every((s) => s.done)).toBe(true);
  });
});
