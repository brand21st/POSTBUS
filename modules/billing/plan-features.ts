export const PLAN_FEATURE_OPTIONS = [
  "Shopify order sync",
  "Shipment workspace",
  "Label and barcode workflows",
  "Everything in Starter",
  "Bulk shipping tools",
  "Automation rules",
  "Manifest management",
  "Invoices",
  "Tracking page",
  "Analytics",
  "Everything in Pro",
  "Priority support",
  "WhatsApp (Wati) notifications",
  "India Post booking",
  "Custom packing labels",
] as const;

const ORDERS_FEATURE = /^up to .+ orders per billing period$/i;
const FEATURE_ALIASES: Record<string, string> = {
  "Operational analytics": "Analytics",
};

function catalogLine(line: string) {
  return FEATURE_ALIASES[line] ?? line;
}

export function ordersFeatureLine(limit: number) {
  return `Up to ${Number(limit).toLocaleString("en-IN")} orders per billing period`;
}

export function splitPlanFeatures(features: string[], orderLimit: number) {
  const generated = ordersFeatureLine(orderLimit);
  const rest = features
    .filter((line) => line !== generated && !ORDERS_FEATURE.test(line))
    .map(catalogLine);
  const catalog = new Set<string>(PLAN_FEATURE_OPTIONS);
  return {
    selected: PLAN_FEATURE_OPTIONS.filter((option) => rest.includes(option)),
    custom: rest.filter((line) => !catalog.has(line)),
  };
}

export function composePlanFeatures(orderLimit: number, selected: string[], customLines: string[]) {
  const catalog = new Set<string>(PLAN_FEATURE_OPTIONS);
  const checked = selected.filter((line) => catalog.has(line));
  const extra = customLines.map((line) => line.trim()).filter(Boolean);
  return [ordersFeatureLine(orderLimit), ...checked, ...extra];
}

export function mergeFullPlanFeatures(
  plans: Array<{ features: string[]; monthlyOrderLimit: number }>
) {
  const monthlyOrderLimit = Math.max(0, ...plans.map((plan) => Number(plan.monthlyOrderLimit) || 0));
  const seen = new Set<string>();
  const features: string[] = [];
  if (monthlyOrderLimit > 0) {
    const quota = ordersFeatureLine(monthlyOrderLimit);
    features.push(quota);
    seen.add(quota.toLowerCase());
  }
  for (const plan of plans) {
    for (const line of plan.features) {
      const text = line.trim();
      if (!text || ORDERS_FEATURE.test(text)) continue;
      const key = text.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      features.push(text);
    }
  }
  return { features, monthlyOrderLimit };
}
