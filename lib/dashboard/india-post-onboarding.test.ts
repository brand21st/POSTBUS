import { describe, expect, it } from "vitest";
import {
  dismissIndiaPostOnboardingForUser,
  isIndiaPostConnected,
  shouldShowIndiaPostConnectBanner,
  shouldShowIndiaPostOnboardingModal,
} from "@/lib/dashboard/india-post-onboarding";

const ready = {
  hydrated: true,
  meLoading: false,
  indiaPostLoading: false,
  meError: false,
  indiaPostError: false,
  hasOrganization: true,
  status: "NOT_CONNECTED" as string | null,
  dismissedAt: null as string | null,
  localDismissed: false,
};

describe("India Post onboarding gates", () => {
  it("treats only CONNECTED as an active integration", () => {
    expect(isIndiaPostConnected("CONNECTED")).toBe(true);
    expect(isIndiaPostConnected("connected")).toBe(true);
    expect(isIndiaPostConnected("PENDING")).toBe(false);
    expect(isIndiaPostConnected("NOT_CONNECTED")).toBe(false);
    expect(isIndiaPostConnected(null)).toBe(false);
  });

  it("shows the first-time modal for a new unconnected merchant", () => {
    expect(shouldShowIndiaPostOnboardingModal(ready)).toBe(true);
  });

  it("does not flash the modal while session or integration status is loading", () => {
    expect(shouldShowIndiaPostOnboardingModal({ ...ready, hydrated: false })).toBe(false);
    expect(shouldShowIndiaPostOnboardingModal({ ...ready, meLoading: true })).toBe(false);
    expect(shouldShowIndiaPostOnboardingModal({ ...ready, indiaPostLoading: true })).toBe(false);
  });

  it("does not show the modal after dismiss, local skip, or successful connect", () => {
    expect(shouldShowIndiaPostOnboardingModal({ ...ready, dismissedAt: "2026-10-22T00:00:00.000Z" })).toBe(
      false
    );
    expect(shouldShowIndiaPostOnboardingModal({ ...ready, localDismissed: true })).toBe(false);
    expect(shouldShowIndiaPostOnboardingModal({ ...ready, status: "CONNECTED" })).toBe(false);
  });

  it("does not show the modal without an organization (including Super Admin dashboard skip)", () => {
    expect(shouldShowIndiaPostOnboardingModal({ ...ready, hasOrganization: false })).toBe(false);
  });

  it("shows the reminder banner for unconnected orgs, including existing dismissed users", () => {
    expect(
      shouldShowIndiaPostConnectBanner({
        hydrated: true,
        indiaPostLoading: false,
        indiaPostError: false,
        hasOrganization: true,
        status: "NOT_CONNECTED",
        pathname: "/dashboard",
      })
    ).toBe(true);
    expect(
      shouldShowIndiaPostConnectBanner({
        hydrated: true,
        indiaPostLoading: false,
        indiaPostError: false,
        hasOrganization: true,
        status: "PENDING",
        pathname: "/dashboard/orders",
      })
    ).toBe(true);
  });

  it("hides the banner when connected, still loading, or already on the integration page", () => {
    expect(
      shouldShowIndiaPostConnectBanner({
        hydrated: true,
        indiaPostLoading: false,
        indiaPostError: false,
        hasOrganization: true,
        status: "CONNECTED",
        pathname: "/dashboard",
      })
    ).toBe(false);
    expect(
      shouldShowIndiaPostConnectBanner({
        hydrated: true,
        indiaPostLoading: true,
        indiaPostError: false,
        hasOrganization: true,
        status: "NOT_CONNECTED",
        pathname: "/dashboard",
      })
    ).toBe(false);
    expect(
      shouldShowIndiaPostConnectBanner({
        hydrated: true,
        indiaPostLoading: false,
        indiaPostError: false,
        hasOrganization: true,
        status: "NOT_CONNECTED",
        pathname: "/dashboard/integrations/india-post",
      })
    ).toBe(false);
  });
});

describe("dismissIndiaPostOnboardingForUser", () => {
  it("updates only the profile dismiss timestamp and never India Post connections", async () => {
    const tables: string[] = [];
    const payloads: Record<string, unknown>[] = [];
    const supabase = {
      from(table: string) {
        tables.push(table);
        return {
          update(payload: Record<string, unknown>) {
            payloads.push(payload);
            return {
              eq() {
                return {
                  select() {
                    return {
                      async maybeSingle() {
                        return {
                          data: { india_post_onboarding_dismissed_at: "2026-10-22T06:00:00.000Z" },
                          error: null,
                        };
                      },
                    };
                  },
                };
              },
            };
          },
        };
      },
    };

    const result = await dismissIndiaPostOnboardingForUser(supabase as never, "user-1");
    expect(tables).toEqual(["profiles"]);
    expect(payloads).toHaveLength(1);
    expect(payloads[0]).toEqual({
      india_post_onboarding_dismissed_at: expect.any(String),
    });
    expect(result).toEqual({
      dismissed: true,
      indiaPostOnboardingDismissedAt: "2026-10-22T06:00:00.000Z",
    });
  });
});
