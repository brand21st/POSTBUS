import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  isUniqueViolation,
  processRazorpayEvent,
  razorpayWebhookEventId,
} from "@/modules/billing/webhooks";

type PaymentRow = { razorpay_payment_id: string; status: string };

function fakeSupabase(state: {
  subscription: Record<string, unknown> | null;
  payments: PaymentRow[];
}) {
  return {
    from(table: string) {
      const filters: Record<string, unknown> = {};
      const query = {
        select() {
          return query;
        },
        eq(column: string, value: unknown) {
          filters[column] = value;
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
        insert: async (row: PaymentRow) => {
          if (table === "payments") {
            if (state.payments.some((existing) => existing.razorpay_payment_id === row.razorpay_payment_id)) {
              return { error: { code: "23505" } };
            }
            state.payments.push(row);
          }
          return { error: null };
        },
        update() {
          return query;
        },
      };
      return query;
    },
  } as unknown as SupabaseClient;
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
      subscription: {
        id: "sub-local",
        organization_id: "org-1",
        plan_id: "plan-1",
        billing_cycle: "monthly",
        amount_paise: 49900,
        status: "ACTIVE",
        razorpay_subscription_id: "sub_rzp",
        current_period_end: new Date(Date.now() + 86400000).toISOString(),
        cancel_at_period_end: false,
      },
      payments: [] as PaymentRow[],
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
});
