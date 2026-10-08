import { describe, expect, it } from "vitest";
import {
  consumeAiCredit,
  fulfillCapturedAiCreditPayment,
  shouldGrantAiCredits,
  type AiCreditsDb,
} from "@/modules/ai-credits/service";

function createStore(initialBalance = 500) {
  const state = {
    balance: initialBalance,
    payments: [] as Array<Record<string, unknown>>,
  };

  const db: AiCreditsDb = {
    from(table: string) {
      return {
        select() {
          return {
            eq(_column: string, value: string) {
              return {
                async maybeSingle() {
                  if (table === "organizations") {
                    return { data: { ai_credits_balance: state.balance } };
                  }
                  const payment = state.payments.find((row) => row.razorpay_order_id === value) ?? null;
                  return { data: payment };
                },
              };
            },
          };
        },
        update(patch: Record<string, unknown>) {
          return {
            eq(_column: string, id: string) {
              return {
                neq(_statusColumn: string, status: string) {
                  return {
                    select() {
                      return {
                        async maybeSingle() {
                          const payment = state.payments.find((row) => row.id === id);
                          if (!payment || payment.status === status) return { data: null };
                          Object.assign(payment, patch);
                          return { data: { id: payment.id } };
                        },
                      };
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
    async rpc(name, args) {
      if (name === "consume_ai_credit") {
        if (state.balance <= 0) return { data: 0 };
        state.balance -= 1;
        return { data: state.balance };
      }
      if (name === "grant_ai_credits") {
        state.balance += Number(args.p_amount ?? 0);
        return { data: state.balance };
      }
      return { data: state.balance };
    },
  };

  return { state, db };
}

describe("AI credits consume and recharge", () => {
  it("starts at 500, consumes to 0, and cannot go negative", async () => {
    const { state, db } = createStore(500);
    expect(await consumeAiCredit(db, "org-1")).toBe(499);
    state.balance = 1;
    expect(await consumeAiCredit(db, "org-1")).toBe(0);
    expect(await consumeAiCredit(db, "org-1")).toBe(0);
    expect(state.balance).toBe(0);
  });

  it("grants a pack once when a pending ai_credits payment is captured", async () => {
    const { state, db } = createStore(0);
    state.payments.push({
      id: "pay-1",
      status: "PENDING",
      organization_id: "org-1",
      billing_cycle: "ai_credits",
      ai_credit_pack_size: 500,
      amount_paise: 9900,
      razorpay_order_id: "order_1",
    });

    const first = await fulfillCapturedAiCreditPayment(db, {
      razorpayOrderId: "order_1",
      razorpayPaymentId: "pay_rzp",
      amountPaise: 9900,
    });
    expect(first.handled).toBe(true);
    expect(first.granted).toBe(true);
    expect(first.remaining).toBe(500);
    expect(state.balance).toBe(500);

    const second = await fulfillCapturedAiCreditPayment(db, {
      razorpayOrderId: "order_1",
      razorpayPaymentId: "pay_rzp",
      amountPaise: 9900,
    });
    expect(second.handled).toBe(true);
    expect(second.granted).toBe(false);
    expect(state.balance).toBe(500);
  });

  it("does not grant subscription payments as AI credits", () => {
    expect(shouldGrantAiCredits("PENDING", "monthly")).toBe(false);
    expect(shouldGrantAiCredits("CAPTURED", "ai_credits")).toBe(false);
    expect(shouldGrantAiCredits("PENDING", "ai_credits")).toBe(true);
  });
});
