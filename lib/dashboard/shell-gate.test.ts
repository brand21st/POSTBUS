import { describe, expect, it } from "vitest";
import {
  shouldMountDashboardChildren,
  overlayDashboardUntilMeReady,
  shouldRedirectToLoginFromMe,
  shouldRedirectToOnboardingFromMe,
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

  it("does not mount new protected pages during a transient auth failure without /me", () => {
    expect(
      shouldMountDashboardChildren({
        isUnauthorized: false,
        hydrated: true,
        hasMe: false,
        isTransient: true,
      })
    ).toBe(false);
  });

  it("keeps already-loaded dashboard pages during a transient auth failure", () => {
    expect(
      shouldMountDashboardChildren({
        isUnauthorized: false,
        hydrated: true,
        hasMe: true,
        isTransient: true,
      })
    ).toBe(true);
  });

  it("does not send the merchant to onboarding on a 5xx /me error", () => {
    expect(
      shouldRedirectToOnboardingFromMe({
        isLoading: false,
        hasError: true,
        isConfirmedSessionLoss: false,
        isTransient: true,
        hasOrganization: false,
        membershipCount: 0,
      })
    ).toBe(false);
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
