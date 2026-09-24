export function paiseToRupees(paise: number | null | undefined) {
  if (paise === null || paise === undefined || Number.isNaN(Number(paise))) return 0;
  return Number(paise) / 100;
}

export function yearlyPricePaise(monthlyPricePaise: number) {
  return Math.round(monthlyPricePaise * 12 * 0.8);
}

export function yearlyListPricePaise(monthlyPricePaise: number) {
  return monthlyPricePaise * 12;
}

export function yearlySavingsPaise(monthlyPricePaise: number) {
  return yearlyListPricePaise(monthlyPricePaise) - yearlyPricePaise(monthlyPricePaise);
}

export function monthlyEquivalentPaise(yearlyPricePaiseValue: number) {
  return Math.round(yearlyPricePaiseValue / 12);
}

export function amountForCycle(plan: { monthly_price_paise: number; yearly_price_paise: number }, cycle: "monthly" | "yearly") {
  return cycle === "yearly" ? Number(plan.yearly_price_paise) : Number(plan.monthly_price_paise);
}
