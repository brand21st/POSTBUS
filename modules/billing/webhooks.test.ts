import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  isUniqueViolation,
  processRazorpayEvent,
  razorpayWebhookEventId,
} from "@/modules/billing/webhooks";
import { periodsMatch } from "@/modules/billing/subscriptions";

type PaymentRow = { razorpay_payment_id: string; status: string };

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
            return { data: null };
          }
          if (table === "payments") {
            const found = state.payments.find((row) => row.razorpay_payment_id === filters.razorpay_payment_id);
            return { data: found ? { id: found.razorpay_payment_id } : null };
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
});
