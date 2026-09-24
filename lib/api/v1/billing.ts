import { z } from "zod";
import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import type { TenantContext } from "@/lib/api/context";
import { getRazorpayConfig } from "@/modules/razorpay/config";
import { createAdminClient, hasAdminClient } from "@/lib/supabase/admin";
import {
  cancelSubscription,
  changePlan,
  getLiveSubscription,
  listActivePlans,
  mapPlan,
  resumeSubscription,
  startCheckout,
  verifyCheckout,
} from "@/modules/billing/subscriptions";
import { getQuotaSnapshot } from "@/modules/billing/usage";

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
  razorpaySubscriptionId: z.string().min(1),
  razorpaySignature: z.string().min(1),
});

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
    const subscription = await getLiveSubscription(supabase, ctx.organizationId);
    const usage = await getQuotaSnapshot(supabase, ctx.organizationId);
    const plan = subscription?.plans
      ? Array.isArray(subscription.plans)
        ? subscription.plans[0]
        : subscription.plans
      : null;
    const razorpay = await getRazorpayConfig();
    return {
      configurationRequired: !razorpay.keyId || !razorpay.keySecret,
      configured: Boolean(razorpay.keyId && razorpay.keySecret),
      keyId: razorpay.keyId || null,
      plan: plan ? mapPlan(plan) : null,
      subscription: subscription
        ? {
            id: subscription.id,
            status: subscription.status,
            billingCycle: subscription.billing_cycle,
            amountPaise: Number(subscription.amount_paise),
            orderLimit: subscription.order_limit,
            startedAt: subscription.started_at,
            currentPeriodStart: subscription.current_period_start,
            currentPeriodEnd: subscription.current_period_end,
            renewsAt: subscription.renews_at,
            expiresAt: subscription.expires_at,
            cancelAtPeriodEnd: subscription.cancel_at_period_end,
            trialStart: subscription.trial_start,
            trialEnd: subscription.trial_end,
          }
        : null,
      usage: {
        metric: "orders",
        quantity: usage.ordersUsed,
        limit: usage.orderLimit,
        remaining: usage.remaining,
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
    return { payments: data ?? [] };
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
