import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { getRazorpayConfig } from "@/modules/razorpay/config";
import { BILLING_NOTICE, insertBillingNotification } from "@/lib/notifications/billing";
import { writeBillingAudit, writeSubscriptionHistory } from "@/modules/billing/audit";
import { mergeFullPlanFeatures } from "@/modules/billing/plan-features";
import { amountForCycle } from "@/modules/billing/prices";
import { LIVE_STATUSES } from "@/modules/billing/usage";
import {
  cancelRazorpaySubscription,
  createRazorpayCustomer,
  createRazorpayPlan,
  createRazorpaySubscription,
  pauseRazorpaySubscription,
  resumeRazorpaySubscription,
  updateRazorpaySubscription,
} from "@/modules/razorpay/client";
import { verifyCheckoutSignature } from "@/modules/razorpay/signature";

export type PlanRow = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  monthly_price_paise: number;
  yearly_price_paise: number;
  monthly_order_limit: number;
  features: unknown;
  is_active: boolean;
  display_order: number;
  razorpay_monthly_plan_id: string | null;
  razorpay_yearly_plan_id: string | null;
};

export type SubscriptionRow = {
  id: string;
  organization_id: string;
  plan_id: string;
  billing_cycle: "monthly" | "yearly";
  status: string;
  amount_paise: number;
  order_limit: number | null;
  started_at: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  renews_at: string | null;
  expires_at: string | null;
  cancel_at_period_end: boolean;
  cancelled_at: string | null;
  trial_start: string | null;
  trial_end: string | null;
  pending_plan_id: string | null;
  pending_billing_cycle: string | null;
  razorpay_subscription_id: string | null;
  razorpay_customer_id: string | null;
  plans?: PlanRow | PlanRow[] | null;
};

function asPlan(value: PlanRow | PlanRow[] | null | undefined): PlanRow | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
}

export function mapPlan(plan: PlanRow) {
  const features = Array.isArray(plan.features)
    ? plan.features.map(String)
    : [];
  return {
    id: plan.id,
    slug: plan.slug,
    name: plan.name,
    description: plan.description,
    monthlyPricePaise: Number(plan.monthly_price_paise),
    yearlyPricePaise: Number(plan.yearly_price_paise),
    monthlyOrderLimit: plan.monthly_order_limit,
    features,
    isActive: plan.is_active,
    displayOrder: plan.display_order,
    razorpayMonthlyPlanId: plan.razorpay_monthly_plan_id,
    razorpayYearlyPlanId: plan.razorpay_yearly_plan_id,
  };
}

export function applyFullTrialAccess(
  plan: ReturnType<typeof mapPlan>,
  catalog: Array<ReturnType<typeof mapPlan>>,
  trialDays = 3
) {
  const full = mergeFullPlanFeatures(catalog.length ? catalog : [plan]);
  const top = (catalog.length ? catalog : [plan]).reduce((best, item) =>
    item.monthlyOrderLimit > best.monthlyOrderLimit ? item : best
  );
  return {
    ...plan,
    name: top.name,
    description: `${trialDays}-day trial with every PostBus feature unlocked.`,
    features: full.features,
    monthlyOrderLimit: full.monthlyOrderLimit || plan.monthlyOrderLimit,
  };
}

export async function listActivePlans(supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from("plans")
    .select("*")
    .eq("is_active", true)
    .order("display_order", { ascending: true });
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  return (data as PlanRow[]).map(mapPlan);
}

export async function getLiveSubscription(supabase: SupabaseClient, organizationId: string) {
  const { data } = await supabase
    .from("subscriptions")
    .select("*, plans(*)")
    .eq("organization_id", organizationId)
    .in("status", [...LIVE_STATUSES])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data as SubscriptionRow | null;
}

async function loadPlan(supabase: SupabaseClient, planId: string) {
  const { data, error } = await supabase.from("plans").select("*").eq("id", planId).maybeSingle();
  if (error || !data) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Plan not found.");
  if (!data.is_active) throw new AppError(ERROR_CODES.VALIDATION_ERROR, "This plan is not available.");
  return data as PlanRow;
}

export async function ensureRazorpayPlanIds(supabase: SupabaseClient, plan: PlanRow) {
  const patch: Record<string, string> = {};
  if (!plan.razorpay_monthly_plan_id) {
    const created = await createRazorpayPlan({
      period: "monthly",
      name: `${plan.name} monthly`,
      amountPaise: Number(plan.monthly_price_paise),
      description: plan.description,
    });
    patch.razorpay_monthly_plan_id = String(created.id);
  }
  if (!plan.razorpay_yearly_plan_id) {
    const created = await createRazorpayPlan({
      period: "yearly",
      name: `${plan.name} yearly`,
      amountPaise: Number(plan.yearly_price_paise),
      description: plan.description,
    });
    patch.razorpay_yearly_plan_id = String(created.id);
  }
  if (Object.keys(patch).length) {
    await supabase.from("plans").update(patch).eq("id", plan.id);
    return { ...plan, ...patch };
  }
  return plan;
}

async function ensureRazorpayCustomer(
  supabase: SupabaseClient,
  input: { organizationId: string; name: string; email?: string | null }
) {
  const { data: existing } = await supabase
    .from("razorpay_customers")
    .select("*")
    .eq("organization_id", input.organizationId)
    .maybeSingle();
  if (existing?.razorpay_customer_id) return existing.razorpay_customer_id as string;
  const created = await createRazorpayCustomer({ name: input.name, email: input.email });
  const customerId = String(created.id);
  await supabase.from("razorpay_customers").upsert(
    {
      organization_id: input.organizationId,
      razorpay_customer_id: customerId,
      email: input.email ?? null,
    },
    { onConflict: "organization_id" }
  );
  return customerId;
}

function periodForCycle(cycle: "monthly" | "yearly", from = new Date()) {
  const start = from;
  const end = new Date(from);
  if (cycle === "yearly") end.setFullYear(end.getFullYear() + 1);
  else end.setMonth(end.getMonth() + 1);
  return { start, end };
}

export async function startCheckout(
  supabase: SupabaseClient,
  input: {
    organizationId: string;
    organizationName: string;
    email?: string | null;
    userId: string;
    planId: string;
    billingCycle: "monthly" | "yearly";
    ip?: string | null;
  }
) {
  const razorpay = await getRazorpayConfig();
  if (!razorpay.keyId || !razorpay.keySecret) {
    throw new AppError(ERROR_CODES.INTEGRATION_NOT_CONNECTED, "Billing is not configured yet.");
  }
  const plan = await ensureRazorpayPlanIds(supabase, await loadPlan(supabase, input.planId));
  const razorpayPlanId =
    input.billingCycle === "yearly" ? plan.razorpay_yearly_plan_id : plan.razorpay_monthly_plan_id;
  if (!razorpayPlanId) {
    throw new AppError(ERROR_CODES.PROVIDER_ERROR, "Razorpay plan is missing.");
  }
  const customerId = await ensureRazorpayCustomer(supabase, {
    organizationId: input.organizationId,
    name: input.organizationName,
    email: input.email,
  });
  const live = await getLiveSubscription(supabase, input.organizationId);
  if (live?.razorpay_subscription_id && live.status === "ACTIVE" && live.plan_id === plan.id && live.billing_cycle === input.billingCycle) {
    throw new AppError(ERROR_CODES.CONFLICT, "This workspace already has this subscription.");
  }
  const created = await createRazorpaySubscription({
    planId: razorpayPlanId,
    customerId,
    totalCount: input.billingCycle === "yearly" ? 10 : 120,
    notes: {
      organization_id: input.organizationId,
      plan_id: plan.id,
      billing_cycle: input.billingCycle,
    },
  });
  const razorpaySubscriptionId = String(created.id);
  const amount = amountForCycle(plan, input.billingCycle);
  const now = new Date();
  const period = periodForCycle(input.billingCycle, now);
  let subscriptionId = live?.id;
  if (live) {
    await supabase
      .from("subscriptions")
      .update({
        plan_id: plan.id,
        billing_cycle: input.billingCycle,
        amount_paise: amount,
        order_limit: plan.monthly_order_limit,
        razorpay_subscription_id: razorpaySubscriptionId,
        razorpay_customer_id: customerId,
      })
      .eq("id", live.id);
  } else {
    const { data, error } = await supabase
      .from("subscriptions")
      .insert({
        organization_id: input.organizationId,
        plan_id: plan.id,
        billing_cycle: input.billingCycle,
        status: "TRIAL",
        amount_paise: amount,
        order_limit: plan.monthly_order_limit,
        started_at: now.toISOString(),
        current_period_start: now.toISOString(),
        current_period_end: period.end.toISOString(),
        renews_at: period.end.toISOString(),
        razorpay_subscription_id: razorpaySubscriptionId,
        razorpay_customer_id: customerId,
      })
      .select("id")
      .single();
    if (error || !data) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error?.message || "Could not start subscription.");
    subscriptionId = data.id;
  }
  await writeSubscriptionHistory(supabase, {
    organizationId: input.organizationId,
    subscriptionId: subscriptionId!,
    fromStatus: live?.status ?? null,
    toStatus: live?.status ?? "TRIAL",
    fromPlanId: live?.plan_id ?? null,
    toPlanId: plan.id,
    reason: "checkout_started",
    actor: input.userId,
  });
  await writeBillingAudit(supabase, {
    actorId: input.userId,
    actorType: "USER",
    action: "subscription.checkout_started",
    targetType: "subscription",
    targetId: subscriptionId,
    organizationId: input.organizationId,
    ip: input.ip,
    metadata: { planId: plan.id, billingCycle: input.billingCycle, razorpaySubscriptionId },
  });
  return {
    keyId: razorpay.keyId,
    subscriptionId,
    razorpaySubscriptionId,
    amountPaise: amount,
    currency: "INR",
    plan: mapPlan(plan),
    billingCycle: input.billingCycle,
    name: "PostBus",
    description: `${plan.name} · ${input.billingCycle}`,
  };
}

export async function verifyCheckout(
  supabase: SupabaseClient,
  input: {
    organizationId: string;
    userId: string;
    paymentId: string;
    razorpaySubscriptionId: string;
    signature: string;
    ip?: string | null;
  }
) {
  const razorpay = await getRazorpayConfig();
  if (!razorpay.keySecret) {
    throw new AppError(ERROR_CODES.INTEGRATION_NOT_CONNECTED, "Billing is not configured yet.");
  }
  const valid = verifyCheckoutSignature({
    paymentId: input.paymentId,
    subscriptionId: input.razorpaySubscriptionId,
    signature: input.signature,
    secret: razorpay.keySecret,
  });
  if (!valid) throw new AppError(ERROR_CODES.FORBIDDEN, "Invalid payment signature.");
  const { data: subscription } = await supabase
    .from("subscriptions")
    .select("*, plans(*)")
    .eq("organization_id", input.organizationId)
    .eq("razorpay_subscription_id", input.razorpaySubscriptionId)
    .maybeSingle();
  if (!subscription) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Subscription not found.");
  await activateSubscription(supabase, {
    subscription: subscription as SubscriptionRow,
    paymentId: input.paymentId,
    actor: input.userId,
    reason: "checkout_verified",
  });
  await writeBillingAudit(supabase, {
    actorId: input.userId,
    actorType: "USER",
    action: "subscription.payment_verified",
    targetType: "subscription",
    targetId: subscription.id,
    organizationId: input.organizationId,
    ip: input.ip,
    metadata: { paymentId: input.paymentId },
  });
  return { verified: true, status: "ACTIVE" };
}

export async function activateSubscription(
  supabase: SupabaseClient,
  input: {
    subscription: SubscriptionRow;
    paymentId?: string | null;
    amountPaise?: number | null;
    method?: string | null;
    razorpayOrderId?: string | null;
    razorpayInvoiceId?: string | null;
    periodStart?: Date;
    periodEnd?: Date;
    actor?: string | null;
    reason?: string;
  }
) {
  const plan = asPlan(input.subscription.plans);
  const cycle = input.subscription.billing_cycle;
  const period = periodForCycle(cycle, input.periodStart ?? new Date());
  const periodStart = input.periodStart ?? period.start;
  const periodEnd = input.periodEnd ?? period.end;
  const previous = input.subscription.status;
  await supabase
    .from("subscriptions")
    .update({
      status: "ACTIVE",
      started_at: input.subscription.started_at ?? periodStart.toISOString(),
      current_period_start: periodStart.toISOString(),
      current_period_end: periodEnd.toISOString(),
      renews_at: periodEnd.toISOString(),
      expires_at: periodEnd.toISOString(),
      cancel_at_period_end: false,
      cancelled_at: null,
    })
    .eq("id", input.subscription.id);

  await supabase.from("billing_usage").upsert(
    {
      organization_id: input.subscription.organization_id,
      subscription_id: input.subscription.id,
      period_start: periodStart.toISOString().slice(0, 10),
      period_end: periodEnd.toISOString().slice(0, 10),
      orders_used: 0,
      order_limit: input.subscription.order_limit ?? plan?.monthly_order_limit ?? null,
    },
    { onConflict: "organization_id,period_start" }
  );

  if (input.paymentId) {
    const { data: existingPayment } = await supabase
      .from("payments")
      .select("id")
      .eq("razorpay_payment_id", input.paymentId)
      .maybeSingle();
    if (!existingPayment) {
      await supabase.from("payments").insert({
        organization_id: input.subscription.organization_id,
        subscription_id: input.subscription.id,
        plan_id: input.subscription.plan_id,
        amount_paise: input.amountPaise ?? input.subscription.amount_paise,
        currency: "INR",
        status: "CAPTURED",
        razorpay_payment_id: input.paymentId,
        razorpay_order_id: input.razorpayOrderId ?? null,
        razorpay_invoice_id: input.razorpayInvoiceId ?? null,
        razorpay_subscription_id: input.subscription.razorpay_subscription_id,
        billing_cycle: cycle,
        method: input.method ?? null,
        paid_at: new Date().toISOString(),
      });
    }
    const invoiceNumber = `PB-${periodStart.toISOString().slice(0, 10)}-${input.subscription.id.slice(0, 6)}`;
    await supabase.from("invoices").insert({
      organization_id: input.subscription.organization_id,
      subscription_id: input.subscription.id,
      number: invoiceNumber,
      amount: (input.amountPaise ?? input.subscription.amount_paise) / 100,
      amount_paise: input.amountPaise ?? input.subscription.amount_paise,
      currency: "INR",
      status: "PAID",
      issued_at: new Date().toISOString(),
      paid_at: new Date().toISOString(),
      razorpay_invoice_id: input.razorpayInvoiceId ?? input.paymentId,
      period_start: periodStart.toISOString().slice(0, 10),
      period_end: periodEnd.toISOString().slice(0, 10),
    });
  }

  await writeSubscriptionHistory(supabase, {
    organizationId: input.subscription.organization_id,
    subscriptionId: input.subscription.id,
    fromStatus: previous,
    toStatus: "ACTIVE",
    toPlanId: input.subscription.plan_id,
    reason: input.reason ?? "activated",
    actor: input.actor ?? "WEBHOOK",
  });
  if (previous !== "ACTIVE") {
    await insertBillingNotification(supabase, {
      organizationId: input.subscription.organization_id,
      ...BILLING_NOTICE.activated,
      entityId: input.subscription.id,
    });
  }
}

export async function changePlan(
  supabase: SupabaseClient,
  input: {
    organizationId: string;
    userId: string;
    planId: string;
    billingCycle?: "monthly" | "yearly";
    ip?: string | null;
  }
) {
  const live = await getLiveSubscription(supabase, input.organizationId);
  if (!live) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "No active subscription.");
  const plan = await ensureRazorpayPlanIds(supabase, await loadPlan(supabase, input.planId));
  const cycle = input.billingCycle ?? live.billing_cycle;
  const currentAmount = Number(live.amount_paise);
  const nextAmount = amountForCycle(plan, cycle);
  const upgrade = nextAmount > currentAmount || (live.plan_id === plan.id && cycle === "yearly" && live.billing_cycle === "monthly");
  const razorpayPlanId = cycle === "yearly" ? plan.razorpay_yearly_plan_id : plan.razorpay_monthly_plan_id;
  if (live.razorpay_subscription_id && razorpayPlanId) {
    await updateRazorpaySubscription(live.razorpay_subscription_id, {
      planId: razorpayPlanId,
      scheduleChangeAt: upgrade ? "now" : "cycle_end",
    });
  }
  if (upgrade) {
    await supabase
      .from("subscriptions")
      .update({
        plan_id: plan.id,
        billing_cycle: cycle,
        amount_paise: nextAmount,
        order_limit: plan.monthly_order_limit,
        pending_plan_id: null,
        pending_billing_cycle: null,
      })
      .eq("id", live.id);
    await supabase
      .from("billing_usage")
      .update({ order_limit: plan.monthly_order_limit })
      .eq("subscription_id", live.id)
      .eq("period_start", (live.current_period_start ?? "").slice(0, 10));
  } else {
    await supabase
      .from("subscriptions")
      .update({
        pending_plan_id: plan.id,
        pending_billing_cycle: cycle,
      })
      .eq("id", live.id);
  }
  await writeSubscriptionHistory(supabase, {
    organizationId: input.organizationId,
    subscriptionId: live.id,
    fromStatus: live.status,
    toStatus: live.status,
    fromPlanId: live.plan_id,
    toPlanId: plan.id,
    reason: upgrade ? "upgrade" : "downgrade_scheduled",
    actor: input.userId,
  });
  await writeBillingAudit(supabase, {
    actorId: input.userId,
    actorType: "USER",
    action: upgrade ? "subscription.upgraded" : "subscription.downgrade_scheduled",
    targetType: "subscription",
    targetId: live.id,
    organizationId: input.organizationId,
    ip: input.ip,
    metadata: { planId: plan.id, billingCycle: cycle },
  });
  return { applied: upgrade ? "immediate" : "period_end", plan: mapPlan(plan), billingCycle: cycle };
}

export async function cancelSubscription(
  supabase: SupabaseClient,
  input: { organizationId: string; userId: string; immediate?: boolean; ip?: string | null }
) {
  const live = await getLiveSubscription(supabase, input.organizationId);
  if (!live) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "No active subscription.");
  if (live.razorpay_subscription_id) {
    await cancelRazorpaySubscription(live.razorpay_subscription_id, !input.immediate);
  }
  const nextStatus = input.immediate ? "CANCELLED" : live.status;
  await supabase
    .from("subscriptions")
    .update({
      cancel_at_period_end: !input.immediate,
      cancelled_at: new Date().toISOString(),
      status: nextStatus,
    })
    .eq("id", live.id);
  await writeSubscriptionHistory(supabase, {
    organizationId: input.organizationId,
    subscriptionId: live.id,
    fromStatus: live.status,
    toStatus: nextStatus,
    reason: input.immediate ? "cancelled_immediate" : "cancel_at_period_end",
    actor: input.userId,
  });
  await insertBillingNotification(supabase, {
    organizationId: input.organizationId,
    ...BILLING_NOTICE.cancelled,
    entityId: live.id,
  });
  await writeBillingAudit(supabase, {
    actorId: input.userId,
    actorType: "USER",
    action: "subscription.cancelled",
    targetType: "subscription",
    targetId: live.id,
    organizationId: input.organizationId,
    ip: input.ip,
  });
  return { status: nextStatus, cancelAtPeriodEnd: !input.immediate };
}

export async function resumeSubscription(
  supabase: SupabaseClient,
  input: { organizationId: string; userId: string; ip?: string | null }
) {
  const live = await getLiveSubscription(supabase, input.organizationId);
  if (!live) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "No subscription to resume.");
  if (live.razorpay_subscription_id && live.status === "PAUSED") {
    await resumeRazorpaySubscription(live.razorpay_subscription_id);
  }
  await supabase
    .from("subscriptions")
    .update({ status: "ACTIVE", cancel_at_period_end: false, cancelled_at: null })
    .eq("id", live.id);
  await writeSubscriptionHistory(supabase, {
    organizationId: input.organizationId,
    subscriptionId: live.id,
    fromStatus: live.status,
    toStatus: "ACTIVE",
    reason: "resumed",
    actor: input.userId,
  });
  await writeBillingAudit(supabase, {
    actorId: input.userId,
    actorType: "USER",
    action: "subscription.resumed",
    targetType: "subscription",
    targetId: live.id,
    organizationId: input.organizationId,
    ip: input.ip,
  });
  return { status: "ACTIVE" };
}

export async function pauseSubscriptionAdmin(
  supabase: SupabaseClient,
  subscription: SubscriptionRow
) {
  if (subscription.razorpay_subscription_id) {
    await pauseRazorpaySubscription(subscription.razorpay_subscription_id);
  }
  await supabase.from("subscriptions").update({ status: "PAUSED" }).eq("id", subscription.id);
}

export function unixToDateOrNull(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return new Date(numeric * 1000);
}

export function unixToDate(value: unknown) {
  return unixToDateOrNull(value) ?? new Date();
}

export function periodsMatch(
  subscription: Pick<SubscriptionRow, "current_period_start" | "current_period_end">,
  periodStart?: Date | null,
  periodEnd?: Date | null
) {
  if (!subscription.current_period_start || !subscription.current_period_end || !periodStart || !periodEnd) {
    return false;
  }
  const storedStart = new Date(subscription.current_period_start).getTime();
  const storedEnd = new Date(subscription.current_period_end).getTime();
  return storedStart === periodStart.getTime() && storedEnd === periodEnd.getTime();
}
