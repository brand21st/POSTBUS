import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  classifyPlatformRazorpayPayment,
  isUniqueViolation,
  processRazorpayEvent,
  razorpayWebhookEventId,
} from "@/modules/billing/webhooks";
import { periodsMatch } from "@/modules/billing/subscriptions";

type PaymentRow = {
  razorpay_payment_id?: string;
  razorpay_order_id?: string;
  billing_cycle?: string;
  status: string;
};

const PERIOD_START = 1_700_000_000;
const PERIOD_END = 1_702_592_000;

function fakeSupabase(state: {
  subscription: Record<string, unknown> | null;
  payments: PaymentRow[];
  activations: number;
}) {
  return {
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
        not() {
          return query;
        },
        order() {
          return query;
        },
        limit() {
          return query;
        },
        maybeSingle: async () => {
          if (table === "subscriptions") {
            if (filters.razorpay_subscription_id === state.subscription?.razorpay_subscription_id) {
              return { data: state.subscription };
            }
            if (
              filters.razorpay_order_id &&
              filters.razorpay_order_id === state.subscription?.razorpay_order_id
            ) {
              return { data: state.subscription };
            }
            return { data: null };
          }
          if (table === "payments") {
            const found = state.payments.find((row) => {
              if (filters.razorpay_payment_id) {
                return row.razorpay_payment_id === filters.razorpay_payment_id;
              }
              if (filters.razorpay_order_id) {
                return row.razorpay_order_id === filters.razorpay_order_id;
              }
              return false;
            });
            return {
              data: found
                ? {
                    id: found.razorpay_payment_id ?? found.razorpay_order_id,
                    billing_cycle: found.billing_cycle ?? null,
                    razorpay_payment_id: found.razorpay_payment_id ?? null,
                    razorpay_order_id: found.razorpay_order_id ?? null,
                  }
                : null,
            };
          }
          return { data: null };
        },
        insert: async (row: PaymentRow | Record<string, unknown>) => {
          if (table === "payments" && "razorpay_payment_id" in row) {
            if (state.payments.some((existing) => existing.razorpay_payment_id === row.razorpay_payment_id)) {
              return { error: { code: "23505" } };
            }
            state.payments.push(row as PaymentRow);
          }
          return { error: null };
        },
        update(row: Record<string, unknown>) {
          return {
            eq(column: string, value: unknown) {
              if (table === "subscriptions" && state.subscription && (column === "id" || column === "razorpay_subscription_id")) {
                if (column === "id" && state.subscription.id !== value) return { error: null };
                Object.assign(state.subscription, row);
                if (row.current_period_start) state.activations += 1;
              }
              if (table === "payments") {
                const found = state.payments.find((item) => item.razorpay_payment_id === value);
                if (found && row.status) found.status = String(row.status);
              }
              return { error: null };
            },
          };
        },
        upsert: async () => ({ error: null }),
      };
      return query;
    },
  } as unknown as SupabaseClient;
}

function liveSubscription(overrides: Record<string, unknown> = {}) {
  return {
    id: "sub-local",
    organization_id: "org-1",
    plan_id: "plan-1",
    billing_cycle: "monthly",
    amount_paise: 49900,
    status: "ACTIVE",
    razorpay_subscription_id: "sub_rzp",
    current_period_start: null,
    current_period_end: new Date(Date.now() + 86400000).toISOString(),
    cancel_at_period_end: false,
    pending_plan_id: null,
    started_at: null,
    order_limit: 100,
    ...overrides,
  };
}

describe("razorpay webhook idempotency", () => {
  it("prefers the Razorpay event header and flags unique violations", () => {
    expect(razorpayWebhookEventId("evt_1", "payment.captured", "{}")).toBe("evt_1");
    expect(razorpayWebhookEventId("", "payment.captured", "{}").startsWith("payment.captured:")).toBe(true);
    expect(isUniqueViolation({ code: "23505" })).toBe(true);
    expect(isUniqueViolation({ code: "23503" })).toBe(false);
  });

  it("does not activate an Orders capture that has no unique purchase intent", async () => {
    const state = {
      subscription: liveSubscription({
        status: "TRIAL",
        razorpay_subscription_id: null,
        razorpay_order_id: "order_pay",
      }),
      payments: [] as PaymentRow[],
      activations: 0,
    };
    const result = await processRazorpayEvent(
      fakeSupabase(state),
      {
        event: "payment.captured",
        payload: {
          payment: { entity: { id: "pay_order", amount: 49900, order_id: "order_pay" } },
        },
      },
      "evt_order"
    );
    expect(result).toEqual({ ignored: true });
    expect(state.subscription?.status).toBe("TRIAL");
    expect(state.activations).toBe(0);
    expect(state.payments).toHaveLength(0);
  });

  it("does not insert a second payment for the same Razorpay payment id", async () => {
    const state = {
      subscription: liveSubscription(),
      payments: [] as PaymentRow[],
      activations: 0,
    };
    const payload = {
      event: "payment.captured",
      payload: {
        subscription: { entity: { id: "sub_rzp" } },
        payment: { entity: { id: "pay_1", amount: 49900, order_id: "order_1" } },
      },
    };
    await processRazorpayEvent(fakeSupabase(state), payload, "evt_1");
    await processRazorpayEvent(fakeSupabase(state), payload, "evt_1");
    expect(state.payments).toHaveLength(1);
    expect(state.payments[0]?.razorpay_payment_id).toBe("pay_1");
    expect(state.payments[0]?.status).toBe("CAPTURED");
  });

  it("extends the billing period on subscription.charged", async () => {
    const state = {
      subscription: liveSubscription({ current_period_start: null, current_period_end: null }),
      payments: [] as PaymentRow[],
      activations: 0,
    };
    const payload = {
      event: "subscription.charged",
      payload: {
        subscription: { entity: { id: "sub_rzp", current_start: PERIOD_START, current_end: PERIOD_END } },
        payment: { entity: { id: "pay_cycle", amount: 49900 } },
      },
    };
    await processRazorpayEvent(fakeSupabase(state), payload, "evt_charged");
    expect(state.subscription?.status).toBe("ACTIVE");
    expect(state.subscription?.current_period_start).toBe(new Date(PERIOD_START * 1000).toISOString());
    expect(state.subscription?.current_period_end).toBe(new Date(PERIOD_END * 1000).toISOString());
    expect(state.payments[0]?.razorpay_payment_id).toBe("pay_cycle");
  });

  it("does not extend the period twice when invoice.paid follows subscription.charged", async () => {
    const start = new Date(PERIOD_START * 1000).toISOString();
    const end = new Date(PERIOD_END * 1000).toISOString();
    const state = {
      subscription: liveSubscription({
        current_period_start: start,
        current_period_end: end,
        renews_at: end,
      }),
      payments: [] as PaymentRow[],
      activations: 0,
    };
    const payload = {
      event: "invoice.paid",
      payload: {
        subscription: { entity: { id: "sub_rzp", current_start: PERIOD_START, current_end: PERIOD_END } },
        invoice: { entity: { id: "inv_1", subscription_id: "sub_rzp", payment_id: "pay_2", amount: 49900 } },
        payment: { entity: { id: "pay_2", amount: 49900 } },
      },
    };
    expect(periodsMatch(state.subscription as never, new Date(PERIOD_START * 1000), new Date(PERIOD_END * 1000))).toBe(true);
    await processRazorpayEvent(fakeSupabase(state), payload, "evt_invoice");
    expect(state.activations).toBe(0);
    expect(state.subscription?.current_period_start).toBe(start);
  });

  it("ignores subscription events that do not match a local subscription", async () => {
    const state = {
      subscription: liveSubscription(),
      payments: [] as PaymentRow[],
      activations: 0,
    };
    const result = await processRazorpayEvent(
      fakeSupabase(state),
      {
        event: "subscription.charged",
        payload: { subscription: { entity: { id: "sub_unknown", current_start: PERIOD_START, current_end: PERIOD_END } } },
      },
      "evt_miss"
    );
    expect(result).toEqual({ ignored: true });
    expect(state.activations).toBe(0);
  });

  it("classifies AI credit, subscription, and unmatched platform payments", async () => {
    const state = {
      subscription: liveSubscription({ razorpay_order_id: "order_sub" }),
      payments: [
        { razorpay_order_id: "order_ai", billing_cycle: "ai_credits", status: "PENDING" },
      ] as PaymentRow[],
      activations: 0,
    };
    const db = fakeSupabase(state);
    expect(
      await classifyPlatformRazorpayPayment(db, { razorpayOrderId: "order_ai", subscriptionMatched: false })
    ).toBe("AI_CREDITS");
    expect(
      await classifyPlatformRazorpayPayment(db, { razorpayOrderId: "order_sub", subscriptionMatched: true })
    ).toBe("SUBSCRIPTION");
    expect(
      await classifyPlatformRazorpayPayment(db, { razorpayOrderId: "order_unknown", subscriptionMatched: false })
    ).toBe("UNMATCHED_PLATFORM");
  });

  it("ignores payment.captured when the paid amount does not match the subscription", async () => {
    const state = {
      subscription: liveSubscription({
        status: "TRIAL",
        razorpay_subscription_id: null,
        razorpay_order_id: "order_pay",
        amount_paise: 49900,
      }),
      payments: [] as PaymentRow[],
      activations: 0,
    };
    const result = await processRazorpayEvent(
      fakeSupabase(state),
      {
        event: "payment.captured",
        payload: {
          payment: { entity: { id: "pay_wrong", amount: 100, order_id: "order_pay" } },
        },
      },
      "evt_mismatch"
    );
    expect(result).toEqual({ ignored: true });
    expect(state.activations).toBe(0);
    expect(state.subscription?.status).toBe("TRIAL");
  });

  it("ignores payment.captured for an unknown Razorpay order", async () => {
    const state = {
      subscription: liveSubscription(),
      payments: [] as PaymentRow[],
      activations: 0,
    };
    const result = await processRazorpayEvent(
      fakeSupabase(state),
      {
        event: "payment.captured",
        payload: {
          payment: { entity: { id: "pay_unknown", amount: 100, order_id: "order_unknown" } },
        },
      },
      "evt_unmatched"
    );
    expect(result).toEqual({ ignored: true });
    expect(state.activations).toBe(0);
    expect(state.payments).toHaveLength(0);
    expect(state.subscription?.status).toBe("ACTIVE");
  });

  it("ignores refund.processed when the payment id is not a platform payment", async () => {
    const state = {
      subscription: liveSubscription(),
      payments: [{ razorpay_payment_id: "pay_known", status: "CAPTURED" }] as PaymentRow[],
      activations: 0,
    };
    const result = await processRazorpayEvent(
      fakeSupabase(state),
      {
        event: "refund.processed",
        payload: { refund: { entity: { payment_id: "pay_missing" } } },
      },
      "evt_refund_miss"
    );
    expect(result).toEqual({ ignored: true });
    expect(state.payments[0]?.status).toBe("CAPTURED");
  });

  it("marks a matching platform payment refunded", async () => {
    const state = {
      subscription: liveSubscription(),
      payments: [{ razorpay_payment_id: "pay_known", status: "CAPTURED" }] as PaymentRow[],
      activations: 0,
    };
    const result = await processRazorpayEvent(
      fakeSupabase(state),
      {
        event: "refund.processed",
        payload: { refund: { entity: { payment_id: "pay_known" } } },
      },
      "evt_refund"
    );
    expect(result).toEqual({ processed: true });
    expect(state.payments[0]?.status).toBe("REFUNDED");
  });
});
