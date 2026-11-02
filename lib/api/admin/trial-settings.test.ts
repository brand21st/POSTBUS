import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const selectCalls: string[] = [];

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from(table: string) {
      expect(table).toBe("platform_settings");
      return {
        select(columns: string) {
          selectCalls.push(columns);
          return {
            eq() {
              return {
                maybeSingle: async () => ({
                  data: { trial_enabled: true, trial_days: 3 },
                }),
                select(inner: string) {
                  selectCalls.push(inner);
                  return {
                    single: async () => ({ data: { trial_enabled: false, trial_days: 7 }, error: null }),
                  };
                },
                single: async () => ({ data: { trial_enabled: true, trial_days: 3 }, error: null }),
              };
            },
          };
        },
        update() {
          return {
            eq() {
              return {
                select(columns: string) {
                  selectCalls.push(columns);
                  return {
                    single: async () => ({ data: { trial_enabled: false, trial_days: 7 }, error: null }),
                  };
                },
              };
            },
          };
        },
      };
    },
  }),
}));

vi.mock("@/modules/billing/audit", () => ({
  writeBillingAudit: async () => undefined,
  writeSubscriptionHistory: async () => undefined,
}));

describe("admin trial-settings", () => {
  it("selects only trial_enabled and trial_days", { timeout: 20000 }, async () => {
    const { handleAdminRoutes } = await import("@/lib/api/admin/handle");
    const ctx = { userId: "admin-1", email: "admin@example.com" };
    selectCalls.length = 0;
    const getResult = await handleAdminRoutes(
      new NextRequest("http://localhost/api/admin/trial-settings"),
      ctx,
      ["trial-settings"],
      "GET"
    );
    expect(selectCalls).toEqual(["trial_enabled, trial_days"]);
    expect(getResult).toEqual({ trial_enabled: true, trial_days: 3 });

    selectCalls.length = 0;
    const patchReq = new NextRequest("http://localhost/api/admin/trial-settings", {
      method: "PATCH",
      body: JSON.stringify({ trialEnabled: false, trialDays: 7 }),
    });
    const patchResult = await handleAdminRoutes(patchReq, ctx, ["trial-settings"], "PATCH");
    expect(selectCalls).toEqual(["trial_enabled, trial_days"]);
    expect(patchResult).toEqual({ trial_enabled: false, trial_days: 7 });
  });
});
