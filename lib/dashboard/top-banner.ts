import type { BillingAnnouncementPhase } from "@/lib/dashboard/billing-announcement";
import { trialBannerCopy } from "@/modules/billing/trial-policy";

const PAID_PLAN_STATUSES = new Set(["ACTIVE", "PAST_DUE", "PAUSED"]);

export type DashboardTopBanner =
  | { kind: "none" }
  | { kind: "trial"; copy: NonNullable<ReturnType<typeof trialBannerCopy>> }
  | { kind: BillingAnnouncementPhase };

/** Paid coverage already chose a plan, so the "choose a plan" banner stays hidden. */
export function organizationHasPaidPlan(input: {
  status?: string | null;
  trialLive: boolean;
  coverageEnded: boolean;
}) {
  if (input.trialLive || input.coverageEnded) return false;
  return PAID_PLAN_STATUSES.has((input.status ?? "").toUpperCase());
}

/** A live Business trial must not be replaced by the 1 Nov paid-billing banner. */
export function pickDashboardTopBanner(input: {
  phase: BillingAnnouncementPhase;
  trialLive: boolean;
  trialEnd?: string | null;
  trialCohort?: string | null;
  paidPlan?: boolean;
  now?: number;
}): DashboardTopBanner {
  if (input.paidPlan) return { kind: "none" };
  if (input.trialLive) {
    const copy = trialBannerCopy({
      trial: true,
      coverageEnded: false,
      trialEnd: input.trialEnd,
      cohort: input.trialCohort,
      now: input.now,
    });
    if (copy) return { kind: "trial", copy };
    return { kind: "free" };
  }
  return { kind: input.phase };
}
