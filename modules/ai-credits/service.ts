import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { logError } from "@/lib/logger";
import { createAdminClient, hasAdminClient } from "@/lib/supabase/admin";
import {
  AI_CREDITS_BILLING_CYCLE,
  DEFAULT_AI_CREDIT_PACK_PAISE,
  DEFAULT_AI_CREDIT_PACK_SIZE,
  DEFAULT_AI_CREDIT_START,
} from "@/modules/ai-credits/constants";
import { getRazorpayConfig } from "@/modules/razorpay/config";
import { createRazorpayOrder } from "@/modules/razorpay/client";

export {
  AI_CREDITS_BILLING_CYCLE,
  DEFAULT_AI_CREDIT_PACK_PAISE,
  DEFAULT_AI_CREDIT_PACK_SIZE,
  DEFAULT_AI_CREDIT_START,
} from "@/modules/ai-credits/constants";

export type AiCreditsSnapshot = {
  remaining: number;
  included: number;
  packSize: number;
  packPaise: number;
};

export type AiCreditPackConfig = {
  packSize: number;
  packPaise: number;
};

export type AiCreditsDb = {
  from: (table: string) => any;
  rpc: (name: string, args: Record<string, unknown>) => any;
};

function asNumber(value: unknown, fallback: number) {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export async function getAiCreditPackConfig(): Promise<AiCreditPackConfig> {
  if (!hasAdminClient()) {
    return { packSize: DEFAULT_AI_CREDIT_PACK_SIZE, packPaise: DEFAULT_AI_CREDIT_PACK_PAISE };
  }
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("platform_settings")
    .select("ai_credit_pack_size, ai_credit_pack_paise")
    .eq("id", 1)
    .maybeSingle();
  if (error) {
    logError("ai_credits.pack_load_failed", { message: error.message });
    return { packSize: DEFAULT_AI_CREDIT_PACK_SIZE, packPaise: DEFAULT_AI_CREDIT_PACK_PAISE };
  }
  const packSize = Math.max(1, Math.floor(asNumber(data?.ai_credit_pack_size, DEFAULT_AI_CREDIT_PACK_SIZE)));
  const packPaise = Math.max(100, Math.floor(asNumber(data?.ai_credit_pack_paise, DEFAULT_AI_CREDIT_PACK_PAISE)));
  return { packSize, packPaise };
}

export async function getAiCreditsRemaining(supabase: SupabaseClient, organizationId: string) {
  const { data, error } = await supabase
    .from("organizations")
    .select("ai_credits_balance")
    .eq("id", organizationId)
    .maybeSingle();
  if (error) {
    logError("ai_credits.balance_load_failed", { message: error.message, organizationId });
    return DEFAULT_AI_CREDIT_START;
  }
  if (data?.ai_credits_balance == null) return DEFAULT_AI_CREDIT_START;
  return Math.max(0, Math.floor(asNumber(data.ai_credits_balance, DEFAULT_AI_CREDIT_START)));
}

export async function getAiCreditsSnapshot(
  supabase: SupabaseClient,
  organizationId: string
): Promise<AiCreditsSnapshot> {
  const [remaining, pack] = await Promise.all([getAiCreditsRemaining(supabase, organizationId), getAiCreditPackConfig()]);
  return {
    remaining,
    included: DEFAULT_AI_CREDIT_START,
    packSize: pack.packSize,
    packPaise: pack.packPaise,
  };
}

export async function consumeAiCredit(supabase: AiCreditsDb, organizationId: string) {
  const { data, error } = await supabase.rpc("consume_ai_credit", { p_org: organizationId });
  if (error) {
    logError("ai_credits.consume_failed", { message: error.message, organizationId });
    return null;
  }
  return Math.max(0, Math.floor(asNumber(data, 0)));
}

export function shouldGrantAiCredits(previousStatus: string | null | undefined, billingCycle: string | null | undefined) {
  return billingCycle === AI_CREDITS_BILLING_CYCLE && previousStatus !== "CAPTURED";
}

export async function fulfillCapturedAiCreditPayment(
  supabase: AiCreditsDb,
  input: {
    razorpayOrderId: string;
    razorpayPaymentId?: string | null;
    amountPaise?: number | null;
    method?: string | null;
  }
): Promise<{ handled: boolean; granted: boolean; remaining: number | null; amountMismatch?: boolean }> {
  const { data: payment, error } = await supabase
    .from("payments")
    .select("id, status, organization_id, billing_cycle, ai_credit_pack_size, amount_paise")
    .eq("razorpay_order_id", input.razorpayOrderId)
    .maybeSingle();
  if (error) {
    logError("ai_credits.payment_load_failed", { message: error.message, orderId: input.razorpayOrderId });
    return { handled: false, granted: false, remaining: null };
  }
  if (!payment || String(payment.billing_cycle ?? "") !== AI_CREDITS_BILLING_CYCLE) {
    return { handled: false, granted: false, remaining: null };
  }

  const organizationId = String(payment.organization_id ?? "");
  const packSize = Math.max(0, Math.floor(asNumber(payment.ai_credit_pack_size, 0)));
  if (input.amountPaise != null && Number(payment.amount_paise) !== Number(input.amountPaise)) {
    logError("ai_credits.amount_mismatch", {
      expected: payment.amount_paise,
      received: input.amountPaise,
      orderId: input.razorpayOrderId,
    });
    return { handled: true, granted: false, remaining: null, amountMismatch: true };
  }

  if (!shouldGrantAiCredits(String(payment.status ?? ""), String(payment.billing_cycle))) {
    const remaining = organizationId ? await remainingFromRpc(supabase, organizationId, 0) : 0;
    return { handled: true, granted: false, remaining };
  }

  const { data: claimed } = await supabase
    .from("payments")
    .update({
      status: "CAPTURED",
      razorpay_payment_id: input.razorpayPaymentId ?? null,
      method: input.method ?? null,
      paid_at: new Date().toISOString(),
      failure_reason: null,
    })
    .eq("id", String(payment.id))
    .neq("status", "CAPTURED")
    .select("id")
    .maybeSingle();

  if (!claimed) {
    const remaining = organizationId ? await remainingFromRpc(supabase, organizationId, 0) : 0;
    return { handled: true, granted: false, remaining };
  }

  const { data: remaining, error: grantError } = await supabase.rpc("grant_ai_credits", {
    p_org: organizationId,
    p_amount: packSize,
  });
  if (grantError) {
    logError("ai_credits.grant_failed", { message: grantError.message, organizationId });
    return { handled: true, granted: false, remaining: null };
  }
  return { handled: true, granted: true, remaining: Math.max(0, Math.floor(asNumber(remaining, 0))) };
}

async function remainingFromRpc(supabase: AiCreditsDb, organizationId: string, amount: number) {
  const { data } = await supabase.rpc("grant_ai_credits", { p_org: organizationId, p_amount: amount });
  return Math.max(0, Math.floor(asNumber(data, 0)));
}

export async function startAiCreditsCheckout(
  supabase: SupabaseClient,
  input: {
    organizationId: string;
    organizationName: string;
    email?: string | null;
    userId: string;
  }
) {
  const razorpay = await getRazorpayConfig();
  if (!razorpay.keyId || !razorpay.keySecret) {
    throw new AppError(ERROR_CODES.INTEGRATION_NOT_CONNECTED, "Billing is not configured yet.");
  }
  const pack = await getAiCreditPackConfig();
  const order = await createRazorpayOrder({
    amountPaise: pack.packPaise,
    receipt: `ai_${input.organizationId.replace(/-/g, "").slice(0, 10)}_${Date.now()}`.slice(0, 40),
    notes: {
      kind: AI_CREDITS_BILLING_CYCLE,
      organization_id: input.organizationId,
      pack_size: String(pack.packSize),
    },
  });
  const razorpayOrderId = String(order.id);
  const { error } = await supabase.from("payments").insert({
    organization_id: input.organizationId,
    amount_paise: pack.packPaise,
    currency: "INR",
    status: "PENDING",
    razorpay_order_id: razorpayOrderId,
    billing_cycle: AI_CREDITS_BILLING_CYCLE,
    ai_credit_pack_size: pack.packSize,
  });
  if (error) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message || "Could not start AI credit checkout.");
  }
  return {
    keyId: razorpay.keyId,
    razorpayOrderId,
    amountPaise: pack.packPaise,
    currency: "INR",
    packSize: pack.packSize,
    name: "PostBus",
    description: `${pack.packSize} AI credits`,
    prefill: {
      email: input.email ?? "",
      name: input.organizationName,
    },
  };
}
