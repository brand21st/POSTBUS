import { describe, expect, it } from "vitest";
import {
  amountForCycle,
  yearlyListPricePaise,
  yearlyPricePaise,
  yearlySavingsPaise,
} from "@/modules/billing/prices";

describe("plan pricing", () => {
  it("applies 20% off yearly versus monthly list price", () => {
    expect(yearlyPricePaise(49900)).toBe(479040);
    expect(yearlyPricePaise(149900)).toBe(1439040);
    expect(yearlyPricePaise(550000)).toBe(5280000);
    expect(yearlyListPricePaise(149900)).toBe(1798800);
    expect(yearlySavingsPaise(149900)).toBe(359760);
  });

  it("picks the cycle amount from the plan row", () => {
    const plan = { monthly_price_paise: 49900, yearly_price_paise: 479040 };
    expect(amountForCycle(plan, "monthly")).toBe(49900);
    expect(amountForCycle(plan, "yearly")).toBe(479040);
  });
});
