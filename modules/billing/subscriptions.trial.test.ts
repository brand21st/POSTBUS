import { describe, expect, it } from "vitest";
import { applyFullTrialAccess, mapPlan, type PlanRow } from "@/modules/billing/subscriptions";

function plan(partial: Partial<PlanRow> & Pick<PlanRow, "id" | "slug" | "name" | "monthly_order_limit" | "features">): PlanRow {
  return {
    description: null,
    monthly_price_paise: 0,
    yearly_price_paise: 0,
    is_active: true,
    display_order: 1,
    razorpay_monthly_plan_id: null,
    razorpay_yearly_plan_id: null,
    ...partial,
  };
}

describe("applyFullTrialAccess", () => {
  it("shows the highest plan name, unioned features, and max order quota", () => {
    const starter = mapPlan(
      plan({
        id: "starter",
        slug: "starter",
        name: "Starter",
        monthly_order_limit: 300,
        features: ["Up to 300 orders per billing period", "Shopify order sync"],
      })
    );
    const business = mapPlan(
      plan({
        id: "business",
        slug: "business",
        name: "Business",
        monthly_order_limit: 10000,
        features: ["Up to 10,000 orders per billing period", "Priority support"],
      })
    );
    const trial = applyFullTrialAccess(starter, [starter, business], 3);
    expect(trial.name).toBe("Business");
    expect(trial.monthlyOrderLimit).toBe(10000);
    expect(trial.description).toContain("3-day trial");
    expect(trial.features).toContain("Shopify order sync");
    expect(trial.features).toContain("Priority support");
  });
});
