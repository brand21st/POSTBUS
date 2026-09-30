import { describe, expect, it } from "vitest";
import { shouldMountDashboardChildren, overlayDashboardUntilMeReady } from "@/lib/dashboard/shell-gate";

describe("dashboard shell gating", () => {
  it("does not treat /me loading as a reason to unmount dashboard pages after hydration", () => {
    expect(
      shouldMountDashboardChildren({ isUnauthorized: false, hydrated: true, hasMe: false })
    ).toBe(true);
    expect(overlayDashboardUntilMeReady(true)).toBe(true);
  });

  it("does not mount protected dashboard pages after a 401", () => {
    expect(
      shouldMountDashboardChildren({ isUnauthorized: true, hydrated: true, hasMe: false })
    ).toBe(false);
  });

  it("does not SSR page trees before hydration", () => {
    expect(
      shouldMountDashboardChildren({ isUnauthorized: false, hydrated: false, hasMe: false })
    ).toBe(false);
  });
});
