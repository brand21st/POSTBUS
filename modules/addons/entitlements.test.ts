import { describe, expect, it } from "vitest";
import { accessModeForAddonStatus } from "@/modules/addons/entitlements";
import { BUSINESS_FEATURES } from "@/modules/billing/entitlements";

describe("addon entitlements", () => {
  const future = new Date(Date.now() + 86400000).toISOString();
  const past = new Date(Date.now() - 86400000).toISOString();

  it("grants full access only while the paid period is open", () => {
    expect(accessModeForAddonStatus({ status: "ACTIVE", currentPeriodEnd: future })).toBe("FULL");
    expect(accessModeForAddonStatus({ status: "CANCELLED", currentPeriodEnd: future })).toBe("FULL");
    expect(accessModeForAddonStatus({ status: "CANCELLED", currentPeriodEnd: past })).toBe("READ_ONLY");
    expect(accessModeForAddonStatus({ status: "EXPIRED", currentPeriodEnd: past })).toBe("READ_ONLY");
    expect(accessModeForAddonStatus({ status: "PAYMENT_PENDING" })).toBe("NONE");
    expect(accessModeForAddonStatus({ status: "PAYMENT_FAILED" })).toBe("NONE");
    expect(accessModeForAddonStatus({ status: "SUSPENDED" })).toBe("NONE");
  });

  it("is not a Starter Pro or Business plan feature", () => {
    expect(BUSINESS_FEATURES.join(" ")).not.toMatch(/accountant/i);
  });
});
