import { formatPaise } from "@/lib/format";

export const BILLING_ANNOUNCEMENT_TIMEZONE = "Asia/Kolkata";
export const BILLING_START_IST_DATE = "2026-11-01";
export const BILLING_ANNOUNCEMENT_CTA_HREF = "/dashboard/billing";
export const BILLING_ANNOUNCEMENT_CTA_LABEL = "View Plans";

export type BillingAnnouncementPhase = "free" | "billing";

export type AnnouncementPlan = {
  name: string;
  monthlyPricePaise: number;
};

export const BILLING_ANNOUNCEMENT_COPY = {
  free: {
    emoji: "🎉",
    message:
      "You're enjoying full PostBus features FREE until October 31, 2026. Plans start from November 1.",
  },
  billing: {
    emoji: "💳",
    message: "PostBus billing starts today. Choose the plan that fits your shipping volume.",
  },
} as const;

export function istCalendarDate(now: Date = new Date(), timeZone = BILLING_ANNOUNCEMENT_TIMEZONE) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function billingAnnouncementPhase(now: Date = new Date()): BillingAnnouncementPhase {
  return istCalendarDate(now) >= BILLING_START_IST_DATE ? "billing" : "free";
}

export function formatAnnouncementPlans(plans: AnnouncementPlan[]) {
  return plans
    .filter((plan) => plan.name.trim() && Number.isFinite(plan.monthlyPricePaise))
    .map((plan) => {
      const name = plan.name.trim();
      const priceLabel = `${formatPaise(plan.monthlyPricePaise)}/month`;
      return { name, priceLabel, line: `${name} — ${priceLabel}` };
    });
}
