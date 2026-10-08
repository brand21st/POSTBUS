import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { logError } from "@/lib/logger";
import { createAdminClient, hasAdminClient } from "@/lib/supabase/admin";
import {
  AI_CREDITS_BILLING_CYCLE,
  AI_CREDIT_REASON_EXTRACTION,
  DEFAULT_AI_CREDIT_PACK_PAISE,
  DEFAULT_AI_CREDIT_PACK_SIZE,
  DEFAULT_AI_CREDIT_START,
} from "@/modules/ai-credits/constants";
import { loadAiCreditCatalog, publicAiCreditPackage } from "@/modules/ai-credits/catalog";
import { quoteAiCredits } from "@/modules/ai-credits/quote";
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
  purchased: number;
  used: number;
  included: number;
  packSize: number;
  packPaise: number;
  packages: ReturnType<typeof publicAiCreditPackage>[];
  custom: { min: number; max: number };
};

export type AiCreditPackConfig = {
  packSize: number;
  packPaise: number;
};

export type AiCreditsDb = Pick<SupabaseClient, "from" | "rpc">;

function asNumber(value: unknown, fallback: number) {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function parseRpcObject(data: unknown) {
  if (data && typeof data === "object" && !Array.isArray(data)) {
    return data as Record<string, unknown>;
  }
  return null;
}

export async function getAiCreditPackConfig(): Promise<AiCreditPackConfig> {
  const catalog = await loadAiCreditCatalog();
  const recommended = catalog.packages.find((item) => item.isRecommended && item.isActive) ?? catalog.packages[0];
  if (!recommended) {
    return { packSize: DEFAULT_AI_CREDIT_PACK_SIZE, packPaise: DEFAULT_AI_CREDIT_PACK_PAISE };
  }
  return { packSize: recommended.credits, packPaise: recommended.pricePaise };
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
  const [wallet, catalog] = await Promise.all([
    supabase
      .from("organizations")
      .select("ai_credits_balance, ai_credits_purchased, ai_credits_used")
      .eq("id", organizationId)
      .maybeSingle(),
    loadAiCreditCatalog(),
  ]);
  if (wallet.error) {
    logError("ai_credits.balance_load_failed", { message: wallet.error.message, organizationId });
  }
  const remaining = Math.max(
    0,
    Math.floor(asNumber(wallet.data?.ai_credits_balance, DEFAULT_AI_CREDIT_START))
  );
  const purchased = Math.max(0, Math.floor(asNumber(wallet.data?.ai_credits_purchased, 0)));
  const used = Math.max(0, Math.floor(asNumber(wallet.data?.ai_credits_used, 0)));
  const featured =
    catalog.packages.find((item) => item.isRecommended) ??
    catalog.packages.find((item) => item.credits === DEFAULT_AI_CREDIT_PACK_SIZE) ??
    catalog.packages[0];
  return {
    remaining,
    purchased,
    used,
    included: DEFAULT_AI_CREDIT_START,
    packSize: featured?.credits ?? DEFAULT_AI_CREDIT_PACK_SIZE,
    packPaise: featured?.pricePaise ?? DEFAULT_AI_CREDIT_PACK_PAISE,
    packages: catalog.packages.filter((item) => item.isActive !== false).map(publicAiCreditPackage),
    custom: catalog.custom,
  };
}

export async function listAiCreditLedger(supabase: SupabaseClient, organizationId: string) {
  const { data, error } = await supabase
    .from("ai_credit_ledger")
    .select("id, type, reason_code, delta, balance_after, status, payment_id, created_at, metadata")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) {
    logError("ai_credits.ledger_load_failed", { message: error.message, organizationId });
    return [];
  }
  return (data ?? []).map((row) => {
    const metadata = (row.metadata ?? {}) as Record<string, unknown>;
    const amountPaise = asNumber(metadata.amount_paise, NaN);
    return {
      id: String(row.id),
      date: row.created_at,
      type: String(row.type ?? ""),
      reasonCode: String(row.reason_code ?? ""),
      description: ledgerDescription(String(row.type ?? ""), String(row.reason_code ?? "")),
      credits: Number(row.delta ?? 0),
      amountPaise: Number.isFinite(amountPaise) ? amountPaise : null,
      status: String(row.status ?? "POSTED"),
    };
  });
}

function ledgerDescription(type: string, reason: string) {
  if (type === "PURCHASE" || reason === "PURCHASE") return "AI Credits";
  if (reason === "AI_ADDRESS_EXTRACTION") return "AI Extraction";
  if (type === "REFUND" || reason === "REFUND") return "Refund";
  if (type === "BONUS" || reason === "BONUS") return "Bonus";
  return reason.replaceAll("_", " ");
}

export async function consumeAiCredit(
  supabase: AiCreditsDb,
  organizationId: string,
  input?: { reason?: string; idempotencyKey?: string | null; qty?: number }
) {
  const { data, error } = await supabase.rpc("consume_ai_credit", {
    p_org: organizationId,
    p_reason: input?.reason ?? AI_CREDIT_REASON_EXTRACTION,
    p_idempotency_key: input?.idempotencyKey ?? null,
    p_qty: Math.max(1, Math.floor(input?.qty ?? 1)),
  });
  if (error) {
    logError("ai_credits.consume_failed", { message: error.message, organizationId });
    return null;
  }
  if (typeof data === "number") {
    return Math.max(0, Math.floor(data));
  }
  const parsed = parseRpcObject(data);
  if (!parsed) return 0;
  if (parsed.consumed) {
    void trackUsage(organizationId, "ai_credits.consumed", Math.max(1, Math.floor(input?.qty ?? 1)));
  }
  return Math.max(0, Math.floor(asNumber(parsed.remaining, 0)));
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
    organizationId?: string | null;
  }
): Promise<{
  handled: boolean;
  granted: boolean;
  remaining: number | null;
  amountMismatch?: boolean;
  forbidden?: boolean;
}> {
  if (typeof supabase.rpc !== "function") {
    return fulfillCapturedAiCreditPaymentLegacy(supabase, input);
  }
  const { data, error } = await supabase.rpc("fulfill_ai_credit_purchase", {
    p_razorpay_order_id: input.razorpayOrderId,
    p_razorpay_payment_id: input.razorpayPaymentId ?? null,
    p_method: input.method ?? null,
    p_amount_paise: input.amountPaise ?? null,
    p_expected_organization_id: input.organizationId ?? null,
  });
  if (error) {
    logError("ai_credits.fulfill_rpc_failed", {
      message: error.message,
      orderId: input.razorpayOrderId,
    });
    return fulfillCapturedAiCreditPaymentLegacy(supabase, input);
  }
  const parsed = parseRpcObject(data);
  if (!parsed) return { handled: false, granted: false, remaining: null };
  const result = {
    handled: Boolean(parsed.handled),
    granted: Boolean(parsed.granted),
    remaining: parsed.remaining == null ? null : Math.max(0, Math.floor(asNumber(parsed.remaining, 0))),
    amountMismatch: Boolean(parsed.amountMismatch),
    forbidden: Boolean(parsed.forbidden),
  };
  const orgId = String(parsed.organizationId ?? input.organizationId ?? "");
  if (result.granted && orgId) {
    void trackUsage(orgId, "ai_credits.purchased", Math.max(1, asNumber(parsed.credits, 1)));
  }
  return result;
}

async function fulfillCapturedAiCreditPaymentLegacy(
  supabase: AiCreditsDb,
  input: {
    razorpayOrderId: string;
    razorpayPaymentId?: string | null;
    amountPaise?: number | null;
    method?: string | null;
    organizationId?: string | null;
  }
): Promise<{
  handled: boolean;
  granted: boolean;
  remaining: number | null;
  amountMismatch?: boolean;
  forbidden?: boolean;
}> {
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
  if (input.organizationId && organizationId && input.organizationId !== organizationId) {
    return { handled: true, granted: false, remaining: null, forbidden: true };
  }
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
    const remaining = organizationId ? await remainingFromRpc(supabase, organizationId) : 0;
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
    const remaining = organizationId ? await remainingFromRpc(supabase, organizationId) : 0;
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
  await supabase.from("ai_credit_ledger").insert({
    organization_id: organizationId,
    type: "PURCHASE",
    reason_code: "PURCHASE",
    delta: packSize,
    balance_after: Math.max(0, Math.floor(asNumber(remaining, 0))),
    status: "POSTED",
    payment_id: String(payment.id),
    idempotency_key: `payment:${payment.id}`,
    metadata: { amount_paise: payment.amount_paise, razorpay_order_id: input.razorpayOrderId },
  });
  return { handled: true, granted: true, remaining: Math.max(0, Math.floor(asNumber(remaining, 0))) };
}

async function remainingFromRpc(supabase: AiCreditsDb, organizationId: string) {
  const { data } = await supabase.rpc("grant_ai_credits", { p_org: organizationId, p_amount: 0 });
  return Math.max(0, Math.floor(asNumber(data, 0)));
}

async function trackUsage(organizationId: string, metric: string, quantity: number) {
  if (!hasAdminClient() || quantity <= 0) return;
  const supabase = createAdminClient();
  await supabase.from("usage_events").insert({
    organization_id: organizationId,
    metric,
    quantity,
  });
}

export async function quoteMerchantAiCredits(input: { packageId?: string | null; credits?: unknown }) {
  const catalog = await loadAiCreditCatalog();
  if (!input.packageId && (input.credits === undefined || input.credits === null || input.credits === "")) {
    const featured =
      catalog.packages.find((item) => item.isRecommended) ?? catalog.packages[0];
    if (!featured) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, "AI credit packages are not configured yet.");
    }
    return quoteAiCredits(featured.credits, catalog.packages, catalog.custom, featured.id);
  }
  return quoteAiCredits(input.credits, catalog.packages, catalog.custom, input.packageId);
}

export async function startAiCreditsCheckout(
  supabase: SupabaseClient,
  input: {
    organizationId: string;
    organizationName: string;
    email?: string | null;
    userId: string;
    packageId?: string | null;
    credits?: unknown;
  }
) {
  const razorpay = await getRazorpayConfig();
  if (!razorpay.keyId || !razorpay.keySecret) {
    throw new AppError(ERROR_CODES.INTEGRATION_NOT_CONNECTED, "Billing is not configured yet.");
  }
  const quote = await quoteMerchantAiCredits({
    packageId: input.packageId,
    credits: input.credits,
  });
  const order = await createRazorpayOrder({
    amountPaise: quote.amountPaise,
    receipt: `ai_${input.organizationId.replace(/-/g, "").slice(0, 10)}_${Date.now()}`.slice(0, 40),
    notes: {
      kind: AI_CREDITS_BILLING_CYCLE,
      organization_id: input.organizationId,
      pack_size: String(quote.credits),
      package_id: quote.packageId ?? "",
    },
  });
  const razorpayOrderId = String(order.id);
  const { error } = await supabase.from("payments").insert({
    organization_id: input.organizationId,
    amount_paise: quote.amountPaise,
    currency: "INR",
    status: "PENDING",
    razorpay_order_id: razorpayOrderId,
    billing_cycle: AI_CREDITS_BILLING_CYCLE,
    ai_credit_pack_size: quote.credits,
    ai_credit_package_id: quote.packageId?.startsWith("fallback-") ? null : quote.packageId,
  });
  if (error) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message || "Could not start AI credit checkout.");
  }
  void trackUsage(input.organizationId, "ai_credits.checkout_started", quote.credits);
  return {
    keyId: razorpay.keyId,
    razorpayOrderId,
    amountPaise: quote.amountPaise,
    currency: "INR",
    packSize: quote.credits,
    name: "PostBus",
    description: `${quote.credits} AI credits`,
    prefill: {
      email: input.email ?? "",
      name: input.organizationName,
    },
  };
}
