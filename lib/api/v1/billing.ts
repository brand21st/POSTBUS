import { z } from "zod";
import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import type { TenantContext } from "@/lib/api/context";
import { getRazorpayConfig } from "@/modules/razorpay/config";
import { createAdminClient, hasAdminClient } from "@/lib/supabase/admin";
import {
  applyFullTrialAccess,
  cancelSubscription,
  changePlan,
  getLiveSubscription,
  getPayableSubscription,
  listActivePlans,
  mapPlan,
  resumeSubscription,
  startCheckout,
  verifyCheckout,
} from "@/modules/billing/subscriptions";
import { getQuotaSnapshot } from "@/modules/billing/usage";
import { decideBillingAccess } from "@/modules/billing/access";
import { billingDisplay, paymentDisplayStatus } from "@/modules/billing/display";
import { NEW_TRIAL_DAYS } from "@/modules/billing/trial-policy";

const subscribeSchema = z.object({
  planId: z.string().uuid(),
  billingCycle: z.enum(["monthly", "yearly"]),
});

const changePlanSchema = z.object({
  planId: z.string().uuid(),
  billingCycle: z.enum(["monthly", "yearly"]).optional(),
});

const verifySchema = z.object({
  razorpayPaymentId: z.string().min(1),
  razorpayOrderId: z.string().min(1),
  razorpaySignature: z.string().min(1),
  razorpaySubscriptionId: z.string().min(1).optional(),
});

async function loadBillingDisplay(
  supabase: SupabaseClient,
  organizationId: string,
  subscription: Awaited<ReturnType<typeof getLiveSubscription>>,
  access: ReturnType<typeof decideBillingAccess>
) {
  let hasCapturedPaymentForPeriod = false;
  if (subscription?.id && access.operational && subscription.status !== "TRIAL") {
    const periodStart = subscription.current_period_start
      ? new Date(new Date(subscription.current_period_start).getTime() - 86_400_000).toISOString()
      : null;
    let paid = supabase
      .from("payments")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("subscription_id", subscription.id)
      .eq("status", "CAPTURED")
      .eq("payment_purpose", "subscription");
    if (periodStart) paid = paid.gte("paid_at", periodStart);
    const { data } = await paid.limit(1);
    hasCapturedPaymentForPeriod = Boolean(data?.length);
  }
  const { data: latest } = await supabase
    .from("payments")
    .select("id, status, plan_id, created_at, failure_reason")
    .eq("organization_id", organizationId)
    .eq("payment_purpose", "subscription")
    .in("status", ["PENDING", "CAPTURED", "REFUNDED"])
    .order("created_at", { ascending: false })
    .limit(1);
  const newest = (latest?.[0] ?? null) as
    | { id: string; status: string; plan_id: string | null; created_at: string; failure_reason: string | null }
    | null;
  let latestCheckout = null;
  if (newest?.status === "PENDING") {
    // payment_attempts arrives with the hardening migration; ignore it if missing.
    const { count } = await supabase
      .from("payment_attempts")
      .select("id", { count: "exact", head: true })
      .eq("purchase_id", newest.id)
      .eq("status", "FAILED");
    latestCheckout = { ...newest, failed_attempts: count ?? 0 };
  }
  return billingDisplay({
    access,
    status: subscription?.status ?? null,
    cancelAtPeriodEnd: subscription?.cancel_at_period_end,
    trialEnd: subscription?.trial_end,
    hasCapturedPaymentForPeriod,
    latestCheckout,
  });
}

function clientIp(request: NextRequest) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
}

function writeClient() {
  if (!hasAdminClient()) {
    throw new AppError(ERROR_CODES.INTEGRATION_NOT_CONNECTED, "Billing writes require the service role.");
  }
  return createAdminClient();
}

export async function handleBillingRoutes(
  request: NextRequest,
  supabase: SupabaseClient,
  ctx: TenantContext | null,
  key: string
) {
  if (key === "GET billing/plans") {
    const razorpay = await getRazorpayConfig();
    return { plans: await listActivePlans(supabase), configured: Boolean(razorpay.keyId && razorpay.keySecret) };
  }

  if (!ctx) return null;

  if (key === "GET billing" || key === "GET billing/subscription") {
    const subscription =
      (await getLiveSubscription(supabase, ctx.organizationId)) ??
      (await getPayableSubscription(supabase, ctx.organizationId));
    const usage = await getQuotaSnapshot(supabase, ctx.organizationId);
    const plan = subscription?.plans
      ? Array.isArray(subscription.plans)
        ? subscription.plans[0]
        : subscription.plans
      : null;
    const razorpay = await getRazorpayConfig();
    const catalog = await listActivePlans(supabase);
    const mapped = plan ? mapPlan(plan) : null;
    const access = decideBillingAccess(subscription);
    const coverageEnded = subscription ? access.coverageEnded : false;
    const trialLive = mapped && access.state === "TRIAL";
    const trialPlan = trialLive ? applyFullTrialAccess(mapped, catalog, NEW_TRIAL_DAYS) : mapped;
    const trialLimit = trialLive && trialPlan ? trialPlan.monthlyOrderLimit : usage.orderLimit;
    const remaining =
      trialLimit == null ? usage.remaining : Math.max(0, trialLimit - usage.ordersUsed);
    const display = await loadBillingDisplay(supabase, ctx.organizationId, subscription, access);
    return {
      display,
      configurationRequired: !razorpay.keyId || !razorpay.keySecret,
      configured: Boolean(razorpay.keyId && razorpay.keySecret),
      keyId: razorpay.keyId || null,
      plan: trialPlan,
      subscription: subscription
        ? {
            id: subscription.id,
            status: subscription.status,
            billingCycle: subscription.billing_cycle,
            amountPaise: Number(subscription.amount_paise),
            orderLimit: trialLimit ?? subscription.order_limit,
            startedAt: subscription.started_at,
            currentPeriodStart: subscription.current_period_start,
            currentPeriodEnd: subscription.current_period_end,
            renewsAt: coverageEnded ? null : subscription.renews_at,
            expiresAt: subscription.expires_at,
            cancelAtPeriodEnd: subscription.cancel_at_period_end,
            trialStart: subscription.trial_start,
            trialEnd: subscription.trial_end,
            razorpaySubscriptionId: subscription.razorpay_subscription_id,
            coverageEnded,
          }
        : null,
      usage: {
        metric: "orders",
        quantity: usage.ordersUsed,
        limit: trialLimit,
        remaining,
        periodStart: usage.periodStart,
        periodEnd: usage.periodEnd,
      },
    };
  }

  if (key === "GET billing/usage") {
    return getQuotaSnapshot(supabase, ctx.organizationId);
  }

  if (key === "GET billing/payments") {
    const { data } = await supabase
      .from("payments")
      .select("*, plans(name, slug)")
      .eq("organization_id", ctx.organizationId)
      .order("created_at", { ascending: false })
      .limit(50);
    const now = Date.now();
    const rows = (data ?? []) as Array<Record<string, unknown> & { status: string; created_at: string; failure_reason?: string | null }>;
    return {
      payments: rows.map((row) => ({ ...row, display: paymentDisplayStatus(row, now) })),
    };
  }

  if (key === "GET billing/invoices") {
    const { data } = await supabase
      .from("invoices")
      .select("*")
      .eq("organization_id", ctx.organizationId)
      .order("created_at", { ascending: false })
      .limit(50);
    return { invoices: data ?? [] };
  }

  if (key === "POST billing/ai-credits/checkout") {
    const { startAiCreditsCheckout } = await import("@/modules/ai-credits/service");
    const body = z
      .object({
        packageId: z.string().min(1).optional(),
        credits: z.number().int().optional(),
      })
      .parse(await request.json().catch(() => ({})));
    return startAiCreditsCheckout(writeClient(), {
      organizationId: ctx.organizationId,
      organizationName: ctx.organizationName,
      email: ctx.email,
      userId: ctx.userId,
      packageId: body.packageId,
      credits: body.credits,
    });
  }

  if (key === "POST billing/subscribe") {
    const body = subscribeSchema.parse(await request.json());
    return startCheckout(writeClient(), {
      organizationId: ctx.organizationId,
      organizationName: ctx.organizationName,
      email: ctx.email,
      userId: ctx.userId,
      planId: body.planId,
      billingCycle: body.billingCycle,
      ip: clientIp(request),
    });
  }

  if (key === "POST billing/verify") {
    const body = verifySchema.parse(await request.json());
    return verifyCheckout(writeClient(), {
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      paymentId: body.razorpayPaymentId,
      razorpayOrderId: body.razorpayOrderId,
      razorpaySubscriptionId: body.razorpaySubscriptionId,
      signature: body.razorpaySignature,
      ip: clientIp(request),
    });
  }

  if (key === "POST billing/change-plan") {
    const body = changePlanSchema.parse(await request.json());
    return changePlan(writeClient(), {
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      planId: body.planId,
      billingCycle: body.billingCycle,
      ip: clientIp(request),
    });
  }

  if (key === "POST billing/cancel") {
    const body = await request.json().catch(() => ({}));
    return cancelSubscription(writeClient(), {
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      immediate: Boolean(body.immediate),
      ip: clientIp(request),
    });
  }

  if (key === "POST billing/resume") {
    return resumeSubscription(writeClient(), {
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      ip: clientIp(request),
    });
  }

  if (key.startsWith("GET billing") || key.startsWith("POST billing")) {
    throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Not found.");
  }

  return null;
}
