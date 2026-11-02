import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { writeBillingAudit } from "@/modules/billing/audit";
import { createRazorpayOrder } from "@/modules/razorpay/client";
import { getRazorpayConfig } from "@/modules/razorpay/config";
import { ADDON_PAYMENT_PURPOSE, AI_ACCOUNTANT_SLUG } from "@/modules/addons/constants";
import { catalogAmountPaise, getAddonCatalogRow } from "@/modules/addons/catalog";
import { upsertAddonEntitlement } from "@/modules/addons/entitlements";

export async function startAddonCheckout(
  supabase: SupabaseClient,
  input: {
    organizationId: string;
    organizationName: string;
    email?: string | null;
    userId: string;
    slug?: string;
    billingCycle: "monthly" | "yearly";
    ip?: string | null;
  }
) {
  const razorpay = await getRazorpayConfig();
  if (!razorpay.keyId || !razorpay.keySecret) {
    throw new AppError(ERROR_CODES.INTEGRATION_NOT_CONNECTED, "Billing is not configured yet.");
  }
  const slug = input.slug ?? AI_ACCOUNTANT_SLUG;
  const catalog = await getAddonCatalogRow(supabase, slug);
  if (!catalog || !catalog.is_active) {
    throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "This add-on is not available.");
  }
  const amount = catalogAmountPaise(catalog, input.billingCycle);
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Add-on pricing is not configured yet.");
  }

  const { data: existing } = await supabase
    .from("organization_addon_subscriptions")
    .select("*")
    .eq("organization_id", input.organizationId)
    .eq("addon_id", catalog.id)
    .maybeSingle();

  if (existing?.status === "ACTIVE" || existing?.status === "CANCELLED") {
    const end = existing.current_period_end ? new Date(existing.current_period_end) : null;
    if (end && end.getTime() > Date.now()) {
      throw new AppError(ERROR_CODES.CONFLICT, "This add-on is already active.");
    }
  }

  const order = await createRazorpayOrder({
    amountPaise: amount,
    receipt: `ad_${input.organizationId.replace(/-/g, "").slice(0, 10)}_${Date.now()}`.slice(0, 40),
    notes: {
      organization_id: input.organizationId,
      addon_slug: slug,
      billing_cycle: input.billingCycle,
      payment_purpose: ADDON_PAYMENT_PURPOSE,
    },
  });
  const razorpayOrderId = String(order.id);
  const now = new Date().toISOString();
  const row = {
    organization_id: input.organizationId,
    addon_id: catalog.id,
    addon_slug: slug,
    billing_cycle: input.billingCycle,
    status: "PAYMENT_PENDING",
    amount_paise: amount,
    razorpay_order_id: razorpayOrderId,
    cancel_at_period_end: false,
    updated_at: now,
  };

  let addonSubscriptionId = existing?.id as string | undefined;
  if (existing?.id) {
    const { error } = await supabase.from("organization_addon_subscriptions").update(row).eq("id", existing.id);
    if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  } else {
    const { data, error } = await supabase.from("organization_addon_subscriptions").insert(row).select("id").single();
    if (error || !data) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error?.message || "Could not start add-on checkout.");
    addonSubscriptionId = data.id;
  }

  await supabase.from("payments").insert({
    organization_id: input.organizationId,
    amount_paise: amount,
    currency: "INR",
    status: "PENDING",
    razorpay_order_id: razorpayOrderId,
    billing_cycle: input.billingCycle,
    payment_purpose: ADDON_PAYMENT_PURPOSE,
  });

  await upsertAddonEntitlement(supabase, {
    organizationId: input.organizationId,
    slug,
    status: "PAYMENT_PENDING",
    sourceSubscriptionId: addonSubscriptionId,
  });

  await writeBillingAudit(supabase, {
    actorId: input.userId,
    actorType: "USER",
    action: "addon.checkout_started",
    targetType: "addon_subscription",
    targetId: addonSubscriptionId,
    organizationId: input.organizationId,
    ip: input.ip,
    metadata: { slug, billingCycle: input.billingCycle, razorpayOrderId },
  });

  return {
    keyId: razorpay.keyId,
    addonSubscriptionId,
    razorpayOrderId,
    amountPaise: amount,
    currency: "INR",
    billingCycle: input.billingCycle,
    name: "PostBus",
    description: `${catalog.name} · ${input.billingCycle}`,
    addon: { slug: catalog.slug, name: catalog.name },
    prefill: { email: input.email ?? "", name: input.organizationName },
  };
}

export async function cancelAddonSubscription(
  supabase: SupabaseClient,
  input: { organizationId: string; userId: string; slug?: string; ip?: string | null }
) {
  const slug = input.slug ?? AI_ACCOUNTANT_SLUG;
  const { data: addonSub } = await supabase
    .from("organization_addon_subscriptions")
    .select("*")
    .eq("organization_id", input.organizationId)
    .eq("addon_slug", slug)
    .maybeSingle();
  if (!addonSub) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Add-on subscription not found.");
  const now = new Date().toISOString();
  const stillActive =
    addonSub.status === "ACTIVE" &&
    addonSub.current_period_end &&
    new Date(addonSub.current_period_end).getTime() > Date.now();
  const nextStatus = stillActive ? "CANCELLED" : "EXPIRED";
  await supabase
    .from("organization_addon_subscriptions")
    .update({
      status: nextStatus,
      cancel_at_period_end: true,
      cancelled_at: now,
      updated_at: now,
    })
    .eq("id", addonSub.id);
  await upsertAddonEntitlement(supabase, {
    organizationId: input.organizationId,
    slug,
    status: nextStatus,
    currentPeriodStart: addonSub.current_period_start,
    currentPeriodEnd: addonSub.current_period_end,
    sourceSubscriptionId: addonSub.id,
  });
  await writeBillingAudit(supabase, {
    actorId: input.userId,
    actorType: "USER",
    action: "addon.cancelled",
    targetType: "addon_subscription",
    targetId: addonSub.id,
    organizationId: input.organizationId,
    ip: input.ip,
    metadata: { slug, status: nextStatus },
  });
  return { status: nextStatus };
}
