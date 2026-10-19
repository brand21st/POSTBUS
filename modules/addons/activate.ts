import type { SupabaseClient } from "@supabase/supabase-js";
import { writeBillingAudit } from "@/modules/billing/audit";
import { ADDON_PAYMENT_PURPOSE, isAddonPaymentRow } from "@/modules/addons/constants";
import { upsertAddonEntitlement } from "@/modules/addons/entitlements";

function periodForCycle(cycle: "monthly" | "yearly", from = new Date()) {
  const start = new Date(from);
  const end = new Date(from);
  if (cycle === "yearly") end.setUTCFullYear(end.getUTCFullYear() + 1);
  else end.setUTCMonth(end.getUTCMonth() + 1);
  return { start, end };
}

export async function activateAddonFromPayment(
  supabase: SupabaseClient,
  input: {
    razorpayOrderId: string;
    razorpayPaymentId?: string | null;
    amountPaise?: number | null;
    method?: string | null;
    organizationId?: string | null;
    actor?: string | null;
  }
): Promise<{
  handled: boolean;
  forbidden?: boolean;
  amountMismatch?: boolean;
  addonSubscriptionId?: string;
  slug?: string;
}> {
  const { data: payment } = await supabase
    .from("payments")
    .select("*")
    .eq("razorpay_order_id", input.razorpayOrderId)
    .maybeSingle();
  if (!payment || !isAddonPaymentRow(payment)) return { handled: false };
  if (input.organizationId && payment.organization_id !== input.organizationId) {
    return { handled: true, forbidden: true };
  }
  if (input.amountPaise != null && Number(payment.amount_paise) !== Number(input.amountPaise)) {
    return { handled: true, amountMismatch: true };
  }

  const { data: addonSub } = await supabase
    .from("organization_addon_subscriptions")
    .select("*")
    .eq("razorpay_order_id", input.razorpayOrderId)
    .maybeSingle();
  if (!addonSub) return { handled: true, forbidden: true };
  if (input.organizationId && addonSub.organization_id !== input.organizationId) {
    return { handled: true, forbidden: true };
  }

  if (payment.status === "CAPTURED" && addonSub.status === "ACTIVE") {
    return { handled: true, addonSubscriptionId: addonSub.id, slug: addonSub.addon_slug };
  }

  const cycle = addonSub.billing_cycle === "yearly" ? "yearly" : "monthly";
  const { start, end } = periodForCycle(cycle);
  const now = new Date().toISOString();

  await supabase
    .from("payments")
    .update({
      status: "CAPTURED",
      razorpay_payment_id: input.razorpayPaymentId ?? payment.razorpay_payment_id,
      method: input.method ?? payment.method,
      paid_at: now,
      payment_purpose: ADDON_PAYMENT_PURPOSE,
    })
    .eq("id", payment.id);

  await supabase
    .from("organization_addon_subscriptions")
    .update({
      status: "ACTIVE",
      razorpay_payment_id: input.razorpayPaymentId ?? addonSub.razorpay_payment_id,
      current_period_start: start.toISOString(),
      current_period_end: end.toISOString(),
      started_at: addonSub.started_at ?? now,
      cancel_at_period_end: false,
      cancelled_at: null,
      updated_at: now,
    })
    .eq("id", addonSub.id);

  await upsertAddonEntitlement(supabase, {
    organizationId: addonSub.organization_id,
    slug: addonSub.addon_slug,
    status: "ACTIVE",
    currentPeriodStart: start.toISOString(),
    currentPeriodEnd: end.toISOString(),
    sourceSubscriptionId: addonSub.id,
  });

  await writeBillingAudit(supabase, {
    actorId: input.actor ?? null,
    actorType: input.actor === "WEBHOOK" ? "WEBHOOK" : "USER",
    action: "addon.activated",
    targetType: "addon_subscription",
    targetId: addonSub.id,
    organizationId: addonSub.organization_id,
    metadata: { slug: addonSub.addon_slug, razorpayOrderId: input.razorpayOrderId },
  });

  return { handled: true, addonSubscriptionId: addonSub.id, slug: addonSub.addon_slug };
}

export async function markAddonPaymentFailed(
  supabase: SupabaseClient,
  input: {
    razorpayOrderId?: string | null;
    razorpayPaymentId?: string | null;
    failureReason?: string | null;
  }
) {
  if (!input.razorpayOrderId) return;
  const { data: addonSub } = await supabase
    .from("organization_addon_subscriptions")
    .select("*")
    .eq("razorpay_order_id", input.razorpayOrderId)
    .maybeSingle();
  if (!addonSub) return;
  if (addonSub.status === "ACTIVE") return;
  await supabase
    .from("organization_addon_subscriptions")
    .update({ status: "PAYMENT_FAILED", updated_at: new Date().toISOString() })
    .eq("id", addonSub.id);
  await supabase
    .from("payments")
    .update({
      status: "FAILED",
      razorpay_payment_id: input.razorpayPaymentId,
      failure_reason: input.failureReason ?? "Payment failed",
    })
    .eq("razorpay_order_id", input.razorpayOrderId);
  await upsertAddonEntitlement(supabase, {
    organizationId: addonSub.organization_id,
    slug: addonSub.addon_slug,
    status: "PAYMENT_FAILED",
    currentPeriodStart: addonSub.current_period_start,
    currentPeriodEnd: addonSub.current_period_end,
    sourceSubscriptionId: addonSub.id,
  });
}

export async function revokeAddonOnRefund(supabase: SupabaseClient, razorpayPaymentId: string) {
  const { data: payment } = await supabase
    .from("payments")
    .select("id, razorpay_order_id, organization_id")
    .eq("razorpay_payment_id", razorpayPaymentId)
    .maybeSingle();
  if (!payment?.razorpay_order_id) return;
  const { data: addonSub } = await supabase
    .from("organization_addon_subscriptions")
    .select("*")
    .eq("razorpay_order_id", payment.razorpay_order_id)
    .maybeSingle();
  if (!addonSub) return;
  await supabase
    .from("organization_addon_subscriptions")
    .update({ status: "EXPIRED", updated_at: new Date().toISOString() })
    .eq("id", addonSub.id);
  await upsertAddonEntitlement(supabase, {
    organizationId: addonSub.organization_id,
    slug: addonSub.addon_slug,
    status: "EXPIRED",
    currentPeriodStart: addonSub.current_period_start,
    currentPeriodEnd: addonSub.current_period_end,
    sourceSubscriptionId: addonSub.id,
  });
  await writeBillingAudit(supabase, {
    actorType: "WEBHOOK",
    action: "addon.refunded",
    targetType: "addon_subscription",
    targetId: addonSub.id,
    organizationId: addonSub.organization_id,
    metadata: { razorpayPaymentId },
  });
}
