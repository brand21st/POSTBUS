import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { getRazorpayConfig } from "@/modules/razorpay/config";
import { BILLING_NOTICE, insertBillingNotification } from "@/lib/notifications/billing";
import { writeBillingAudit, writeSubscriptionHistory } from "@/modules/billing/audit";
import { mergeFullPlanFeatures } from "@/modules/billing/plan-features";
import { amountForCycle } from "@/modules/billing/prices";
import { LIVE_STATUSES } from "@/modules/billing/usage";
import { NEW_TRIAL_DAYS } from "@/modules/billing/trial-policy";
import {
  cancelRazorpaySubscription,
  createRazorpayCustomer,
  createRazorpayOrder,
  createRazorpayPlan,
  fetchRazorpayPayment,
  pauseRazorpaySubscription,
} from "@/modules/razorpay/client";
import { verifyCheckoutSignature, verifyOrderCheckoutSignature } from "@/modules/razorpay/signature";

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
  trial_cohort?: string | null;
  trial_manual_override?: boolean | null;
  pending_plan_id: string | null;
  pending_billing_cycle: string | null;
  razorpay_subscription_id: string | null;
  razorpay_customer_id: string | null;
  razorpay_order_id: string | null;
  plans?: PlanRow | PlanRow[] | null;
};

/** Two FKs to plans (plan_id, pending_plan_id) — hint the current plan or PostgREST returns no row. */
const SUBSCRIPTION_WITH_PLAN = "*, plans!plan_id(*)";

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
  trialDays = NEW_TRIAL_DAYS
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
    .select(SUBSCRIPTION_WITH_PLAN)
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
  const plan = await loadPlan(supabase, input.planId);
  const amount = amountForCycle(plan, input.billingCycle);
  if (!Number.isFinite(amount) || amount < 100) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "This plan cannot be paid online.");
  }
  const customerId = await ensureRazorpayCustomer(supabase, {
    organizationId: input.organizationId,
    name: input.organizationName,
    email: input.email,
  }).catch(() => null);
  const now = new Date();
  // The chosen plan lives on the PENDING payment row until payment is verified
  // (applyCheckoutIntent). Writing it to the live subscription here would grant
  // the plan to anyone who opens checkout and closes it.
  const live = await getLiveSubscription(supabase, input.organizationId);
  let subscriptionId = live?.id;
  if (live) {
    if (customerId && customerId !== live.razorpay_customer_id) {
      await supabase.from("subscriptions").update({ razorpay_customer_id: customerId }).eq("id", live.id);
    }
  } else {
    // Not live until paid: a TRIAL row here would unlock every feature for a full period.
    const { data, error } = await supabase
      .from("subscriptions")
      .insert({
        organization_id: input.organizationId,
        plan_id: plan.id,
        billing_cycle: input.billingCycle,
        amount_paise: amount,
        order_limit: plan.monthly_order_limit,
        status: "EXPIRED",
        current_period_start: now.toISOString(),
        current_period_end: now.toISOString(),
        razorpay_customer_id: customerId,
      })
      .select("id")
      .single();
    if (error || !data) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, error?.message || "Could not start subscription.");
    }
    subscriptionId = data.id;
  }
  const order = await createRazorpayOrder({
    amountPaise: amount,
    receipt: `pb_${input.organizationId.replace(/-/g, "").slice(0, 10)}_${Date.now()}`.slice(0, 40),
    notes: {
      organization_id: input.organizationId,
      subscription_id: subscriptionId!,
      plan_id: plan.id,
      billing_cycle: input.billingCycle,
    },
  });
  const razorpayOrderId = String(order.id);
  await supabase
    .from("subscriptions")
    .update({ razorpay_order_id: razorpayOrderId })
    .eq("id", subscriptionId!);
  await supabase.from("payments").insert({
    organization_id: input.organizationId,
    subscription_id: subscriptionId,
    plan_id: plan.id,
    amount_paise: amount,
    currency: "INR",
    status: "PENDING",
    razorpay_order_id: razorpayOrderId,
    billing_cycle: input.billingCycle,
  });
  await writeSubscriptionHistory(supabase, {
    organizationId: input.organizationId,
    subscriptionId: subscriptionId!,
    fromStatus: live?.status ?? null,
    toStatus: live?.status ?? "EXPIRED",
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
    metadata: { planId: plan.id, billingCycle: input.billingCycle, razorpayOrderId },
  });
  return {
    keyId: razorpay.keyId,
    subscriptionId,
    razorpayOrderId,
    amountPaise: amount,
    currency: "INR",
    plan: mapPlan(plan),
    billingCycle: input.billingCycle,
    name: "PostBus",
    description: `${plan.name} · ${input.billingCycle === "yearly" ? "yearly" : "monthly"}`,
    prefill: {
      email: input.email ?? "",
      name: input.organizationName,
    },
  };
}

export async function verifyCheckout(
  supabase: SupabaseClient,
  input: {
    organizationId: string;
    userId: string;
    paymentId: string;
    razorpayOrderId: string;
    razorpaySubscriptionId?: string | null;
    signature: string;
    ip?: string | null;
  }
) {
  const razorpay = await getRazorpayConfig();
  if (!razorpay.keySecret) {
    throw new AppError(ERROR_CODES.INTEGRATION_NOT_CONNECTED, "Billing is not configured yet.");
  }
  const orderValid = verifyOrderCheckoutSignature({
    orderId: input.razorpayOrderId,
    paymentId: input.paymentId,
    signature: input.signature,
    secret: razorpay.keySecret,
  });
  const subscriptionValid = input.razorpaySubscriptionId
    ? verifyCheckoutSignature({
        paymentId: input.paymentId,
        subscriptionId: input.razorpaySubscriptionId,
        signature: input.signature,
        secret: razorpay.keySecret,
      })
    : false;
  if (!orderValid && !subscriptionValid) {
    throw new AppError(ERROR_CODES.FORBIDDEN, "Invalid payment signature.");
  }
  const payment = await fetchRazorpayPayment(input.paymentId);
  const status = String(payment.status ?? "");
  if (status !== "captured" && status !== "authorized") {
    throw new AppError(ERROR_CODES.PROVIDER_ERROR, "Payment was not captured.");
  }
  const orderId = String(payment.order_id ?? input.razorpayOrderId);
  const { fulfillCapturedAiCreditPayment } = await import("@/modules/ai-credits/service");
  const credits = await fulfillCapturedAiCreditPayment(supabase, {
    razorpayOrderId: orderId,
    razorpayPaymentId: input.paymentId,
    amountPaise: Number(payment.amount),
    method: payment.method ? String(payment.method) : null,
    organizationId: input.organizationId,
  });
  if (credits.handled) {
    if (credits.forbidden) {
      throw new AppError(ERROR_CODES.FORBIDDEN, "This payment does not belong to your workspace.");
    }
    if (credits.amountMismatch) {
      throw new AppError(ERROR_CODES.FORBIDDEN, "Paid amount does not match the AI credit pack.");
    }
    await writeBillingAudit(supabase, {
      actorId: input.userId,
      actorType: "USER",
      action: "ai_credits.payment_verified",
      targetType: "payment",
      targetId: orderId,
      organizationId: input.organizationId,
      ip: input.ip,
      metadata: { paymentId: input.paymentId, razorpayOrderId: orderId, remaining: credits.remaining },
    });
    return { verified: true, creditsRemaining: credits.remaining };
  }
  const { activateAddonFromPayment } = await import("@/modules/addons/activate");
  const addon = await activateAddonFromPayment(supabase, {
    razorpayOrderId: orderId,
    razorpayPaymentId: input.paymentId,
    amountPaise: Number(payment.amount),
    method: payment.method ? String(payment.method) : null,
    organizationId: input.organizationId,
    actor: input.userId,
  });
  if (addon.handled) {
    if (addon.forbidden) {
      throw new AppError(ERROR_CODES.FORBIDDEN, "This payment does not belong to your workspace.");
    }
    if (addon.amountMismatch) {
      throw new AppError(ERROR_CODES.FORBIDDEN, "Paid amount does not match the add-on price.");
    }
    await writeBillingAudit(supabase, {
      actorId: input.userId,
      actorType: "USER",
      action: "addon.payment_verified",
      targetType: "addon_subscription",
      targetId: addon.addonSubscriptionId,
      organizationId: input.organizationId,
      ip: input.ip,
      metadata: { paymentId: input.paymentId, razorpayOrderId: orderId, slug: addon.slug },
    });
    return { verified: true, status: "ACTIVE", addon: addon.slug };
  }
  const { data: pendingPayment } = await supabase
    .from("payments")
    .select("subscription_id")
    .eq("organization_id", input.organizationId)
    .eq("razorpay_order_id", orderId)
    .not("subscription_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const { data: found } = pendingPayment?.subscription_id
    ? await supabase
        .from("subscriptions")
        .select(SUBSCRIPTION_WITH_PLAN)
        .eq("organization_id", input.organizationId)
        .eq("id", pendingPayment.subscription_id)
        .maybeSingle()
    : await supabase
        .from("subscriptions")
        .select(SUBSCRIPTION_WITH_PLAN)
        .eq("organization_id", input.organizationId)
        .eq("razorpay_order_id", orderId)
        .maybeSingle();
  if (!found) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Checkout order not found.");
  const subscription = await applyCheckoutIntent(supabase, found as SubscriptionRow, orderId, Number(payment.amount));
  const expectedAmount = Number(subscription.amount_paise);
  if (Number(payment.amount) !== expectedAmount) {
    throw new AppError(ERROR_CODES.FORBIDDEN, "Paid amount does not match the selected plan.");
  }
  await activateSubscription(supabase, {
    subscription,
    paymentId: input.paymentId,
    amountPaise: Number(payment.amount),
    method: payment.method ? String(payment.method) : null,
    razorpayOrderId: orderId,
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
    metadata: { paymentId: input.paymentId, razorpayOrderId: orderId },
  });
  return { verified: true, status: "ACTIVE" };
}

/**
 * Copy the plan chosen at checkout (kept on the PENDING payment row) onto the
 * subscription. Call only after the payment for `razorpayOrderId` is proven.
 * Returns the subscription unchanged when there is no pending intent or the
 * paid amount does not match it.
 */
export async function applyCheckoutIntent(
  supabase: SupabaseClient,
  subscription: SubscriptionRow,
  razorpayOrderId: string | null | undefined,
  paidAmountPaise?: number | null
): Promise<SubscriptionRow> {
  if (!razorpayOrderId) return subscription;
  const { data: intent } = await supabase
    .from("payments")
    .select("plan_id, billing_cycle, amount_paise")
    .eq("subscription_id", subscription.id)
    .eq("razorpay_order_id", razorpayOrderId)
    .eq("status", "PENDING")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const cycle = intent?.billing_cycle;
  if (!intent?.plan_id || (cycle !== "monthly" && cycle !== "yearly")) return subscription;
  if (paidAmountPaise != null && Number(intent.amount_paise) !== Number(paidAmountPaise)) return subscription;
  const unchanged =
    intent.plan_id === subscription.plan_id &&
    cycle === subscription.billing_cycle &&
    Number(intent.amount_paise) === Number(subscription.amount_paise);
  if (unchanged) return subscription;
  const { data: plan } = await supabase.from("plans").select("monthly_order_limit").eq("id", intent.plan_id).maybeSingle();
  await supabase
    .from("subscriptions")
    .update({
      plan_id: intent.plan_id,
      billing_cycle: cycle,
      amount_paise: Number(intent.amount_paise),
      order_limit: plan?.monthly_order_limit ?? subscription.order_limit,
      pending_plan_id: null,
      pending_billing_cycle: null,
    })
    .eq("id", subscription.id);
  const { data: refreshed } = await supabase
    .from("subscriptions")
    .select(SUBSCRIPTION_WITH_PLAN)
    .eq("id", subscription.id)
    .maybeSingle();
  return (refreshed as SubscriptionRow | null) ?? subscription;
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
  if (
    input.amountPaise != null &&
    Number.isFinite(input.amountPaise) &&
    Number(input.subscription.amount_paise) !== Number(input.amountPaise)
  ) {
    throw new AppError(ERROR_CODES.FORBIDDEN, "Paid amount does not match the selected plan.");
  }
  if (input.paymentId) {
    const { data: alreadyPaid } = await supabase
      .from("payments")
      .select("id, status")
      .eq("razorpay_payment_id", input.paymentId)
      .maybeSingle();
    if (alreadyPaid?.status === "CAPTURED") return;
  }
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
      .select("id, status")
      .eq("razorpay_payment_id", input.paymentId)
      .maybeSingle();
    const payload = {
      organization_id: input.subscription.organization_id,
      subscription_id: input.subscription.id,
      plan_id: input.subscription.plan_id,
      amount_paise: input.amountPaise ?? input.subscription.amount_paise,
      currency: "INR",
      status: "CAPTURED" as const,
      razorpay_payment_id: input.paymentId,
      razorpay_order_id: input.razorpayOrderId ?? null,
      razorpay_invoice_id: input.razorpayInvoiceId ?? null,
      razorpay_subscription_id: input.subscription.razorpay_subscription_id,
      billing_cycle: cycle,
      method: input.method ?? null,
      paid_at: new Date().toISOString(),
    };
    if (existingPayment) {
      if (existingPayment.status !== "CAPTURED") {
        await supabase.from("payments").update(payload).eq("id", existingPayment.id);
      }
    } else {
      const { data: pendingRows } = input.razorpayOrderId
        ? await supabase
            .from("payments")
            .select("id")
            .eq("razorpay_order_id", input.razorpayOrderId)
            .eq("status", "PENDING")
            .order("created_at", { ascending: false })
            .limit(1)
        : { data: null as { id: string }[] | null };
      const pending = pendingRows?.[0];
      if (pending?.id) {
        await supabase.from("payments").update(payload).eq("id", pending.id);
      } else {
        await supabase.from("payments").insert(payload);
      }
    }
    const invoiceNumber = `PB-${periodStart.toISOString().slice(0, 10)}-${input.subscription.id.slice(0, 6)}`;
    const { data: existingInvoice } = await supabase
      .from("invoices")
      .select("id")
      .eq("razorpay_invoice_id", input.razorpayInvoiceId ?? input.paymentId)
      .maybeSingle();
    if (!existingInvoice) {
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

export async function adminAssignPlan(
  supabase: SupabaseClient,
  input: {
    organizationId: string;
    userId: string;
    planId: string;
    billingCycle?: "monthly" | "yearly";
    ip?: string | null;
  }
) {
  const { data: planRow, error: planError } = await supabase
    .from("plans")
    .select("*")
    .eq("id", input.planId)
    .maybeSingle();
  if (planError || !planRow) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Plan not found.");
  const plan = planRow as PlanRow;
  let live = await getLiveSubscription(supabase, input.organizationId);
  const cycle = input.billingCycle ?? live?.billing_cycle ?? "monthly";
  const amount = amountForCycle(plan, cycle);
  const now = new Date();
  const period = periodForCycle(cycle, now);
  const patch = {
    plan_id: plan.id,
    billing_cycle: cycle,
    amount_paise: amount,
    order_limit: plan.monthly_order_limit,
    pending_plan_id: null,
    pending_billing_cycle: null,
  };
  let subscriptionId = live?.id;
  let fromStatus = live?.status ?? null;
  let fromPlanId = live?.plan_id ?? null;
  if (live) {
    await supabase.from("subscriptions").update(patch).eq("id", live.id);
  } else {
    const { data, error } = await supabase
      .from("subscriptions")
      .insert({
        organization_id: input.organizationId,
        ...patch,
        status: "ACTIVE",
        started_at: now.toISOString(),
        current_period_start: now.toISOString(),
        current_period_end: period.end.toISOString(),
        renews_at: period.end.toISOString(),
        expires_at: period.end.toISOString(),
      })
      .select("id")
      .single();
    const duplicateLive =
      error?.code === "23505" || /one_live_per_org|duplicate key/i.test(error?.message ?? "");
    if (duplicateLive) {
      const existing = await getLiveSubscription(supabase, input.organizationId);
      if (!existing) {
        throw new AppError(ERROR_CODES.VALIDATION_ERROR, error?.message || "Could not assign plan.");
      }
      live = existing;
      subscriptionId = existing.id;
      fromStatus = existing.status;
      fromPlanId = existing.plan_id;
      await supabase.from("subscriptions").update(patch).eq("id", existing.id);
    } else if (error || !data) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, error?.message || "Could not assign plan.");
    } else {
      subscriptionId = data.id;
    }
  }
  const periodStart = (live?.current_period_start ?? now.toISOString()).slice(0, 10);
  const periodEnd = (live?.current_period_end ?? period.end.toISOString()).slice(0, 10);
  const { data: usage } = await supabase
    .from("billing_usage")
    .select("id")
    .eq("organization_id", input.organizationId)
    .eq("period_start", periodStart)
    .maybeSingle();
  if (usage?.id) {
    await supabase
      .from("billing_usage")
      .update({
        subscription_id: subscriptionId,
        period_end: periodEnd,
        order_limit: plan.monthly_order_limit,
      })
      .eq("id", usage.id);
  } else {
    await supabase.from("billing_usage").insert({
      organization_id: input.organizationId,
      subscription_id: subscriptionId,
      period_start: periodStart,
      period_end: periodEnd,
      orders_used: 0,
      order_limit: plan.monthly_order_limit,
    });
  }
  await writeSubscriptionHistory(supabase, {
    organizationId: input.organizationId,
    subscriptionId: subscriptionId!,
    fromStatus,
    toStatus: live?.status ?? "ACTIVE",
    fromPlanId,
    toPlanId: plan.id,
    reason: "admin_change_plan",
    actor: input.userId,
  });
  await writeBillingAudit(supabase, {
    actorId: input.userId,
    actorType: "SUPER_ADMIN",
    action: "subscription.plan_changed",
    targetType: "subscription",
    targetId: subscriptionId,
    organizationId: input.organizationId,
    ip: input.ip,
    metadata: { planId: plan.id, billingCycle: cycle },
  });
  const { scheduleSheetsCrmEvent } = await import("@/modules/sheets-crm/enqueue");
  scheduleSheetsCrmEvent({
    eventType: "subscription.updated",
    organizationId: input.organizationId,
  });
  return { ok: true, plan: mapPlan(plan), billingCycle: cycle };
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
  const plan = await loadPlan(supabase, input.planId);
  const cycle = input.billingCycle ?? live.billing_cycle;
  const currentAmount = Number(live.amount_paise);
  const nextAmount = amountForCycle(plan, cycle);
  const upgrade = nextAmount > currentAmount || (live.plan_id === plan.id && cycle === "yearly" && live.billing_cycle === "monthly");
  if (upgrade) {
    // Nothing is charged here, so an upgrade must go through checkout.
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Upgrades need payment. Choose the plan under Pay for a plan.");
  }
  await supabase
    .from("subscriptions")
    .update({
      pending_plan_id: plan.id,
      pending_billing_cycle: cycle,
    })
    .eq("id", live.id);
  await writeSubscriptionHistory(supabase, {
    organizationId: input.organizationId,
    subscriptionId: live.id,
    fromStatus: live.status,
    toStatus: live.status,
    fromPlanId: live.plan_id,
    toPlanId: plan.id,
    reason: "downgrade_scheduled",
    actor: input.userId,
  });
  await writeBillingAudit(supabase, {
    actorId: input.userId,
    actorType: "USER",
    action: "subscription.downgrade_scheduled",
    targetType: "subscription",
    targetId: live.id,
    organizationId: input.organizationId,
    ip: input.ip,
    metadata: { planId: plan.id, billingCycle: cycle },
  });
  return { applied: "period_end", plan: mapPlan(plan), billingCycle: cycle };
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
  // Only undo a scheduled cancellation. Status stays as it was: forcing ACTIVE
  // here turned trials and unpaid subscriptions into paid ones that never expire.
  if (live.status === "PAUSED") {
    throw new AppError(ERROR_CODES.FORBIDDEN, "This subscription was paused by PostBus support. Contact support to resume it.");
  }
  if (!live.cancel_at_period_end) return { status: live.status };
  if (live.razorpay_subscription_id) {
    // Razorpay cannot undo a cancellation, so renewals would silently stop.
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "This cancellation cannot be undone. Pay for a plan again when the current period ends.");
  }
  await supabase
    .from("subscriptions")
    .update({ cancel_at_period_end: false, cancelled_at: null })
    .eq("id", live.id);
  await writeSubscriptionHistory(supabase, {
    organizationId: input.organizationId,
    subscriptionId: live.id,
    fromStatus: live.status,
    toStatus: live.status,
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
  return { status: live.status };
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
