import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("@/modules/razorpay/config", () => ({
  getRazorpayConfig: async () => ({ keyId: "rzp_test_key", keySecret: "secret" }),
}));
vi.mock("@/modules/razorpay/client", () => ({
  cancelRazorpaySubscription: vi.fn(),
  createRazorpayCustomer: async () => ({ id: "cust_1" }),
  createRazorpayOrder: vi.fn(async () => ({ id: "order_new" })),
  createRazorpayPlan: vi.fn(),
  fetchRazorpayPayment: vi.fn(async () => ({ status: "captured", amount: 149900, order_id: "order_new", method: "upi" })),
  pauseRazorpaySubscription: vi.fn(),
}));
vi.mock("@/modules/razorpay/signature", () => ({
  verifyCheckoutSignature: () => false,
  verifyOrderCheckoutSignature: () => true,
}));
vi.mock("@/modules/billing/audit", () => ({ writeBillingAudit: vi.fn(), writeSubscriptionHistory: vi.fn() }));
vi.mock("@/lib/notifications/billing", () => ({ insertBillingNotification: vi.fn(), BILLING_NOTICE: { activated: {}, cancelled: {} } }));
vi.mock("@/modules/ai-credits/service", () => ({ fulfillCapturedAiCreditPayment: async () => ({ handled: false }) }));
vi.mock("@/modules/addons/activate", () => ({ activateAddonFromPayment: async () => ({ handled: false }) }));

import { changePlan, resumeSubscription, startCheckout, verifyCheckout } from "@/modules/billing/subscriptions";

type Row = Record<string, unknown>;
const ORG = "org-1";

function plan(id: string, monthly: number, limit: number): Row {
  return {
    id, slug: id, name: id, description: null, monthly_price_paise: monthly, yearly_price_paise: monthly * 10,
    monthly_order_limit: limit, features: [], is_active: true, display_order: 1,
    razorpay_monthly_plan_id: null, razorpay_yearly_plan_id: null,
  };
}

/** Minimal in-memory PostgREST stand-in for the calls the billing module makes. */
function fakeDb(tables: Record<string, Row[]>) {
  let seq = 0;
  const client = {
    from(table: string) {
      const rows = (tables[table] ??= []);
      const filters: Array<(row: Row) => boolean> = [];
      let joinPlans = false;
      let mode: "select" | "update" = "select";
      let patch: Row = {};
      const matches = () => rows.filter((row) => filters.every((filter) => filter(row)));
      const withJoin = (row: Row) =>
        joinPlans ? { ...row, plans: tables.plans.find((p) => p.id === row.plan_id) ?? null } : { ...row };
      const run = () => {
        if (mode === "update") {
          for (const row of matches()) Object.assign(row, patch);
          return { data: null, error: null };
        }
        const found = [...matches()].sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")));
        return { data: found.map(withJoin), error: null };
      };
      const query: Record<string, unknown> = {
        select(columns?: string) {
          if (columns?.includes("plans")) joinPlans = true;
          return query;
        },
        eq(column: string, value: unknown) {
          filters.push((row) => row[column] === value);
          return query;
        },
        in(column: string, values: unknown[]) {
          filters.push((row) => values.includes(row[column]));
          return query;
        },
        not(column: string) {
          filters.push((row) => row[column] != null);
          return query;
        },
        order: () => query,
        limit: () => query,
        maybeSingle: async () => ({ data: (run().data as Row[])[0] ?? null, error: null }),
        single: async () => ({ data: (run().data as Row[])[0] ?? null, error: null }),
        then(resolve: (value: unknown) => void) {
          resolve(run());
        },
        update(next: Row) {
          mode = "update";
          patch = next;
          return query;
        },
        upsert: async () => ({ error: null }),
        insert(row: Row) {
          const created = { id: `${table}-${++seq}`, created_at: new Date(Date.now() + seq).toISOString(), ...row };
          rows.push(created);
          const inserted = {
            select: () => ({ single: async () => ({ data: created, error: null }) }),
            then: (resolve: (value: unknown) => void) => resolve({ data: null, error: null }),
          };
          return inserted;
        },
      };
      return query;
    },
  };
  return client as unknown as SupabaseClient;
}

function liveSub(overrides: Row = {}): Row {
  return {
    id: "sub-1", organization_id: ORG, plan_id: "starter", billing_cycle: "monthly", status: "ACTIVE",
    amount_paise: 49900, order_limit: 300, started_at: "2026-10-01T00:00:00.000Z",
    current_period_start: "2026-10-01T00:00:00.000Z", current_period_end: "2026-11-01T00:00:00.000Z",
    cancel_at_period_end: false, cancelled_at: null, pending_plan_id: null, pending_billing_cycle: null,
    razorpay_subscription_id: null, razorpay_customer_id: null, razorpay_order_id: null,
    created_at: "2026-10-01T00:00:00.000Z", ...overrides,
  };
}

const checkoutInput = { organizationId: ORG, organizationName: "Shop", email: "a@b.c", userId: "user-1", planId: "pro", billingCycle: "monthly" as const };

describe("checkout intent", () => {
  let tables: Record<string, Row[]>;
  beforeEach(() => {
    tables = { plans: [plan("starter", 49900, 300), plan("pro", 149900, 5000)], subscriptions: [], payments: [] };
  });

  it("does not switch a live subscription to the new plan when checkout is only started", async () => {
    tables.subscriptions.push(liveSub());
    await startCheckout(fakeDb(tables), checkoutInput);
    const sub = tables.subscriptions[0];
    expect(sub.plan_id).toBe("starter");
    expect(sub.amount_paise).toBe(49900);
    expect(sub.order_limit).toBe(300);
    expect(tables.payments[0]).toMatchObject({ plan_id: "pro", amount_paise: 149900, status: "PENDING", razorpay_order_id: "order_new" });
  });

  it("does not create a live trial for a workspace without a subscription", async () => {
    await startCheckout(fakeDb(tables), checkoutInput);
    expect(tables.subscriptions).toHaveLength(1);
    expect(tables.subscriptions[0].status).toBe("EXPIRED");
  });

  it("applies the paid plan only after the payment is verified", async () => {
    tables.subscriptions.push(liveSub());
    const db = fakeDb(tables);
    await startCheckout(db, checkoutInput);
    await verifyCheckout(db, { organizationId: ORG, userId: "user-1", paymentId: "pay_1", razorpayOrderId: "order_new", signature: "sig" });
    expect(tables.subscriptions[0]).toMatchObject({ plan_id: "pro", amount_paise: 149900, order_limit: 5000, status: "ACTIVE" });
    expect(tables.payments[0]).toMatchObject({ status: "CAPTURED", razorpay_payment_id: "pay_1" });
  });

  it("activates a first-time subscriber after verification", async () => {
    const db = fakeDb(tables);
    await startCheckout(db, checkoutInput);
    await verifyCheckout(db, { organizationId: ORG, userId: "user-1", paymentId: "pay_1", razorpayOrderId: "order_new", signature: "sig" });
    expect(tables.subscriptions[0]).toMatchObject({ plan_id: "pro", status: "ACTIVE" });
  });
});

describe("resume and change plan", () => {
  let tables: Record<string, Row[]>;
  beforeEach(() => {
    tables = { plans: [plan("starter", 49900, 300), plan("pro", 149900, 5000)], subscriptions: [], payments: [] };
  });

  it("keeps a trial a trial when its cancellation is undone", async () => {
    tables.subscriptions.push(liveSub({ status: "TRIAL", cancel_at_period_end: true, cancelled_at: "2026-10-02T00:00:00.000Z" }));
    const result = await resumeSubscription(fakeDb(tables), { organizationId: ORG, userId: "user-1" });
    expect(result.status).toBe("TRIAL");
    expect(tables.subscriptions[0]).toMatchObject({ status: "TRIAL", cancel_at_period_end: false, cancelled_at: null });
  });

  it("does not let a merchant lift a support pause", async () => {
    tables.subscriptions.push(liveSub({ status: "PAUSED" }));
    await expect(resumeSubscription(fakeDb(tables), { organizationId: ORG, userId: "user-1" })).rejects.toThrow(/paused/i);
    expect(tables.subscriptions[0].status).toBe("PAUSED");
  });

  it("refuses an unpaid upgrade", async () => {
    tables.subscriptions.push(liveSub());
    await expect(changePlan(fakeDb(tables), { organizationId: ORG, userId: "user-1", planId: "pro" })).rejects.toThrow(/payment/i);
    expect(tables.subscriptions[0].plan_id).toBe("starter");
  });

  it("still schedules a downgrade for period end", async () => {
    tables.subscriptions.push(liveSub({ plan_id: "pro", amount_paise: 149900 }));
    const result = await changePlan(fakeDb(tables), { organizationId: ORG, userId: "user-1", planId: "starter" });
    expect(result.applied).toBe("period_end");
    expect(tables.subscriptions[0]).toMatchObject({ plan_id: "pro", pending_plan_id: "starter" });
  });
});
