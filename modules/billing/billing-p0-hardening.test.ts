import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const orderPayments = vi.fn();
const fulfill = vi.fn();

vi.mock("@/modules/razorpay/client", () => ({
  fetchRazorpayOrderPayments: (...args: unknown[]) => orderPayments(...args),
  fetchRazorpaySubscription: async () => ({}),
}));

vi.mock("@/lib/logger", () => ({ logError: vi.fn(), logInfo: vi.fn() }));

import { decideBillingAccess } from "@/modules/billing/access";
import {
  assertPlanFeature,
  entitlementsForSubscription,
  FEATURE,
  SUBSCRIPTION_REQUIRED_MESSAGE,
  UPGRADE_PLAN_MESSAGE,
} from "@/modules/billing/entitlements";
import { billingDisplay, paymentDisplayStatus } from "@/modules/billing/display";
import { runBillingSweep } from "@/modules/billing/cron";
import { processRazorpayEvent } from "@/modules/billing/webhooks";
import * as subscriptions from "@/modules/billing/subscriptions";
import type { SubscriptionRow } from "@/modules/billing/subscriptions";

const NOW = Date.parse("2026-11-01T06:00:00.000Z");
const DAY = 86_400_000;
const iso = (offsetDays: number) => new Date(NOW + offsetDays * DAY).toISOString();

const PLAN = (slug: string) => ({
  id: `plan-${slug}`,
  slug,
  name: slug[0].toUpperCase() + slug.slice(1),
  description: null,
  monthly_price_paise: 49900,
  yearly_price_paise: 479040,
  monthly_order_limit: 500,
  features: [],
  is_active: true,
  display_order: 1,
  razorpay_monthly_plan_id: null,
  razorpay_yearly_plan_id: null,
});

function row(overrides: Partial<SubscriptionRow> = {}): SubscriptionRow {
  return {
    id: "sub-1",
    organization_id: "org-1",
    plan_id: "plan-business",
    billing_cycle: "monthly",
    status: "TRIAL",
    amount_paise: 0,
    order_limit: 10000,
    started_at: iso(-10),
    current_period_start: iso(-10),
    current_period_end: iso(3),
    renews_at: iso(3),
    expires_at: iso(3),
    cancel_at_period_end: false,
    cancelled_at: null,
    trial_start: iso(-10),
    trial_end: iso(3),
    pending_plan_id: null,
    pending_billing_cycle: null,
    razorpay_subscription_id: null,
    razorpay_customer_id: null,
    razorpay_order_id: null,
    plans: PLAN("business"),
    ...overrides,
  };
}

describe("decideBillingAccess (one decision for booking, features, UI)", () => {
  it("grants a live trial and refuses an ended one", () => {
    expect(decideBillingAccess(row(), NOW)).toMatchObject({ state: "TRIAL", operational: true });
    expect(decideBillingAccess(row({ trial_end: iso(-1), current_period_end: iso(-1) }), NOW)).toMatchObject({
      state: "TRIAL_ENDED",
      operational: false,
    });
  });

  it("stops a one-time paid ACTIVE period at its end (F-04)", () => {
    const active = row({ status: "ACTIVE", trial_end: null, current_period_end: iso(5) });
    expect(decideBillingAccess(active, NOW)).toMatchObject({ state: "ACTIVE", operational: true });
    expect(decideBillingAccess({ ...active, current_period_end: iso(-1), expires_at: iso(-1) }, NOW)).toMatchObject({
      state: "PERIOD_ENDED",
      operational: false,
    });
  });

  it("keeps an admin-extended period operational until the new end", () => {
    const granted = row({ status: "ACTIVE", trial_end: null, current_period_end: iso(20), expires_at: iso(20) });
    expect(decideBillingAccess(granted, NOW).operational).toBe(true);
  });

  it("never grants PAYMENT_FAILED, PAUSED, CANCELLED, EXPIRED, or a missing row", () => {
    for (const status of ["PAYMENT_FAILED", "PAUSED", "CANCELLED", "EXPIRED"]) {
      expect(decideBillingAccess(row({ status, current_period_end: iso(20) }), NOW).operational).toBe(false);
    }
    expect(decideBillingAccess(null, NOW)).toMatchObject({ state: "NONE", operational: false });
  });

  it("treats an ACTIVE row without any period end as not covered", () => {
    expect(
      decideBillingAccess(row({ status: "ACTIVE", current_period_end: null, expires_at: null, trial_end: null }), NOW).operational
    ).toBe(false);
  });
});

describe("entitlements after coverage ends (F-05)", () => {
  it("removes every paid feature from an ended trial but keeps history readable", () => {
    const ended = entitlementsForSubscription(row({ status: "EXPIRED", trial_end: iso(-1), current_period_end: iso(-1) }), NOW);
    expect(ended.entitled).toBe(false);
    expect(ended.features).toEqual([]);
    expect(ended.historyFeatures).toEqual(
      expect.arrayContaining([FEATURE.invoices, FEATURE.manifests, FEATURE.trackingPage])
    );
    expect(ended.historyFeatures).not.toContain(FEATURE.analytics);
    expect(ended.historyFeatures).not.toContain(FEATURE.automation);
  });

  it("keeps plan features for a live paid period", () => {
    const paid = entitlementsForSubscription(
      row({ status: "ACTIVE", plans: PLAN("starter"), trial_end: null, current_period_end: iso(10) }),
      NOW
    );
    expect(paid.entitled).toBe(true);
    expect(paid.features).toContain(FEATURE.indiaPost);
    expect(paid.features).not.toContain(FEATURE.analytics);
  });

  function dbFor(subscription: SubscriptionRow | null) {
    const query = {
      select: () => query,
      eq: () => query,
      in: () => query,
      order: () => query,
      limit: () => query,
      maybeSingle: async () => ({ data: subscription }),
    };
    return { from: () => query } as never;
  }

  it("refuses paid operations for an expired merchant and allows only GET history", async () => {
    const expired = row({ status: "EXPIRED", trial_end: iso(-2), current_period_end: iso(-2) });
    await expect(assertPlanFeature(dbFor(expired), "org-1", FEATURE.analytics, { method: "GET" })).rejects.toThrow(
      SUBSCRIPTION_REQUIRED_MESSAGE
    );
    await expect(assertPlanFeature(dbFor(expired), "org-1", FEATURE.automation, { method: "POST" })).rejects.toThrow(
      SUBSCRIPTION_REQUIRED_MESSAGE
    );
    await expect(assertPlanFeature(dbFor(expired), "org-1", FEATURE.invoices, { method: "POST" })).rejects.toThrow(
      SUBSCRIPTION_REQUIRED_MESSAGE
    );
    await expect(assertPlanFeature(dbFor(expired), "org-1", FEATURE.invoices, { method: "GET" })).resolves.toBeTruthy();
  });

  it("keeps the upgrade message for a covered plan that lacks the feature", async () => {
    const starter = row({ status: "ACTIVE", plans: PLAN("starter"), trial_end: null, current_period_end: iso(10) });
    await expect(assertPlanFeature(dbFor(starter), "org-1", FEATURE.analytics, { method: "GET" })).rejects.toThrow(
      UPGRADE_PLAN_MESSAGE
    );
  });
});

describe("billing display labels (F-10)", () => {
  const access = (r: SubscriptionRow | null) => decideBillingAccess(r, NOW);

  it("shows a trial as a free trial with days left, never as a paid subscription", () => {
    const display = billingDisplay({
      access: access(row()),
      status: "TRIAL",
      trialEnd: iso(3),
      hasCapturedPaymentForPeriod: false,
      now: NOW,
    });
    expect(display).toMatchObject({ state: "TRIAL", label: "Free Trial — 3 days remaining", paidActive: false });
  });

  it("labels paid, complimentary, failed, and expired states", () => {
    const active = row({ status: "ACTIVE", trial_end: null, current_period_end: iso(10) });
    expect(billingDisplay({ access: access(active), status: "ACTIVE", hasCapturedPaymentForPeriod: true, now: NOW })).toMatchObject({
      label: "Active Subscription",
      paidActive: true,
    });
    expect(billingDisplay({ access: access(active), status: "ACTIVE", hasCapturedPaymentForPeriod: false, now: NOW })).toMatchObject({
      state: "COMPLIMENTARY",
      paidActive: false,
    });
    expect(
      billingDisplay({ access: access(row({ status: "PAYMENT_FAILED" })), status: "PAYMENT_FAILED", hasCapturedPaymentForPeriod: false, now: NOW })
        .label
    ).toBe("Payment Failed — Retry");
    expect(
      billingDisplay({ access: access(row({ status: "EXPIRED", current_period_end: iso(-1) })), status: "EXPIRED", hasCapturedPaymentForPeriod: false, now: NOW })
        .label
    ).toBe("Subscription Expired — Upgrade Required");
  });

  it("describes an unfinished checkout without changing the plan state", () => {
    const base = { access: access(row()), status: "TRIAL", trialEnd: iso(3), hasCapturedPaymentForPeriod: false, now: NOW };
    const pending = billingDisplay({
      ...base,
      latestCheckout: { status: "PENDING", plan_id: "plan-pro", created_at: new Date(NOW - 5 * 60_000).toISOString() },
    });
    expect(pending.state).toBe("TRIAL");
    expect(pending.checkout?.label).toBe("Payment Pending");
    const closed = billingDisplay({
      ...base,
      latestCheckout: { status: "PENDING", plan_id: "plan-pro", created_at: new Date(NOW - 2 * 3_600_000).toISOString() },
    });
    expect(closed.checkout?.label).toBe("Payment Not Completed");
    const failed = billingDisplay({
      ...base,
      latestCheckout: { status: "PENDING", plan_id: "plan-pro", created_at: new Date(NOW - 60_000).toISOString(), failed_attempts: 2 },
    });
    expect(failed.checkout?.label).toBe("Payment Failed — Retry");
  });

  it("distinguishes pending checkouts from captured payments in history", () => {
    expect(paymentDisplayStatus({ status: "CAPTURED", created_at: iso(-1) }, NOW).label).toBe("Paid");
    expect(paymentDisplayStatus({ status: "PENDING", created_at: iso(-1) }, NOW).label).toBe("Not completed");
    expect(paymentDisplayStatus({ status: "PENDING", created_at: new Date(NOW - 60_000).toISOString() }, NOW).label).toBe(
      "Payment pending"
    );
    expect(paymentDisplayStatus({ status: "PENDING", created_at: iso(-1), failure_reason: "declined" }, NOW).label).toBe(
      "Failed — not charged"
    );
  });
});

describe("payment.failed webhook (F-06)", () => {
  function webhookDb() {
    const state = {
      payments: [
        {
          id: "intent-1",
          organization_id: "org-1",
          subscription_id: "sub-1",
          plan_id: "plan-pro",
          amount_paise: 149900,
          currency: "INR",
          status: "PENDING",
          billing_cycle: "monthly",
          razorpay_order_id: "order_retry",
          razorpay_payment_id: null as string | null,
          payment_purpose: "subscription",
          failure_reason: null as string | null,
        },
      ],
      attempts: [] as Array<Record<string, unknown>>,
      inserts: [] as Array<{ table: string; row: Record<string, unknown> }>,
    };
    const supabase = {
      rpc: async () => ({ data: null, error: null }),
      from(table: string) {
        const filters: Record<string, unknown> = {};
        const query: Record<string, unknown> = {
          select: () => query,
          eq(column: string, value: unknown) {
            filters[column] = value;
            return query;
          },
          not: () => query,
          in: () => query,
          order: () => query,
          limit: () => query,
          maybeSingle: async () => ({ data: null }),
          insert: async (rowValue: Record<string, unknown>) => {
            state.inserts.push({ table, row: rowValue });
            return { error: null };
          },
          upsert: async (rowValue: Record<string, unknown>) => {
            if (table === "payment_attempts") state.attempts.push(rowValue);
            return { error: null };
          },
          update(patch: Record<string, unknown>) {
            return {
              eq: async (column: string, value: unknown) => {
                if (table === "payments") {
                  const found = state.payments.find((item) => (item as Record<string, unknown>)[column] === value);
                  if (found) Object.assign(found, patch);
                }
                return { error: null };
              },
            };
          },
          then(resolve: (value: unknown) => void) {
            resolve({
              data:
                table === "payments"
                  ? state.payments.filter((item) => !filters.razorpay_order_id || item.razorpay_order_id === filters.razorpay_order_id)
                  : [],
              error: null,
            });
          },
        };
        return query;
      },
    };
    return { state, supabase };
  }

  it("records each failed attempt without adding a payments row or failing the intent", async () => {
    const { state, supabase } = webhookDb();
    for (const id of ["pay_f1", "pay_f2"]) {
      await processRazorpayEvent(
        supabase as never,
        {
          event: "payment.failed",
          payload: {
            payment: {
              entity: { id, order_id: "order_retry", amount: 149900, currency: "INR", error_description: "Card declined" },
            },
          },
        },
        `evt_${id}`
      );
    }
    expect(state.attempts.map((attempt) => attempt.razorpay_payment_id)).toEqual(["pay_f1", "pay_f2"]);
    expect(state.attempts.every((attempt) => attempt.status === "FAILED" && attempt.purchase_id === "intent-1")).toBe(true);
    expect(state.inserts.filter((insert) => insert.table === "payments")).toHaveLength(0);
    expect(state.payments).toHaveLength(1);
    expect(state.payments[0]).toMatchObject({ status: "PENDING", failure_reason: "Card declined" });
  });
});

describe("pending payment reconciliation (F-07)", () => {
  function reconcileDb(rows: Array<Record<string, unknown>>, error: { message: string } | null = null) {
    const updates: Array<Record<string, unknown>> = [];
    const attempts: Array<Record<string, unknown>> = [];
    const query: Record<string, unknown> = {
      select: () => query,
      eq: () => query,
      not: () => query,
      lte: () => query,
      gte: () => query,
      or: () => query,
      order: () => query,
      limit: async () => ({ data: rows, error }),
    };
    const supabase = {
      from(table: string) {
        if (table === "payment_attempts") {
          return {
            upsert: async (value: Record<string, unknown>) => {
              attempts.push(value);
              return { error: null };
            },
          };
        }
        return {
          ...query,
          update(patch: Record<string, unknown>) {
            updates.push(patch);
            const chain = { eq: () => chain, then: (resolve: (value: unknown) => void) => resolve({ error: null }) };
            return chain;
          },
        };
      },
    };
    return { supabase, updates, attempts };
  }

  const pendingRow = {
    id: "intent-1",
    organization_id: "org-1",
    razorpay_order_id: "order_paid",
    amount_paise: 149900,
    currency: "INR",
    reconcile_attempts: 0,
  };

  beforeEach(() => {
    orderPayments.mockReset();
    fulfill.mockReset();
    vi.spyOn(subscriptions, "fulfillCapturedSubscriptionPurchase").mockImplementation((...args) => fulfill(...args));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fulfills a captured payment that verify and the webhook both missed, through the same RPC", async () => {
    const { reconcilePendingSubscriptionPayments } = await import("@/modules/billing/reconcile");
    orderPayments.mockResolvedValue({
      items: [
        { id: "pay_failed", order_id: "order_paid", status: "failed", amount: 149900, currency: "INR" },
        { id: "pay_ok", order_id: "order_paid", status: "captured", amount: 149900, currency: "INR", method: "upi" },
      ],
    });
    fulfill.mockResolvedValue({ handled: true, subscriptionId: "sub-1" });
    const db = reconcileDb([pendingRow]);
    const summary = await reconcilePendingSubscriptionPayments(db.supabase as never, { now: new Date(NOW) });
    expect(summary).toMatchObject({ checked: 1, fulfilled: 1, manualReview: 0 });
    expect(fulfill).toHaveBeenCalledTimes(1);
    expect(fulfill.mock.calls[0][1]).toMatchObject({
      razorpayOrderId: "order_paid",
      paymentId: "pay_ok",
      amountPaise: 149900,
      organizationId: "org-1",
      reason: "reconcile.payment_captured",
    });
    expect(db.attempts.map((attempt) => attempt.razorpay_payment_id)).toEqual(["pay_failed"]);
    expect(db.updates[0]).toHaveProperty("reconcile_checked_at");
  });

  it("never activates unpaid or authorized-only orders, and leaves double captures for review", async () => {
    const { reconcilePendingSubscriptionPayments } = await import("@/modules/billing/reconcile");
    const db = reconcileDb([
      pendingRow,
      { ...pendingRow, id: "intent-2", razorpay_order_id: "order_auth" },
      { ...pendingRow, id: "intent-3", razorpay_order_id: "order_double" },
    ]);
    orderPayments.mockImplementation(async (orderId: string) => {
      if (orderId === "order_auth") return { items: [{ id: "pay_a", order_id: orderId, status: "authorized", amount: 149900 }] };
      if (orderId === "order_double") {
        return {
          items: [
            { id: "pay_1", order_id: orderId, status: "captured", amount: 149900 },
            { id: "pay_2", order_id: orderId, status: "captured", amount: 149900 },
          ],
        };
      }
      return { items: [] };
    });
    const summary = await reconcilePendingSubscriptionPayments(db.supabase as never, { now: new Date(NOW) });
    expect(summary).toMatchObject({ checked: 3, unpaid: 1, authorizedOnly: 1, manualReview: 1, fulfilled: 0 });
    expect(fulfill).not.toHaveBeenCalled();
  });

  it("skips cleanly before the hardening migration is applied", async () => {
    const { reconcilePendingSubscriptionPayments } = await import("@/modules/billing/reconcile");
    const db = reconcileDb([], { message: "column payments.reconcile_checked_at does not exist" });
    const summary = await reconcilePendingSubscriptionPayments(db.supabase as never, { now: new Date(NOW) });
    expect(summary.skipped).toBe("migration_pending");
    expect(orderPayments).not.toHaveBeenCalled();
  });
});

describe("billing sweep one-time ACTIVE expiry flag (F-04)", () => {
  function sweepDb(rows: Array<Record<string, unknown>>) {
    const expired: string[] = [];
    const supabase = {
      from(table: string) {
        if (table === "subscription_history") return { insert: async () => ({ error: null }) };
        const selectChain = {
          select: () => selectChain,
          in: () => selectChain,
          not: () => selectChain,
          lte: async () => ({ data: rows, error: null }),
        };
        return {
          ...selectChain,
          update() {
            let id = "";
            const chain: Record<string, unknown> = {
              eq: (column: string, value: unknown) => {
                if (column === "id") id = String(value);
                return chain;
              },
              lte: () => chain,
              select: async () => {
                expired.push(id);
                return { data: [{ id }], error: null };
              },
            };
            return chain;
          },
        };
      },
    };
    return { supabase, expired };
  }

  const ended = {
    id: "one-time",
    organization_id: "org-1",
    status: "ACTIVE",
    cancel_at_period_end: false,
    current_period_end: "2026-10-31T18:30:00.000Z",
    razorpay_subscription_id: null,
  };

  afterEach(() => {
    delete process.env.BILLING_EXPIRE_ONE_TIME_ACTIVE;
  });

  it("does not rewrite ended one-time ACTIVE rows unless the owner enables it", async () => {
    const off = sweepDb([ended]);
    await runBillingSweep(off.supabase as never);
    expect(off.expired).toEqual([]);
    process.env.BILLING_EXPIRE_ONE_TIME_ACTIVE = "true";
    const on = sweepDb([ended, { ...ended, id: "recurring", razorpay_subscription_id: "sub_rzp" }]);
    await runBillingSweep(on.supabase as never);
    expect(on.expired).toEqual(["one-time"]);
  });
});
