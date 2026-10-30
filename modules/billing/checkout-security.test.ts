import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/api/errors";

const razorpayState = {
  payment: {
    id: "pay_1",
    status: "captured",
    amount: 149900,
    currency: "INR",
    order_id: "order_pro",
    method: "upi",
  } as Record<string, unknown>,
};

vi.mock("@/modules/razorpay/config", () => ({
  getRazorpayConfig: async () => ({ keyId: "rzp_test", keySecret: "secret" }),
}));

vi.mock("@/modules/razorpay/client", () => ({
  createRazorpayOrder: async () => ({ id: "order_pro" }),
  createRazorpayCustomer: async () => ({ id: "cust_1" }),
  fetchRazorpayPayment: async () => razorpayState.payment,
  resumeRazorpaySubscription: async () => ({}),
  cancelRazorpaySubscription: async () => ({}),
  pauseRazorpaySubscription: async () => ({}),
}));

vi.mock("@/modules/razorpay/signature", () => ({
  verifyOrderCheckoutSignature: (input: { signature: string }) => input.signature === "valid",
  verifyCheckoutSignature: () => false,
}));

vi.mock("@/modules/ai-credits/service", () => ({
  fulfillCapturedAiCreditPayment: async () => ({ handled: false }),
}));

import {
  changePlan,
  fulfillCapturedSubscriptionPurchase,
  resumeSubscription,
  startCheckout,
  verifyCheckout,
} from "@/modules/billing/subscriptions";
import { checkQuota, SUBSCRIPTION_INACTIVE_MESSAGE } from "@/modules/billing/usage";
import { processRazorpayEvent } from "@/modules/billing/webhooks";

const BUSINESS = {
  id: "plan-business",
  slug: "business",
  name: "Business",
  description: "Business",
  monthly_price_paise: 350000,
  yearly_price_paise: 3360000,
  monthly_order_limit: 10000,
  features: [],
  is_active: true,
  display_order: 3,
  razorpay_monthly_plan_id: null,
  razorpay_yearly_plan_id: null,
};

const PRO = {
  ...BUSINESS,
  id: "plan-pro",
  slug: "pro",
  name: "Pro",
  monthly_price_paise: 149900,
  yearly_price_paise: 1439040,
  monthly_order_limit: 3000,
  display_order: 2,
};

const STARTER = {
  ...BUSINESS,
  id: "plan-starter",
  slug: "starter",
  name: "Starter",
  monthly_price_paise: 49900,
  yearly_price_paise: 479040,
  monthly_order_limit: 500,
  display_order: 1,
};

type Payment = {
  id: string;
  organization_id: string;
  subscription_id: string | null;
  plan_id: string;
  amount_paise: number;
  currency: string;
  status: string;
  billing_cycle: string;
  razorpay_order_id: string | null;
  razorpay_payment_id: string | null;
  payment_purpose: string;
};

function liveSub(overrides: Record<string, unknown> = {}) {
  return {
    id: "sub-1",
    organization_id: "org-1",
    plan_id: BUSINESS.id,
    billing_cycle: "monthly" as const,
    status: "TRIAL",
    amount_paise: 0,
    order_limit: 10000,
    started_at: "2026-10-20T00:00:00.000Z",
    current_period_start: "2026-10-20T00:00:00.000Z",
    current_period_end: "2026-10-31T18:30:00.000Z",
    trial_end: "2026-10-31T18:30:00.000Z",
    trial_cohort: "legacy_nov1",
    expires_at: "2026-10-31T18:30:00.000Z",
    cancel_at_period_end: false,
    cancelled_at: null,
    pending_plan_id: null,
    razorpay_subscription_id: null,
    razorpay_customer_id: null,
    razorpay_order_id: null,
    created_at: "2026-10-20T00:00:00.000Z",
    plans: BUSINESS,
    ...overrides,
  };
}

function effectiveOf(subscription: ReturnType<typeof liveSub>) {
  return {
    plan_id: subscription.plan_id,
    status: subscription.status,
    amount_paise: subscription.amount_paise,
    order_limit: subscription.order_limit,
    billing_cycle: subscription.billing_cycle,
    trial_end: subscription.trial_end,
    trial_cohort: subscription.trial_cohort,
    current_period_end: subscription.current_period_end,
    expires_at: subscription.expires_at,
  };
}

function createDb(state: {
  subscription: ReturnType<typeof liveSub>;
  payments: Payment[];
  extraSubscriptions?: Array<ReturnType<typeof liveSub>>;
  rpcMissing?: boolean;
  rpcFailOnce?: boolean;
}) {
  const plans = [STARTER, PRO, BUSINESS];
  let rpcLock = Promise.resolve();
  const usage = { orders_used: 4, order_limit: state.subscription.order_limit, period_start: "2026-10-01" };
  const supabase = {
    async rpc(name: string, args: Record<string, unknown>) {
      if (name === "ensure_billing_period") {
        return { data: usage, error: null };
      }
      if (state.rpcMissing || name !== "fulfill_captured_subscription_purchase") {
        return { data: null, error: { code: "42883", message: "function does not exist" } };
      }
      if (state.rpcFailOnce) {
        state.rpcFailOnce = false;
        return { data: null, error: { message: "temporary activation failure" } };
      }
      const run = async () => {
        const matches = state.payments.filter(
          (row) =>
            row.razorpay_order_id === args.p_razorpay_order_id &&
            (!row.payment_purpose || row.payment_purpose === "subscription")
        );
        if (matches.length > 1) return { data: { handled: true, ambiguous: true }, error: null };
        const purchase = matches[0];
        if (!purchase) return { data: { handled: false, notFound: true }, error: null };
        if (
          args.p_expected_organization_id &&
          purchase.organization_id !== args.p_expected_organization_id
        ) {
          return { data: { handled: true, forbidden: true }, error: null };
        }
        if (Number(args.p_amount_paise) !== Number(purchase.amount_paise)) {
          return { data: { handled: true, amountMismatch: true }, error: null };
        }
        if (String(args.p_currency || "INR").toUpperCase() !== (purchase.currency || "INR").toUpperCase()) {
          return { data: { handled: true, currencyMismatch: true }, error: null };
        }
        if (purchase.status === "CAPTURED") {
          if (!purchase.razorpay_payment_id || purchase.razorpay_payment_id === args.p_razorpay_payment_id) {
            return {
              data: { handled: true, duplicate: true, subscriptionId: state.subscription.id },
              error: null,
            };
          }
          return { data: { handled: true, forbidden: true }, error: null };
        }
        const catalog = [state.subscription, ...(state.extraSubscriptions ?? [])];
        let target = state.subscription;
        if (purchase.subscription_id) {
          const named = catalog.find((row) => row.id === purchase.subscription_id);
          if (!named) {
            return { data: { handled: true, integrityError: true, notFound: true }, error: null };
          }
          if (named.organization_id !== purchase.organization_id) {
            return { data: { handled: true, forbidden: true }, error: null };
          }
          target = named;
        } else {
          const rank: Record<string, number> = {
            ACTIVE: 0,
            PAST_DUE: 1,
            TRIAL: 2,
            PAYMENT_FAILED: 3,
            PAUSED: 4,
            EXPIRED: 5,
            CANCELLED: 6,
          };
          const payable = catalog
            .filter((row) => row.organization_id === purchase.organization_id)
            .sort(
              (a, b) =>
                (rank[a.status] ?? 7) - (rank[b.status] ?? 7) ||
                String(b.created_at).localeCompare(String(a.created_at))
            );
          if (!payable[0]) return { data: { handled: true, notFound: true }, error: null };
          target = payable[0];
        }
        const plan = plans.find((item) => item.id === purchase.plan_id);
        purchase.status = "CAPTURED";
        purchase.razorpay_payment_id = String(args.p_razorpay_payment_id);
        purchase.subscription_id = target.id;
        const paidStart = new Date().toISOString();
        const paidEnd = new Date(Date.now() + 30 * 86400000).toISOString();
        Object.assign(target, {
          status: "ACTIVE",
          plan_id: purchase.plan_id,
          amount_paise: purchase.amount_paise,
          order_limit: plan?.monthly_order_limit ?? target.order_limit,
          billing_cycle: purchase.billing_cycle,
          current_period_start: paidStart,
          current_period_end: paidEnd,
          expires_at: paidEnd,
        });
        if (target.id === state.subscription.id) Object.assign(state.subscription, target);
        usage.order_limit = plan?.monthly_order_limit ?? usage.order_limit;
        return { data: { handled: true, granted: true, subscriptionId: target.id }, error: null };
      };
      const queued = rpcLock.then(run, run);
      rpcLock = queued.then(
        () => undefined,
        () => undefined
      );
      return queued;
    },
    from(table: string) {
      const filters: Record<string, unknown> = {};
      const query: Record<string, unknown> = {
        select() {
          return query;
        },
        eq(column: string, value: unknown) {
          filters[column] = value;
          return query;
        },
        in(column: string, values: unknown) {
          filters[column] = values;
          return query;
        },
        order() {
          return query;
        },
        limit() {
          return query;
        },
        maybeSingle: async () => {
          if (table === "plans") {
            const found = plans.find((plan) => plan.id === filters.id);
            return { data: found ?? null, error: found ? null : { message: "missing" } };
          }
          if (table === "razorpay_customers") return { data: { razorpay_customer_id: "cust_1" } };
          if (table === "organizations") return { data: { account_status: "ACTIVE" } };
          if (table === "subscriptions") {
            if (filters.id && filters.id !== state.subscription.id) return { data: null };
            if (filters.organization_id && filters.organization_id !== state.subscription.organization_id) {
              return { data: null };
            }
            if (Array.isArray(filters.status) && !filters.status.includes(state.subscription.status)) {
              return { data: null };
            }
            return { data: { ...state.subscription, plans: plans.find((plan) => plan.id === state.subscription.plan_id) } };
          }
          if (table === "payments") {
            const found = state.payments.find((row) => {
              if (filters.razorpay_order_id) return row.razorpay_order_id === filters.razorpay_order_id;
              if (filters.razorpay_payment_id) return row.razorpay_payment_id === filters.razorpay_payment_id;
              if (filters.id) return row.id === filters.id;
              if (filters.organization_id && filters.status) {
                return (
                  row.organization_id === filters.organization_id &&
                  row.status === filters.status &&
                  (!filters.payment_purpose || row.payment_purpose === filters.payment_purpose)
                );
              }
              return false;
            });
            return { data: found ? { ...found } : null };
          }
          if (table === "invoices") return { data: null };
          return { data: null };
        },
        single: async () => query.maybeSingle(),
        insert: async (row: Record<string, unknown>) => {
          if (table === "payments") {
            state.payments.push({
              id: `payrow-${state.payments.length + 1}`,
              organization_id: String(row.organization_id),
              subscription_id: (row.subscription_id as string | null) ?? null,
              plan_id: String(row.plan_id),
              amount_paise: Number(row.amount_paise),
              currency: String(row.currency ?? "INR"),
              status: String(row.status),
              billing_cycle: String(row.billing_cycle),
              razorpay_order_id: (row.razorpay_order_id as string | null) ?? null,
              razorpay_payment_id: (row.razorpay_payment_id as string | null) ?? null,
              payment_purpose: String(row.payment_purpose ?? "subscription"),
            });
          }
          return { error: null, data: { id: "new" } };
        },
        update(row: Record<string, unknown>) {
          return {
            async eq(column: string, value: unknown) {
              filters[column] = value;
              if (table === "subscriptions") {
                Object.assign(state.subscription, row);
              }
              if (table === "payments") {
                const found = state.payments.find((item) => {
                  if (column === "id") return item.id === value;
                  if (column === "razorpay_payment_id") return item.razorpay_payment_id === value;
                  if (column === "razorpay_order_id") return item.razorpay_order_id === value;
                  return false;
                });
                if (found) Object.assign(found, row);
              }
              return { error: null };
            },
          };
        },
        upsert: async () => ({ error: null }),
        then(resolve: (value: unknown) => void) {
          if (table === "payments" && filters.razorpay_order_id) {
            resolve({
              data: state.payments.filter((row) => row.razorpay_order_id === filters.razorpay_order_id),
              error: null,
            });
            return;
          }
          return Promise.resolve((query.maybeSingle as () => Promise<{ data: unknown }>)()).then((result) => {
            resolve({ data: result.data ? [result.data] : [], error: null });
          });
        },
      };
      return query;
    },
  };
  return { state, supabase, usage };
}

const owner = {
  organizationId: "org-1",
  organizationName: "Org",
  email: "a@example.com",
  userId: "user-1",
};

describe("P0 checkout payment bypass", () => {
  beforeEach(() => {
    razorpayState.payment = {
      id: "pay_1",
      status: "captured",
      amount: 149900,
      currency: "INR",
      order_id: "order_pro",
      method: "upi",
    };
  });

  it("1. Business → Pro checkout start does not change the effective trial", async () => {
    const db = createDb({ subscription: liveSub(), payments: [] });
    const before = effectiveOf(db.state.subscription);
    await startCheckout(db.supabase as never, { ...owner, planId: PRO.id, billingCycle: "monthly" });
    expect(effectiveOf(db.state.subscription)).toEqual(before);
    expect(db.state.payments[0]?.plan_id).toBe(PRO.id);
    expect(db.state.payments[0]?.status).toBe("PENDING");
    expect(db.state.payments[0]?.amount_paise).toBe(149900);
  });

  it("2. Pro → Business checkout start does not change the effective plan", async () => {
    const db = createDb({
      subscription: liveSub({ plan_id: PRO.id, amount_paise: 149900, order_limit: 3000, plans: PRO }),
      payments: [],
    });
    const before = effectiveOf(db.state.subscription);
    await startCheckout(db.supabase as never, { ...owner, planId: BUSINESS.id, billingCycle: "monthly" });
    expect(effectiveOf(db.state.subscription)).toEqual(before);
    expect(db.state.payments[0]?.plan_id).toBe(BUSINESS.id);
  });

  it("3. Business → Starter checkout start keeps Business trial", async () => {
    const db = createDb({ subscription: liveSub(), payments: [] });
    const before = effectiveOf(db.state.subscription);
    await startCheckout(db.supabase as never, { ...owner, planId: STARTER.id, billingCycle: "monthly" });
    expect(effectiveOf(db.state.subscription)).toEqual(before);
  });

  it("4-6. failed, pending, and authorized payments do not activate", async () => {
    const db = createDb({
      subscription: liveSub(),
      payments: [
        {
          id: "p1",
          organization_id: "org-1",
          subscription_id: "sub-1",
          plan_id: PRO.id,
          amount_paise: 149900,
          currency: "INR",
          status: "PENDING",
          billing_cycle: "monthly",
          razorpay_order_id: "order_pro",
          razorpay_payment_id: null,
          payment_purpose: "subscription",
        },
      ],
    });
    const before = effectiveOf(db.state.subscription);
    for (const status of ["failed", "created", "authorized"]) {
      razorpayState.payment = { ...razorpayState.payment, status };
      await expect(
        verifyCheckout(db.supabase as never, {
          organizationId: "org-1",
          userId: "user-1",
          paymentId: "pay_1",
          razorpayOrderId: "order_pro",
          signature: "valid",
        })
      ).rejects.toBeInstanceOf(AppError);
      expect(effectiveOf(db.state.subscription)).toEqual(before);
    }
  });

  it("7. captured payment activates the intended Pro plan once", async () => {
    const db = createDb({
      subscription: liveSub(),
      payments: [
        {
          id: "p1",
          organization_id: "org-1",
          subscription_id: "sub-1",
          plan_id: PRO.id,
          amount_paise: 149900,
          currency: "INR",
          status: "PENDING",
          billing_cycle: "monthly",
          razorpay_order_id: "order_pro",
          razorpay_payment_id: null,
          payment_purpose: "subscription",
        },
      ],
    });
    await verifyCheckout(db.supabase as never, {
      organizationId: "org-1",
      userId: "user-1",
      paymentId: "pay_1",
      razorpayOrderId: "order_pro",
      signature: "valid",
    });
    expect(db.state.subscription.plan_id).toBe(PRO.id);
    expect(db.state.subscription.status).toBe("ACTIVE");
    expect(db.state.subscription.order_limit).toBe(3000);
    expect(db.state.subscription.amount_paise).toBe(149900);
    expect(db.state.subscription.trial_end).toBe("2026-10-31T18:30:00.000Z");
  });

  it("8. invalid signature does not activate", async () => {
    const db = createDb({
      subscription: liveSub(),
      payments: [
        {
          id: "p1",
          organization_id: "org-1",
          subscription_id: "sub-1",
          plan_id: PRO.id,
          amount_paise: 149900,
          currency: "INR",
          status: "PENDING",
          billing_cycle: "monthly",
          razorpay_order_id: "order_pro",
          razorpay_payment_id: null,
          payment_purpose: "subscription",
        },
      ],
    });
    await expect(
      verifyCheckout(db.supabase as never, {
        organizationId: "org-1",
        userId: "user-1",
        paymentId: "pay_1",
        razorpayOrderId: "order_pro",
        signature: "invalid",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(db.state.subscription.status).toBe("TRIAL");
    expect(db.state.subscription.plan_id).toBe(BUSINESS.id);
  });

  it("9-10. wrong amount or currency does not activate", async () => {
    const db = createDb({
      subscription: liveSub(),
      payments: [
        {
          id: "p1",
          organization_id: "org-1",
          subscription_id: "sub-1",
          plan_id: PRO.id,
          amount_paise: 149900,
          currency: "INR",
          status: "PENDING",
          billing_cycle: "monthly",
          razorpay_order_id: "order_pro",
          razorpay_payment_id: null,
          payment_purpose: "subscription",
        },
      ],
    });
    razorpayState.payment = { ...razorpayState.payment, amount: 100 };
    await expect(
      verifyCheckout(db.supabase as never, {
        organizationId: "org-1",
        userId: "user-1",
        paymentId: "pay_1",
        razorpayOrderId: "order_pro",
        signature: "valid",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    razorpayState.payment = { ...razorpayState.payment, amount: 149900, currency: "USD" };
    await expect(
      verifyCheckout(db.supabase as never, {
        organizationId: "org-1",
        userId: "user-1",
        paymentId: "pay_1",
        razorpayOrderId: "order_pro",
        signature: "valid",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(db.state.subscription.plan_id).toBe(BUSINESS.id);
    expect(db.state.subscription.status).toBe("TRIAL");
  });

  it("11. another organization's payment cannot activate this workspace", async () => {
    const db = createDb({
      subscription: liveSub(),
      payments: [
        {
          id: "p1",
          organization_id: "org-other",
          subscription_id: "sub-other",
          plan_id: PRO.id,
          amount_paise: 149900,
          currency: "INR",
          status: "PENDING",
          billing_cycle: "monthly",
          razorpay_order_id: "order_pro",
          razorpay_payment_id: null,
          payment_purpose: "subscription",
        },
      ],
    });
    await expect(
      verifyCheckout(db.supabase as never, {
        organizationId: "org-1",
        userId: "user-1",
        paymentId: "pay_1",
        razorpayOrderId: "order_pro",
        signature: "valid",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(db.state.subscription.status).toBe("TRIAL");
  });

  it("12. replaying a captured payment does not activate twice", async () => {
    const db = createDb({
      subscription: liveSub({ status: "ACTIVE", plan_id: PRO.id, amount_paise: 149900, order_limit: 3000 }),
      payments: [
        {
          id: "p1",
          organization_id: "org-1",
          subscription_id: "sub-1",
          plan_id: PRO.id,
          amount_paise: 149900,
          currency: "INR",
          status: "CAPTURED",
          billing_cycle: "monthly",
          razorpay_order_id: "order_pro",
          razorpay_payment_id: "pay_1",
          payment_purpose: "subscription",
        },
      ],
    });
    const result = await fulfillCapturedSubscriptionPurchase(db.supabase as never, {
      razorpayOrderId: "order_pro",
      paymentId: "pay_1",
      amountPaise: 149900,
      currency: "INR",
      organizationId: "org-1",
    });
    expect(result.duplicate).toBe(true);
  });

  it("13. duplicate payment.captured webhook does not grant a second plan", async () => {
    const db = createDb({
      subscription: liveSub(),
      payments: [
        {
          id: "p1",
          organization_id: "org-1",
          subscription_id: "sub-1",
          plan_id: PRO.id,
          amount_paise: 149900,
          currency: "INR",
          status: "PENDING",
          billing_cycle: "monthly",
          razorpay_order_id: "order_pro",
          razorpay_payment_id: null,
          payment_purpose: "subscription",
        },
      ],
    });
    const payload = {
      event: "payment.captured",
      payload: {
        payment: { entity: { id: "pay_1", amount: 149900, currency: "INR", order_id: "order_pro" } },
      },
    };
    await processRazorpayEvent(db.supabase as never, payload, "evt_1");
    await processRazorpayEvent(db.supabase as never, payload, "evt_1");
    expect(db.state.subscription.plan_id).toBe(PRO.id);
    expect(db.state.subscription.status).toBe("ACTIVE");
  });

  it("14-15. older Pro order still activates Pro after a later Business checkout starts", async () => {
    const db = createDb({
      subscription: liveSub(),
      payments: [
        {
          id: "p-old",
          organization_id: "org-1",
          subscription_id: "sub-1",
          plan_id: PRO.id,
          amount_paise: 149900,
          currency: "INR",
          status: "PENDING",
          billing_cycle: "monthly",
          razorpay_order_id: "order_pro",
          razorpay_payment_id: null,
          payment_purpose: "subscription",
        },
        {
          id: "p-new",
          organization_id: "org-1",
          subscription_id: "sub-1",
          plan_id: BUSINESS.id,
          amount_paise: 350000,
          currency: "INR",
          status: "PENDING",
          billing_cycle: "monthly",
          razorpay_order_id: "order_biz",
          razorpay_payment_id: null,
          payment_purpose: "subscription",
        },
      ],
    });
    await fulfillCapturedSubscriptionPurchase(db.supabase as never, {
      razorpayOrderId: "order_pro",
      paymentId: "pay_1",
      amountPaise: 149900,
      currency: "INR",
      organizationId: "org-1",
    });
    expect(db.state.subscription.plan_id).toBe(PRO.id);
    expect(db.state.subscription.amount_paise).toBe(149900);
    expect(db.state.payments.find((row) => row.razorpay_order_id === "order_biz")?.status).toBe("PENDING");
  });

  it("16. trial Resume is rejected and the trial is unchanged", async () => {
    const db = createDb({ subscription: liveSub({ cancel_at_period_end: true }), payments: [] });
    await expect(
      resumeSubscription(db.supabase as never, { organizationId: "org-1", userId: "user-1" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(db.state.subscription.status).toBe("TRIAL");
    expect(db.state.subscription.trial_end).toBe("2026-10-31T18:30:00.000Z");
  });

  it("17. paid cancelled subscription may resume", async () => {
    const db = createDb({
      subscription: liveSub({
        status: "ACTIVE",
        plan_id: PRO.id,
        amount_paise: 149900,
        cancel_at_period_end: true,
        razorpay_subscription_id: "sub_rzp",
      }),
      payments: [
        {
          id: "p1",
          organization_id: "org-1",
          subscription_id: "sub-1",
          plan_id: PRO.id,
          amount_paise: 149900,
          currency: "INR",
          status: "CAPTURED",
          billing_cycle: "monthly",
          razorpay_order_id: "order_paid",
          razorpay_payment_id: "pay_paid",
          payment_purpose: "subscription",
        },
      ],
    });
    const result = await resumeSubscription(db.supabase as never, { organizationId: "org-1", userId: "user-1" });
    expect(result.status).toBe("ACTIVE");
    expect(db.state.subscription.cancel_at_period_end).toBe(false);
  });

  it("18. direct changePlan upgrades are forbidden", async () => {
    const db = createDb({
      subscription: liveSub({ status: "ACTIVE", plan_id: STARTER.id, amount_paise: 49900, order_limit: 500 }),
      payments: [],
    });
    await expect(
      changePlan(db.supabase as never, {
        organizationId: "org-1",
        userId: "user-1",
        planId: PRO.id,
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(db.state.subscription.plan_id).toBe(STARTER.id);
  });

  it("19. scheduled downgrade stays pending and does not grant a higher plan", async () => {
    const db = createDb({
      subscription: liveSub({
        status: "ACTIVE",
        plan_id: BUSINESS.id,
        amount_paise: 350000,
        order_limit: 10000,
      }),
      payments: [],
    });
    const result = await changePlan(db.supabase as never, {
      organizationId: "org-1",
      userId: "user-1",
      planId: STARTER.id,
    });
    expect(result.applied).toBe("period_end");
    expect(db.state.subscription.plan_id).toBe(BUSINESS.id);
    expect(db.state.subscription.pending_plan_id).toBe(STARTER.id);
  });

  it("20. unpaid checkout leaves Business trial entitlements in place", async () => {
    const db = createDb({ subscription: liveSub(), payments: [] });
    await startCheckout(db.supabase as never, { ...owner, planId: PRO.id, billingCycle: "monthly" });
    expect(db.state.subscription.plan_id).toBe(BUSINESS.id);
    expect(db.state.subscription.status).toBe("TRIAL");
    expect(db.state.subscription.order_limit).toBe(10000);
    expect(db.state.subscription.trial_cohort).toBe("legacy_nov1");
    expect(db.usage.orders_used).toBe(4);
  });

  it("11b. duplicate Razorpay order IDs fail closed", async () => {
    const db = createDb({
      subscription: liveSub(),
      payments: [
        {
          id: "dup-1",
          organization_id: "org-1",
          subscription_id: "sub-1",
          plan_id: PRO.id,
          amount_paise: 149900,
          currency: "INR",
          status: "PENDING",
          billing_cycle: "monthly",
          razorpay_order_id: "order_dup",
          razorpay_payment_id: null,
          payment_purpose: "subscription",
        },
        {
          id: "dup-2",
          organization_id: "org-1",
          subscription_id: "sub-1",
          plan_id: BUSINESS.id,
          amount_paise: 350000,
          currency: "INR",
          status: "PENDING",
          billing_cycle: "monthly",
          razorpay_order_id: "order_dup",
          razorpay_payment_id: null,
          payment_purpose: "subscription",
        },
      ],
    });
    const result = await fulfillCapturedSubscriptionPurchase(db.supabase as never, {
      razorpayOrderId: "order_dup",
      paymentId: "pay_dup",
      amountPaise: 149900,
      currency: "INR",
      organizationId: "org-1",
    });
    expect(result.ambiguous).toBe(true);
    expect(db.state.subscription.status).toBe("TRIAL");
    expect(db.state.subscription.plan_id).toBe(BUSINESS.id);
  });

  it("8b. concurrent verification of the same captured payment activates once", async () => {
    const db = createDb({
      subscription: liveSub(),
      payments: [
        {
          id: "p1",
          organization_id: "org-1",
          subscription_id: "sub-1",
          plan_id: PRO.id,
          amount_paise: 149900,
          currency: "INR",
          status: "PENDING",
          billing_cycle: "monthly",
          razorpay_order_id: "order_pro",
          razorpay_payment_id: null,
          payment_purpose: "subscription",
        },
      ],
    });
    const input = {
      razorpayOrderId: "order_pro",
      paymentId: "pay_1",
      amountPaise: 149900,
      currency: "INR",
      organizationId: "org-1",
    };
    const [first, second] = await Promise.all([
      fulfillCapturedSubscriptionPurchase(db.supabase as never, input),
      fulfillCapturedSubscriptionPurchase(db.supabase as never, input),
    ]);
    const outcomes = [first, second];
    expect(outcomes.filter((row) => row.duplicate).length).toBe(1);
    expect(outcomes.filter((row) => row.handled && !row.duplicate && !row.ambiguous).length).toBe(1);
    expect(db.state.payments.filter((row) => row.status === "CAPTURED")).toHaveLength(1);
  });

  it("9b. concurrent captures of two orders serialize and record both payments", async () => {
    const db = createDb({
      subscription: liveSub(),
      payments: [
        {
          id: "p-pro",
          organization_id: "org-1",
          subscription_id: "sub-1",
          plan_id: PRO.id,
          amount_paise: 149900,
          currency: "INR",
          status: "PENDING",
          billing_cycle: "monthly",
          razorpay_order_id: "order_pro",
          razorpay_payment_id: null,
          payment_purpose: "subscription",
        },
        {
          id: "p-biz",
          organization_id: "org-1",
          subscription_id: "sub-1",
          plan_id: BUSINESS.id,
          amount_paise: 350000,
          currency: "INR",
          status: "PENDING",
          billing_cycle: "monthly",
          razorpay_order_id: "order_biz",
          razorpay_payment_id: null,
          payment_purpose: "subscription",
        },
      ],
    });
    await Promise.all([
      fulfillCapturedSubscriptionPurchase(db.supabase as never, {
        razorpayOrderId: "order_pro",
        paymentId: "pay_pro",
        amountPaise: 149900,
        currency: "INR",
        organizationId: "org-1",
      }),
      fulfillCapturedSubscriptionPurchase(db.supabase as never, {
        razorpayOrderId: "order_biz",
        paymentId: "pay_biz",
        amountPaise: 350000,
        currency: "INR",
        organizationId: "org-1",
      }),
    ]);
    expect(db.state.payments.every((row) => row.status === "CAPTURED")).toBe(true);
    expect(["plan-pro", "plan-business"]).toContain(db.state.subscription.plan_id);
    expect(db.state.subscription.status).toBe("ACTIVE");
    expect(db.usage.orders_used).toBe(4);
  });

  it("16b. razorpay_subscription_id without a captured payment cannot resume a trial-adjacent ACTIVE grant", async () => {
    const db = createDb({
      subscription: liveSub({
        status: "ACTIVE",
        razorpay_subscription_id: "sub_rzp",
        cancel_at_period_end: true,
      }),
      payments: [],
    });
    await expect(
      resumeSubscription(db.supabase as never, { organizationId: "org-1", userId: "user-1" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(db.state.subscription.cancel_at_period_end).toBe(true);
  });

  it("17b. expired trial rows are not live and cannot be resumed", async () => {
    const db = createDb({
      subscription: liveSub({
        status: "EXPIRED",
        current_period_end: "2026-10-20T00:00:00.000Z",
        trial_end: "2026-10-20T00:00:00.000Z",
      }),
      payments: [],
    });
    await expect(
      resumeSubscription(db.supabase as never, { organizationId: "org-1", userId: "user-1" })
    ).rejects.toMatchObject({ code: "RESOURCE_NOT_FOUND" });
  });

  it("21. missing purchase RPC does not mutate the live plan", async () => {
    const db = createDb({
      subscription: liveSub(),
      rpcMissing: true,
      payments: [
        {
          id: "p1",
          organization_id: "org-1",
          subscription_id: "sub-1",
          plan_id: PRO.id,
          amount_paise: 149900,
          currency: "INR",
          status: "PENDING",
          billing_cycle: "monthly",
          razorpay_order_id: "order_pro",
          razorpay_payment_id: null,
          payment_purpose: "subscription",
        },
      ],
    });
    await expect(
      fulfillCapturedSubscriptionPurchase(db.supabase as never, {
        razorpayOrderId: "order_pro",
        paymentId: "pay_1",
        amountPaise: 149900,
        currency: "INR",
        organizationId: "org-1",
      })
    ).rejects.toMatchObject({ code: "INTEGRATION_NOT_CONNECTED" });
    expect(db.state.subscription.status).toBe("TRIAL");
    expect(db.state.subscription.plan_id).toBe(BUSINESS.id);
  });

  function pendingPay(overrides: Partial<Payment> = {}): Payment {
    return {
      id: "p1",
      organization_id: "org-1",
      subscription_id: "sub-1",
      plan_id: PRO.id,
      amount_paise: 149900,
      currency: "INR",
      status: "PENDING",
      billing_cycle: "monthly",
      razorpay_order_id: "order_pro",
      razorpay_payment_id: null,
      payment_purpose: "subscription",
      ...overrides,
    };
  }

  function expiredTrial(overrides: Record<string, unknown> = {}) {
    return liveSub({
      status: "EXPIRED",
      current_period_end: "2026-10-31T18:30:00.000Z",
      trial_end: "2026-10-31T18:30:00.000Z",
      expires_at: "2026-10-31T18:30:00.000Z",
      ...overrides,
    });
  }

  const verifyPro = {
    organizationId: "org-1",
    userId: "user-1",
    paymentId: "pay_1",
    razorpayOrderId: "order_pro",
    signature: "valid",
  };

  it("expired 1. TRIAL captured payment becomes ACTIVE", async () => {
    const db = createDb({ subscription: liveSub(), payments: [pendingPay()] });
    await verifyCheckout(db.supabase as never, verifyPro);
    expect(db.state.subscription.status).toBe("ACTIVE");
    expect(db.state.subscription.plan_id).toBe(PRO.id);
    expect(db.state.subscription.trial_cohort).toBe("legacy_nov1");
  });

  it("expired 2. EXPIRED trial captured payment becomes ACTIVE", async () => {
    const db = createDb({ subscription: expiredTrial(), payments: [pendingPay()] });
    await verifyCheckout(db.supabase as never, verifyPro);
    expect(db.state.subscription.status).toBe("ACTIVE");
    expect(db.state.subscription.plan_id).toBe(PRO.id);
    expect(db.state.subscription.amount_paise).toBe(149900);
    expect(db.state.subscription.order_limit).toBe(3000);
    expect(db.state.subscription.trial_end).toBe("2026-10-31T18:30:00.000Z");
    expect(db.state.payments).toHaveLength(1);
  });

  it("expired 3. EXPIRED cancelled checkout stays EXPIRED", async () => {
    const db = createDb({ subscription: expiredTrial(), payments: [] });
    const before = effectiveOf(db.state.subscription);
    await startCheckout(db.supabase as never, { ...owner, planId: PRO.id, billingCycle: "monthly" });
    expect(effectiveOf(db.state.subscription)).toEqual(before);
    expect(db.state.payments[0]?.status).toBe("PENDING");
    expect(db.state.payments[0]?.subscription_id).toBe("sub-1");
  });

  it("expired 4-6. EXPIRED failed, authorized, or invalid signature stay EXPIRED", async () => {
    const db = createDb({ subscription: expiredTrial(), payments: [pendingPay()] });
    const before = effectiveOf(db.state.subscription);
    for (const status of ["failed", "authorized"]) {
      razorpayState.payment = { ...razorpayState.payment, status };
      await expect(verifyCheckout(db.supabase as never, verifyPro)).rejects.toBeInstanceOf(AppError);
      expect(effectiveOf(db.state.subscription)).toEqual(before);
    }
    razorpayState.payment = { ...razorpayState.payment, status: "captured" };
    await expect(
      verifyCheckout(db.supabase as never, { ...verifyPro, signature: "nope" })
    ).rejects.toBeInstanceOf(AppError);
    expect(effectiveOf(db.state.subscription)).toEqual(before);
  });

  it("expired 7-8. EXPIRED wrong amount or organization stay EXPIRED", async () => {
    const db = createDb({
      subscription: expiredTrial(),
      payments: [pendingPay({ amount_paise: 149900 })],
    });
    const before = effectiveOf(db.state.subscription);
    razorpayState.payment = { ...razorpayState.payment, amount: 100 };
    await expect(verifyCheckout(db.supabase as never, verifyPro)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(effectiveOf(db.state.subscription)).toEqual(before);
    razorpayState.payment = { ...razorpayState.payment, amount: 149900 };
    await expect(
      verifyCheckout(db.supabase as never, { ...verifyPro, organizationId: "org-other" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(effectiveOf(db.state.subscription)).toEqual(before);
    expect(db.state.subscription.id).toBe("sub-1");
  });

  it("expired 9-10. EXPIRED duplicate webhook and concurrent capture activate once", async () => {
    const db = createDb({ subscription: expiredTrial(), payments: [pendingPay()] });
    const payload = {
      event: "payment.captured",
      payload: {
        payment: {
          entity: {
            id: "pay_1",
            amount: 149900,
            currency: "INR",
            order_id: "order_pro",
            status: "captured",
          },
        },
      },
    };
    await processRazorpayEvent(db.supabase as never, payload, "evt_1");
    await processRazorpayEvent(db.supabase as never, payload, "evt_1");
    expect(db.state.subscription.status).toBe("ACTIVE");
    expect(db.state.payments.filter((row) => row.status === "CAPTURED")).toHaveLength(1);
    const db2 = createDb({ subscription: expiredTrial(), payments: [pendingPay()] });
    const input = {
      razorpayOrderId: "order_pro",
      paymentId: "pay_1",
      amountPaise: 149900,
      currency: "INR",
      organizationId: "org-1",
    };
    const [first, second] = await Promise.all([
      fulfillCapturedSubscriptionPurchase(db2.supabase as never, input),
      fulfillCapturedSubscriptionPurchase(db2.supabase as never, input),
    ]);
    expect([first, second].filter((row) => row.duplicate)).toHaveLength(1);
    expect(db2.state.payments.filter((row) => row.status === "CAPTURED")).toHaveLength(1);
  });

  it("expired 11. EXPIRED purchase with null subscription_id still activates the org row", async () => {
    const db = createDb({
      subscription: expiredTrial(),
      payments: [pendingPay({ subscription_id: null })],
    });
    await fulfillCapturedSubscriptionPurchase(db.supabase as never, {
      razorpayOrderId: "order_pro",
      paymentId: "pay_1",
      amountPaise: 149900,
      currency: "INR",
      organizationId: "org-1",
    });
    expect(db.state.subscription.status).toBe("ACTIVE");
    expect(db.state.subscription.id).toBe("sub-1");
    expect(db.state.payments[0]?.subscription_id).toBe("sub-1");
  });

  it("expired 12. ACTIVE paid Starter captured upgrade becomes Pro once", async () => {
    const db = createDb({
      subscription: liveSub({
        status: "ACTIVE",
        plan_id: STARTER.id,
        amount_paise: 49900,
        order_limit: 500,
        trial_end: "2026-10-03T00:00:00.000Z",
      }),
      payments: [pendingPay()],
    });
    await verifyCheckout(db.supabase as never, verifyPro);
    expect(db.state.subscription.status).toBe("ACTIVE");
    expect(db.state.subscription.plan_id).toBe(PRO.id);
    expect(db.state.subscription.order_limit).toBe(3000);
    expect(db.state.payments).toHaveLength(1);
  });

  it("expired 13-14. rolling and Nov 1 EXPIRED trials purchase successfully", async () => {
    const rolling = createDb({
      subscription: expiredTrial({
        trial_cohort: "rolling_7d",
        trial_end: "2026-11-03T00:00:00.000Z",
        current_period_end: "2026-11-03T00:00:00.000Z",
        created_at: "2026-10-27T00:00:00.000Z",
      }),
      payments: [pendingPay()],
    });
    await verifyCheckout(rolling.supabase as never, verifyPro);
    expect(rolling.state.subscription.status).toBe("ACTIVE");
    expect(rolling.state.subscription.trial_cohort).toBe("rolling_7d");
    const legacy = createDb({
      subscription: expiredTrial({ trial_cohort: "legacy_nov1" }),
      payments: [pendingPay()],
    });
    await verifyCheckout(legacy.supabase as never, verifyPro);
    expect(legacy.state.subscription.status).toBe("ACTIVE");
    expect(legacy.state.subscription.trial_cohort).toBe("legacy_nov1");
  });

  it("expired 17-18. transient RPC failure leaves PENDING then retry activates", async () => {
    const db = createDb({
      subscription: expiredTrial(),
      payments: [pendingPay()],
      rpcFailOnce: true,
    });
    await expect(
      fulfillCapturedSubscriptionPurchase(db.supabase as never, {
        razorpayOrderId: "order_pro",
        paymentId: "pay_1",
        amountPaise: 149900,
        currency: "INR",
        organizationId: "org-1",
      })
    ).rejects.toMatchObject({ code: "PROVIDER_ERROR" });
    expect(db.state.subscription.status).toBe("EXPIRED");
    expect(db.state.payments[0]?.status).toBe("PENDING");
    await fulfillCapturedSubscriptionPurchase(db.supabase as never, {
      razorpayOrderId: "order_pro",
      paymentId: "pay_1",
      amountPaise: 149900,
      currency: "INR",
      organizationId: "org-1",
    });
    expect(db.state.subscription.status).toBe("ACTIVE");
    expect(db.state.payments[0]?.status).toBe("CAPTURED");
  });

  it("expired 19-20. unmatched Orders webhook and duplicate order fail closed", async () => {
    const unmatched = createDb({ subscription: expiredTrial(), payments: [] });
    const result = await processRazorpayEvent(
      unmatched.supabase as never,
      {
        event: "payment.captured",
        payload: {
          payment: { entity: { id: "pay_x", amount: 149900, order_id: "order_missing", status: "captured" } },
        },
      },
      "evt_miss"
    );
    expect(result).toEqual({ ignored: true });
    expect(unmatched.state.subscription.status).toBe("EXPIRED");
    const dup = createDb({
      subscription: expiredTrial(),
      payments: [pendingPay({ id: "a" }), pendingPay({ id: "b", plan_id: BUSINESS.id, amount_paise: 350000 })],
    });
    const closed = await fulfillCapturedSubscriptionPurchase(dup.supabase as never, {
      razorpayOrderId: "order_pro",
      paymentId: "pay_1",
      amountPaise: 149900,
      currency: "INR",
      organizationId: "org-1",
    });
    expect(closed.ambiguous).toBe(true);
    expect(dup.state.subscription.status).toBe("EXPIRED");
  });

  it("expired 4b-5. EXPIRED captured Starter and Business activate the purchased plan", async () => {
    const starter = createDb({
      subscription: expiredTrial(),
      payments: [pendingPay({ plan_id: STARTER.id, amount_paise: 49900 })],
    });
    razorpayState.payment = { ...razorpayState.payment, amount: 49900 };
    await verifyCheckout(starter.supabase as never, verifyPro);
    expect(starter.state.subscription.plan_id).toBe(STARTER.id);
    expect(starter.state.subscription.order_limit).toBe(500);
    razorpayState.payment = { ...razorpayState.payment, amount: 350000 };
    const business = createDb({
      subscription: expiredTrial(),
      payments: [pendingPay({ plan_id: BUSINESS.id, amount_paise: 350000 })],
    });
    await verifyCheckout(business.supabase as never, verifyPro);
    expect(business.state.subscription.plan_id).toBe(BUSINESS.id);
    expect(business.state.subscription.order_limit).toBe(10000);
  });

  it("expired 16-17. foreign or missing subscription_id does not fall back", async () => {
    const foreign = createDb({
      subscription: expiredTrial(),
      extraSubscriptions: [liveSub({ id: "sub-other", organization_id: "org-2", status: "EXPIRED" })],
      payments: [pendingPay({ subscription_id: "sub-other" })],
    });
    const blocked = await fulfillCapturedSubscriptionPurchase(foreign.supabase as never, {
      razorpayOrderId: "order_pro",
      paymentId: "pay_1",
      amountPaise: 149900,
      currency: "INR",
      organizationId: "org-1",
    });
    expect(blocked.forbidden).toBe(true);
    expect(foreign.state.subscription.status).toBe("EXPIRED");
    const missing = createDb({
      subscription: expiredTrial(),
      payments: [pendingPay({ subscription_id: "sub-missing" })],
    });
    const broken = await fulfillCapturedSubscriptionPurchase(missing.supabase as never, {
      razorpayOrderId: "order_pro",
      paymentId: "pay_1",
      amountPaise: 149900,
      currency: "INR",
      organizationId: "org-1",
    });
    expect(broken.integrityError).toBe(true);
    expect(missing.state.subscription.status).toBe("EXPIRED");
    expect(missing.state.payments[0]?.status).toBe("PENDING");
  });

  it("expired 18. null subscription_id prefers the live org row over an older cancelled row", async () => {
    const db = createDb({
      subscription: expiredTrial({ created_at: "2026-10-01T00:00:00.000Z" }),
      extraSubscriptions: [
        liveSub({
          id: "sub-old",
          status: "CANCELLED",
          created_at: "2026-09-01T00:00:00.000Z",
          plan_id: STARTER.id,
        }),
      ],
      payments: [pendingPay({ subscription_id: null })],
    });
    await fulfillCapturedSubscriptionPurchase(db.supabase as never, {
      razorpayOrderId: "order_pro",
      paymentId: "pay_1",
      amountPaise: 149900,
      currency: "INR",
      organizationId: "org-1",
    });
    expect(db.state.subscription.id).toBe("sub-1");
    expect(db.state.subscription.status).toBe("ACTIVE");
    expect(db.state.extraSubscriptions?.[0]?.status).toBe("CANCELLED");
  });

  it("expired 21-24. expiry blocks booking, paid restore, usage consistent, starter stays one row", async () => {
    const db = createDb({ subscription: expiredTrial(), payments: [pendingPay()] });
    await expect(checkQuota(db.supabase as never, "org-1", 1)).rejects.toMatchObject({
      message: SUBSCRIPTION_INACTIVE_MESSAGE,
    });
    await verifyCheckout(db.supabase as never, verifyPro);
    await expect(checkQuota(db.supabase as never, "org-1", 1)).resolves.toMatchObject({
      bookable: true,
      status: "ACTIVE",
    });
    expect(db.usage.orders_used).toBe(4);
    expect(db.usage.order_limit).toBe(3000);
    expect(db.state.subscription.id).toBe("sub-1");
    expect(db.state.payments).toHaveLength(1);
  });
});

