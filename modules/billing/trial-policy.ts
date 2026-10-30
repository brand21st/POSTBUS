import { BILLING_ANNOUNCEMENT_TIMEZONE, istCalendarDate } from "@/lib/dashboard/billing-announcement";

export const LEGACY_JOIN_ON_OR_BEFORE_IST = "2026-10-26";
export const NEW_TRIAL_START_IST = "2026-10-27";
export const LEGACY_TRIAL_END_IST = "2026-11-01T00:00:00+05:30";
export const LEGACY_TRIAL_END_UTC = "2026-10-31T18:30:00.000Z";
export const NEW_TRIAL_DAYS = 7;
export const TRIAL_COHORT_LEGACY = "legacy_nov1";
export const TRIAL_COHORT_ROLLING = "rolling_7d";

export const TRIAL_ENDED_MESSAGE =
  "Your free Business Plan trial has expired. Upgrade your subscription to continue processing orders.";

export type TrialCohort = typeof TRIAL_COHORT_LEGACY | typeof TRIAL_COHORT_ROLLING;

export function trialCohortForOrganization(createdAt: Date | string): TrialCohort {
  const created = createdAt instanceof Date ? createdAt : new Date(createdAt);
  const joinDate = istCalendarDate(created, BILLING_ANNOUNCEMENT_TIMEZONE);
  return joinDate <= LEGACY_JOIN_ON_OR_BEFORE_IST ? TRIAL_COHORT_LEGACY : TRIAL_COHORT_ROLLING;
}

export function trialEndForOrganization(createdAt: Date | string): Date {
  const created = createdAt instanceof Date ? createdAt : new Date(createdAt);
  if (trialCohortForOrganization(created) === TRIAL_COHORT_LEGACY) {
    return new Date(LEGACY_TRIAL_END_UTC);
  }
  const end = new Date(created.getTime());
  end.setUTCDate(end.getUTCDate() + NEW_TRIAL_DAYS);
  return end;
}

export function trialCoverageEndIso(row: {
  trial_end?: string | null;
  current_period_end?: string | null;
  expires_at?: string | null;
}) {
  return row.trial_end || row.current_period_end || row.expires_at || null;
}

export function trialIsLive(
  row: {
    status?: string | null;
    trial_end?: string | null;
    current_period_end?: string | null;
    expires_at?: string | null;
  },
  now = Date.now()
) {
  if ((row.status ?? "").toUpperCase() !== "TRIAL") return false;
  const end = trialCoverageEndIso(row);
  if (!end) return false;
  return new Date(end).getTime() > now;
}

export function remainingTrialDays(trialEnd: Date | string, now = Date.now()) {
  const end = trialEnd instanceof Date ? trialEnd.getTime() : new Date(trialEnd).getTime();
  const ms = end - now;
  if (ms <= 0) return 0;
  return Math.max(1, Math.ceil(ms / 86_400_000));
}

export function formatTrialEndLong(trialEnd: Date | string, timeZone = BILLING_ANNOUNCEMENT_TIMEZONE) {
  const date = trialEnd instanceof Date ? trialEnd : new Date(trialEnd);
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

export function trialBannerCopy(input: {
  trial: boolean;
  coverageEnded: boolean;
  trialEnd?: string | null;
  cohort?: string | null;
  now?: number;
}) {
  const now = input.now ?? Date.now();
  if (input.coverageEnded || (!input.trial && (input.trialEnd ? new Date(input.trialEnd).getTime() <= now : false))) {
    return {
      title: "Business Plan Free Trial",
      message: "Your free trial has ended. Upgrade now to continue using PostBus.",
      ctaLabel: "Upgrade Now",
      ctaHref: "/dashboard/billing",
      ended: true as const,
    };
  }
  if (!input.trial || !input.trialEnd) return null;
  const cohort = input.cohort ?? (new Date(input.trialEnd).toISOString() === LEGACY_TRIAL_END_UTC ? TRIAL_COHORT_LEGACY : TRIAL_COHORT_ROLLING);
  const message =
    cohort === TRIAL_COHORT_LEGACY
      ? `Your Business Plan trial ends on ${formatTrialEndLong(input.trialEnd)}.`
      : `${remainingTrialDays(input.trialEnd, now)} days remaining in your Business Plan trial.`;
  return {
    title: "Business Plan Free Trial",
    message,
    ctaLabel: "View Plans",
    ctaHref: "/dashboard/billing#plans",
    ended: false as const,
  };
}
