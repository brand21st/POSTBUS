import type { BillingAccessDecision } from "@/modules/billing/access";
import { remainingTrialDays } from "@/modules/billing/trial-policy";

/** A checkout opened in the last 30 minutes may still complete (UPI, bank redirects). */
export const CHECKOUT_PENDING_WINDOW_MS = 30 * 60_000;

export type BillingDisplayState =
  | "TRIAL"
  | "ACTIVE"
  | "COMPLIMENTARY"
  | "PAYMENT_FAILED"
  | "PAUSED"
  | "EXPIRED"
  | "NONE";

export type CheckoutDisplayState = "PAYMENT_PENDING" | "PAYMENT_FAILED" | "NOT_COMPLETED";

export type BillingTone = "success" | "warning" | "danger" | "neutral";

export type BillingDisplay = {
  state: BillingDisplayState;
  label: string;
  tone: BillingTone;
  /** True only for a covered period backed by a captured payment. */
  paidActive: boolean;
  trialDaysRemaining: number | null;
  cancelScheduled: boolean;
  checkout: {
    state: CheckoutDisplayState;
    label: string;
    planId: string | null;
    createdAt: string;
  } | null;
};

export type CheckoutIntentRow = {
  status: string;
  plan_id: string | null;
  created_at: string;
  failure_reason?: string | null;
  failed_attempts?: number;
};

export function checkoutDisplayState(row: CheckoutIntentRow, now = Date.now()): CheckoutDisplayState {
  if (row.failure_reason || (row.failed_attempts ?? 0) > 0) return "PAYMENT_FAILED";
  if (now - new Date(row.created_at).getTime() < CHECKOUT_PENDING_WINDOW_MS) return "PAYMENT_PENDING";
  return "NOT_COMPLETED";
}

const CHECKOUT_LABEL: Record<CheckoutDisplayState, string> = {
  PAYMENT_PENDING: "Payment Pending",
  PAYMENT_FAILED: "Payment Failed — Retry",
  NOT_COMPLETED: "Payment Not Completed",
};

export function checkoutDisplayLabel(state: CheckoutDisplayState) {
  return CHECKOUT_LABEL[state];
}

/** Merchant-facing status for one payments row. */
export function paymentDisplayStatus(
  row: { status: string; created_at: string; failure_reason?: string | null },
  now = Date.now()
): { label: string; tone: BillingTone } {
  const status = row.status.toUpperCase();
  if (status === "CAPTURED") return { label: "Paid", tone: "success" };
  if (status === "REFUNDED") return { label: "Refunded", tone: "neutral" };
  if (status === "FAILED") return { label: "Failed", tone: "danger" };
  const state = checkoutDisplayState({ status, plan_id: null, created_at: row.created_at, failure_reason: row.failure_reason }, now);
  if (state === "PAYMENT_FAILED") return { label: "Failed — not charged", tone: "danger" };
  if (state === "PAYMENT_PENDING") return { label: "Payment pending", tone: "warning" };
  return { label: "Not completed", tone: "neutral" };
}

/**
 * The billing page headline. Derived only from server state: the access decision,
 * whether the current period is backed by a captured payment, and the newest
 * unfinished checkout. A selected plan or an open checkout never shows as active.
 */
export function billingDisplay(input: {
  access: BillingAccessDecision;
  status: string | null;
  cancelAtPeriodEnd?: boolean | null;
  trialEnd?: string | null;
  hasCapturedPaymentForPeriod: boolean;
  latestCheckout?: CheckoutIntentRow | null;
  now?: number;
}): BillingDisplay {
  const now = input.now ?? Date.now();
  const checkout = input.latestCheckout
    ? (() => {
        const state = checkoutDisplayState(input.latestCheckout, now);
        return {
          state,
          label: checkoutDisplayLabel(state),
          planId: input.latestCheckout.plan_id,
          createdAt: input.latestCheckout.created_at,
        };
      })()
    : null;
  const base = { checkout, cancelScheduled: Boolean(input.cancelAtPeriodEnd), trialDaysRemaining: null };
  const { access } = input;
  if (access.state === "TRIAL") {
    const days = input.trialEnd || access.coverageEnd ? remainingTrialDays(String(input.trialEnd || access.coverageEnd), now) : 0;
    return {
      ...base,
      state: "TRIAL",
      label: `Free Trial — ${days} ${days === 1 ? "day" : "days"} remaining`,
      tone: "warning",
      paidActive: false,
      trialDaysRemaining: days,
    };
  }
  if (access.operational) {
    if (input.hasCapturedPaymentForPeriod) {
      return { ...base, state: "ACTIVE", label: "Active Subscription", tone: "success", paidActive: true };
    }
    return { ...base, state: "COMPLIMENTARY", label: "Active — plan granted by PostBus", tone: "success", paidActive: false };
  }
  if (access.state === "PAYMENT_FAILED") {
    return { ...base, state: "PAYMENT_FAILED", label: "Payment Failed — Retry", tone: "danger", paidActive: false };
  }
  if (access.state === "PAUSED") {
    return { ...base, state: "PAUSED", label: "Paused by PostBus support", tone: "danger", paidActive: false };
  }
  if (access.state === "NONE" && !input.status) {
    return { ...base, state: "NONE", label: "No Subscription — Upgrade Required", tone: "danger", paidActive: false };
  }
  return { ...base, state: "EXPIRED", label: "Subscription Expired — Upgrade Required", tone: "danger", paidActive: false };
}
