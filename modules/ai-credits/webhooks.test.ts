import { createHmac } from "crypto";
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { processRazorpayEvent } from "@/modules/billing/webhooks";
import { verifyWebhookSignature } from "@/modules/razorpay/signature";
import { fulfillCapturedAiCreditPayment, type AiCreditsDb } from "@/modules/ai-credits/service";

const SECRET = "whsec_ai_credits_test";

function sign(body: string) {
  return createHmac("sha256", SECRET).update(body).digest("hex");
}

function createAiCreditsStore() {
  const state = {
    balance: 0,
    purchased: 0,
    payments: [
      {
        id: "pay-row-1",
        status: "PENDING",
        organization_id: "org-1",
        billing_cycle: "ai_credits",
        ai_credit_pack_size: 2500,
        amount_paise: 39900,
        razorpay_order_id: "order_ai_1",
      },
    ] as Array<Record<string, unknown>>,
  };

  const db = {
    from() {
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        not() {
          return this;
        },
        async maybeSingle() {
          return { data: null, error: null };
        },
        async insert() {
          return { error: null };
        },
        update() {
          return {
            eq() {
              return { error: null };
            },
          };
        },
      };
    },
    async rpc(name: string, args: Record<string, unknown>) {
      if (name !== "fulfill_ai_credit_purchase") return { data: null, error: { message: "unknown rpc" } };
      const payment = state.payments.find((row) => row.razorpay_order_id === args.p_razorpay_order_id);
      if (!payment) return { data: { handled: false, granted: false, remaining: null } };
      if (args.p_amount_paise != null && Number(payment.amount_paise) !== Number(args.p_amount_paise)) {
        return { data: { handled: true, granted: false, amountMismatch: true, remaining: null } };
      }
      if (payment.status === "CAPTURED") {
        return { data: { handled: true, granted: false, remaining: state.balance, organizationId: payment.organization_id } };
      }
      payment.status = "CAPTURED";
      const qty = Number(payment.ai_credit_pack_size);
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
    },
  };

  return { state, db: db as unknown as AiCreditsDb & SupabaseClient };
}

describe("AI credit Razorpay webhooks", () => {
  it("rejects a captured payload with a bad HMAC", () => {
    const body = JSON.stringify({ event: "payment.captured" });
    expect(verifyWebhookSignature(body, sign(body), SECRET)).toBe(true);
    expect(verifyWebhookSignature(body, sign(body + "x"), SECRET)).toBe(false);
    expect(verifyWebhookSignature(body, sign(body), "other-secret")).toBe(false);
  });

  it("grants credits once for payment.captured on an AI credit order", async () => {
    const { state, db } = createAiCreditsStore();
    const payload = {
      event: "payment.captured",
      payload: {
        payment: {
          entity: {
            id: "pay_ai_1",
            amount: 39900,
            order_id: "order_ai_1",
            method: "upi",
          },
        },
      },
    };

    await processRazorpayEvent(db, payload, "evt_ai_1");
    expect(state.balance).toBe(2500);
    expect(state.purchased).toBe(2500);
    expect(state.payments[0]?.status).toBe("CAPTURED");

    await processRazorpayEvent(db, payload, "evt_ai_1_dup");
    expect(state.balance).toBe(2500);
    expect(state.purchased).toBe(2500);
  });

  it("does not grant on amount mismatch or a non-captured failed payment", async () => {
    const { state, db } = createAiCreditsStore();
    const mismatch = await fulfillCapturedAiCreditPayment(db, {
      razorpayOrderId: "order_ai_1",
      razorpayPaymentId: "pay_wrong",
      amountPaise: 9900,
    });
    expect(mismatch.amountMismatch).toBe(true);
    expect(mismatch.granted).toBe(false);
    expect(state.balance).toBe(0);

    const missing = await fulfillCapturedAiCreditPayment(db, {
      razorpayOrderId: "order_missing",
      amountPaise: 39900,
    });
    expect(missing.handled).toBe(false);
    expect(missing.granted).toBe(false);
  });
});
