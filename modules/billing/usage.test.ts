import { describe, expect, it } from "vitest";
import { subscriptionCoverageEnded } from "@/modules/billing/usage";

const past = "2026-10-24T18:53:09.000Z";
const future = "2027-10-24T18:53:09.000Z";
const now = Date.parse("2026-10-27T05:00:00.000Z");

describe("subscriptionCoverageEnded", () => {
  it("treats a one-time paid period as ended after current_period_end", () => {
    expect(
      subscriptionCoverageEnded(
        { status: "ACTIVE", current_period_end: past, razorpay_subscription_id: null },
        now
      )
    ).toBe(true);
  });

  it("leaves a Razorpay recurring subscription live past period end until sweep/reconcile", () => {
    expect(
      subscriptionCoverageEnded(
        { status: "ACTIVE", current_period_end: past, razorpay_subscription_id: "sub_rzp" },
        now
      )
    ).toBe(false);
  });

  it("is false while the paid period is still open", () => {
    expect(
      subscriptionCoverageEnded(
        { status: "ACTIVE", current_period_end: future, razorpay_subscription_id: null },
        now
      )
    ).toBe(false);
  });
});
