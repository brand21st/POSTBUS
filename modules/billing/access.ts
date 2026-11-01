import { trialIsLive } from "@/modules/billing/trial-policy";

/**
 * The single server-side billing access decision. Booking quota, plan features,
 * the session payload, and the billing page all read this, so they cannot
 * disagree about whether a workspace may run paid operations.
 *
 * Access is period based: a live trial, a paid period, or an admin grant (a plan
 * assigned or extended by Super Admin) are operational only until their period
 * ends. Statuses alone never grant access.
 */
export type BillingAccessState =
  | "TRIAL"
  | "ACTIVE"
  | "PAST_DUE"
  | "TRIAL_ENDED"
  | "PERIOD_ENDED"
  | "EXPIRED"
  | "PAYMENT_FAILED"
  | "PAUSED"
  | "CANCELLED"
  | "NONE";

export type BillingAccessRow = {
  status?: string | null;
  current_period_end?: string | null;
  expires_at?: string | null;
  trial_end?: string | null;
  cancel_at_period_end?: boolean | null;
  razorpay_subscription_id?: string | null;
};

export type BillingAccessDecision = {
  state: BillingAccessState;
  /** May run paid operations (booking, paid features). */
  operational: boolean;
  coverageEnd: string | null;
  coverageEnded: boolean;
};

/** One-time checkout (no Razorpay subscription) or trial/cancel-at-end: coverage stops at period end. */
export function coverageEndedAt(row: BillingAccessRow, now = Date.now()) {
  const end = row.current_period_end || row.expires_at || row.trial_end;
  if (!end || new Date(end).getTime() > now) return false;
  const status = (row.status ?? "").toUpperCase();
  if (status === "TRIAL") return true;
  if (row.cancel_at_period_end) return true;
  if (!row.razorpay_subscription_id) return true;
  return false;
}

export function decideBillingAccess(row: BillingAccessRow | null | undefined, now = Date.now()): BillingAccessDecision {
  if (!row) return { state: "NONE", operational: false, coverageEnd: null, coverageEnded: true };
  const status = (row.status ?? "").toUpperCase();
  const coverageEnd = row.current_period_end || row.expires_at || row.trial_end || null;
  const ended = coverageEndedAt(row, now);
  const base = { coverageEnd, coverageEnded: ended };
  if (status === "TRIAL") {
    return trialIsLive(row, now)
      ? { ...base, state: "TRIAL", operational: true }
      : { ...base, coverageEnded: true, state: "TRIAL_ENDED", operational: false };
  }
  if (status === "ACTIVE" || status === "PAST_DUE") {
    if (ended || !coverageEnd) return { ...base, coverageEnded: true, state: "PERIOD_ENDED", operational: false };
    return { ...base, state: status, operational: true };
  }
  if (status === "PAYMENT_FAILED" || status === "PAUSED" || status === "CANCELLED" || status === "EXPIRED") {
    return { ...base, coverageEnded: true, state: status, operational: false };
  }
  return { ...base, coverageEnded: true, state: "NONE", operational: false };
}
