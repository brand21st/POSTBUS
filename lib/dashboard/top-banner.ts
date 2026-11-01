import type { BillingAnnouncementPhase } from "@/lib/dashboard/billing-announcement";
import { trialBannerCopy } from "@/modules/billing/trial-policy";

export type DashboardTopBanner =
  | { kind: "trial"; copy: NonNullable<ReturnType<typeof trialBannerCopy>> }
  | { kind: BillingAnnouncementPhase };

/** A live Business trial must not be replaced by the 1 Nov paid-billing banner. */
export function pickDashboardTopBanner(input: {
  phase: BillingAnnouncementPhase;
  trialLive: boolean;
  trialEnd?: string | null;
  trialCohort?: string | null;
  now?: number;
}): DashboardTopBanner {
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
