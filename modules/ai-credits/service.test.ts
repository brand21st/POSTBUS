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
    used: 0,
    purchased: 0,
    payments: [] as Array<Record<string, unknown>>,
    ledger: [] as Array<Record<string, unknown>>,
    consumeKeys: new Set<string>(),
  };

  const db = {
    from(table: string) {
      return {
        select() {
          return {
            eq(_column: string, value: string) {
              return {
                async maybeSingle() {
                  if (table === "organizations") {
                    return {
                      data: {
                        ai_credits_balance: state.balance,
                        ai_credits_purchased: state.purchased,
                        ai_credits_used: state.used,
                      },
                    };
                  }
                  const payment = state.payments.find((row) => row.razorpay_order_id === value) ?? null;
                  return { data: payment };
                },
                order() {
                  return {
                    limit: async () => ({
                      data:
                        table === "ai_credit_ledger"
                          ? state.ledger.filter((row) => row.organization_id === value)
                          : [],
                    }),
                  };
                },
              };
            },
          };
        },
        async insert(row: Record<string, unknown>) {
          if (table === "ai_credit_ledger") {
            if (row.organization_id !== "org-1") {
              return { error: { message: "org isolation" } };
            }
            state.ledger.push(row);
          }
          return { error: null };
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
        const key = args.p_idempotency_key ? String(args.p_idempotency_key) : "";
        if (key && state.consumeKeys.has(key)) {
          return { data: { remaining: state.balance, consumed: false, duplicate: true } };
        }
        if (state.balance <= 0) return { data: { remaining: 0, consumed: false, duplicate: false } };
        state.balance -= 1;
        state.used += 1;
        if (key) state.consumeKeys.add(key);
        return { data: { remaining: state.balance, consumed: true, duplicate: false } };
      }
      if (name === "fulfill_ai_credit_purchase") {
        const payment = state.payments.find((row) => row.razorpay_order_id === args.p_razorpay_order_id);
        if (!payment || payment.billing_cycle !== "ai_credits") {
          return { data: { handled: false, granted: false, remaining: null } };
        }
        if (args.p_expected_organization_id && payment.organization_id !== args.p_expected_organization_id) {
          return { data: { handled: true, granted: false, forbidden: true, remaining: null } };
        }
        if (args.p_amount_paise != null && Number(payment.amount_paise) !== Number(args.p_amount_paise)) {
          return { data: { handled: true, granted: false, amountMismatch: true, remaining: null } };
        }
        if (payment.status === "CAPTURED") {
          return { data: { handled: true, granted: false, remaining: state.balance } };
        }
        payment.status = "CAPTURED";
        const qty = Number(payment.ai_credit_pack_size ?? 0);
        state.balance += qty;
        state.purchased += qty;
        return {
          data: {
            handled: true,
            granted: true,
            remaining: state.balance,
            organizationId: payment.organization_id,
            credits: qty,
          },
        };
      }
      if (name === "grant_ai_credits") {
        state.balance += Number(args.p_amount ?? 0);
        return { data: state.balance };
      }
      return { data: state.balance };
    },
  };

  return { state, db: db as unknown as AiCreditsDb };
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

  it("does not deduct twice for the same idempotency key", async () => {
    const { db } = createStore(10);
    expect(await consumeAiCredit(db, "org-1", { idempotencyKey: "11111111-1111-4111-8111-111111111111" })).toBe(9);
    expect(await consumeAiCredit(db, "org-1", { idempotencyKey: "11111111-1111-4111-8111-111111111111" })).toBe(9);
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

  it("rejects fulfillment for another organization", async () => {
    const { db, state } = createStore(0);
    state.payments.push({
      id: "pay-2",
      status: "PENDING",
      organization_id: "org-1",
      billing_cycle: "ai_credits",
      ai_credit_pack_size: 500,
      amount_paise: 9900,
      razorpay_order_id: "order_2",
    });
    const result = await fulfillCapturedAiCreditPayment(db, {
      razorpayOrderId: "order_2",
      amountPaise: 9900,
      organizationId: "org-other",
    });
    expect(result.forbidden).toBe(true);
    expect(result.granted).toBe(false);
    expect(state.balance).toBe(0);
  });

  it("does not grant subscription payments as AI credits", () => {
    expect(shouldGrantAiCredits("PENDING", "monthly")).toBe(false);
    expect(shouldGrantAiCredits("CAPTURED", "ai_credits")).toBe(false);
    expect(shouldGrantAiCredits("PENDING", "ai_credits")).toBe(true);
  });
});
