export const ADDON_PAYMENT_PURPOSE = "addon";
export const AI_CREDITS_PAYMENT_PURPOSE = "ai_credits";
export const SUBSCRIPTION_PAYMENT_PURPOSE = "subscription";

export const AI_ACCOUNTANT_SLUG = "ai-accountant";

export const ADDON_LIVE_STATUSES = [
  "PAYMENT_PENDING",
  "ACTIVE",
  "PAYMENT_FAILED",
  "SUSPENDED",
  "CANCELLED",
] as const;

export const ADDON_ACCESS_MODES = ["FULL", "READ_ONLY", "NONE"] as const;
export type AddonAccessMode = (typeof ADDON_ACCESS_MODES)[number];

export const ADDON_SUBSCRIPTION_STATUSES = [
  "PAYMENT_PENDING",
  "ACTIVE",
  "PAYMENT_FAILED",
  "SUSPENDED",
  "CANCELLED",
  "EXPIRED",
] as const;
export type AddonSubscriptionStatus = (typeof ADDON_SUBSCRIPTION_STATUSES)[number];

export function isAddonPaymentRow(row?: {
  payment_purpose?: string | null;
  billing_cycle?: string | null;
} | null) {
  const purpose = String(row?.payment_purpose ?? "");
  const cycle = String(row?.billing_cycle ?? "");
  return purpose === ADDON_PAYMENT_PURPOSE || cycle === ADDON_PAYMENT_PURPOSE || cycle.startsWith("addon:");
}
