import { describe, expect, it } from "vitest";
import {
  shouldMountDashboardChildren,
  overlayDashboardUntilMeReady,
  shouldRedirectToLoginFromMe,
} from "@/lib/dashboard/shell-gate";

describe("dashboard shell gating", () => {
  it("does not treat /me loading as a reason to unmount dashboard pages after hydration", () => {
    expect(
      shouldMountDashboardChildren({ isUnauthorized: false, hydrated: true, hasMe: false })
    ).toBe(true);
    expect(overlayDashboardUntilMeReady(true)).toBe(true);
  });

  it("does not mount protected dashboard pages after a confirmed session loss", () => {
    expect(
      shouldMountDashboardChildren({ isUnauthorized: true, hydrated: true, hasMe: false })
    ).toBe(false);
  });

  it("keeps the dashboard mounted during a transient auth failure", () => {
    expect(
      shouldMountDashboardChildren({
        isUnauthorized: false,
        hydrated: true,
        hasMe: false,
        isTransient: true,
      })
    ).toBe(true);
  });

  it("does not SSR page trees before hydration", () => {
    expect(
      shouldMountDashboardChildren({ isUnauthorized: false, hydrated: false, hasMe: false })
    ).toBe(false);
  });

  it("does not redirect to login while /me is loading or transient", () => {
    expect(
      shouldRedirectToLoginFromMe({ isLoading: true, isConfirmedSessionLoss: true, isTransient: false })
    ).toBe(false);
    expect(
      shouldRedirectToLoginFromMe({
        isLoading: false,
        isConfirmedSessionLoss: false,
        isTransient: true,
      })
    ).toBe(false);
    expect(
      shouldRedirectToLoginFromMe({
        isLoading: false,
        isConfirmedSessionLoss: true,
        isTransient: false,
      })
    ).toBe(true);
  });
});
