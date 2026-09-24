import { describe, expect, it } from "vitest";
import { composePlanFeatures, mergeFullPlanFeatures, ordersFeatureLine, splitPlanFeatures } from "@/modules/billing/plan-features";

describe("plan features", () => {
  it("always prepends the order-limit line and keeps custom extras", () => {
    const features = composePlanFeatures(5000, ["Shopify order sync"], ["Dedicated Slack channel"]);
    expect(features[0]).toBe(ordersFeatureLine(5000));
    expect(features).toContain("Shopify order sync");
    expect(features).toContain("Dedicated Slack channel");
  });

  it("splits catalog checks from custom lines and ignores the generated quota line", () => {
    const split = splitPlanFeatures(
      [ordersFeatureLine(1000), "Shopify order sync", "White-glove onboarding"],
      1000
    );
    expect(split.selected).toEqual(["Shopify order sync"]);
    expect(split.custom).toEqual(["White-glove onboarding"]);
  });

  it("unions every plan feature and takes the highest order limit for trial access", () => {
    const full = mergeFullPlanFeatures([
      { monthlyOrderLimit: 300, features: [ordersFeatureLine(300), "Shopify order sync"] },
      { monthlyOrderLimit: 10000, features: [ordersFeatureLine(10000), "Priority support", "Operational analytics"] },
    ]);
    expect(full.monthlyOrderLimit).toBe(10000);
    expect(full.features[0]).toBe(ordersFeatureLine(10000));
    expect(full.features).toContain("Shopify order sync");
    expect(full.features).toContain("Priority support");
    expect(full.features.filter((line) => /orders per billing period/i.test(line))).toHaveLength(1);
  });
});
