import { describe, expect, it } from "vitest";
import {
  BOOKABLE_STATUSES,
  ORDER_LIMIT_MESSAGE,
  SUBSCRIPTION_INACTIVE_MESSAGE,
} from "@/modules/billing/usage";

describe("order quota policy", () => {
  it("allows booking on trial, active, and past due only", () => {
    expect(BOOKABLE_STATUSES).toEqual(["TRIAL", "ACTIVE", "PAST_DUE"]);
  });

  it("uses the upgrade copy from the product spec", () => {
    expect(ORDER_LIMIT_MESSAGE).toContain("monthly order limit");
    expect(SUBSCRIPTION_INACTIVE_MESSAGE).toContain("subscription is not active");
  });
});
