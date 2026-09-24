import type { SupabaseClient } from "@supabase/supabase-js";
import { logError, logInfo } from "@/lib/logger";
import { BILLING_NOTICE, insertBillingNotification } from "@/lib/notifications/billing";
import { writeBillingAudit, writeSubscriptionHistory } from "@/modules/billing/audit";
import {
  activateSubscription,
  periodsMatch,
  unixToDate,
  unixToDateOrNull,
  type SubscriptionRow,
} from "@/modules/billing/subscriptions";
import { fetchRazorpaySubscription } from "@/modules/razorpay/client";

export function razorpayWebhookEventId(headerId: string, event: string | undefined, rawBody: string) {
  return headerId || `${event ?? "event"}:${Buffer.from(rawBody).toString("base64").slice(0, 40)}`;
}

export function isUniqueViolation(error: { code?: string } | null | undefined) {
  return error?.code === "23505";
}

type RazorpayPayload = {
  event?: string;
  payload?: {
    subscription?: { entity?: Record<string, unknown> };
    payment?: { entity?: Record<string, unknown> };
    refund?: { entity?: Record<string, unknown> };
    invoice?: { entity?: Record<string, unknown> };
  };
};

function entity(payload: RazorpayPayload, key: "subscription" | "payment" | "refund" | "invoice") {
  return payload.payload?.[key]?.entity ?? {};
}

async function loadSubscription(supabase: SupabaseClient, razorpaySubscriptionId?: string | null) {
  if (!razorpaySubscriptionId) return null;
  const { data } = await supabase
    .from("subscriptions")
    .select("*, plans!plan_id(*)")
    .eq("razorpay_subscription_id", razorpaySubscriptionId)
    .maybeSingle();
  return data as SubscriptionRow | null;
}

async function loadSubscriptionByOrderId(supabase: SupabaseClient, razorpayOrderId?: string | null) {
  if (!razorpayOrderId) return null;
  const { data } = await supabase
    .from("subscriptions")
    .select("*, plans!plan_id(*)")
    .eq("razorpay_order_id", razorpayOrderId)
    .maybeSingle();
  if (data) return data as SubscriptionRow;
  const { data: payment } = await supabase
    .from("payments")
    .select("subscription_id")
    .eq("razorpay_order_id", razorpayOrderId)
    .not("subscription_id", "is", null)
    .maybeSingle();
  if (!payment?.subscription_id) return null;
  const { data: byPayment } = await supabase
    .from("subscriptions")
    .select("*, plans!plan_id(*)")
    .eq("id", payment.subscription_id)
    .maybeSingle();
  return (byPayment as SubscriptionRow | null) ?? null;
}

async function resolveSubscriptionEntity(entityRow: Record<string, unknown>, razorpaySubscriptionId: string) {
  const hasPeriod = Boolean(unixToDateOrNull(entityRow.current_start) && unixToDateOrNull(entityRow.current_end));
  if (hasPeriod || !razorpaySubscriptionId) return entityRow;
  try {
    const remote = await fetchRazorpaySubscription(razorpaySubscriptionId);
    return { ...entityRow, ...remote };
  } catch (error) {
    logError("razorpay.subscription_fetch_failed", {
      razorpaySubscriptionId,
      message: error instanceof Error ? error.message : "unknown",
    });
    return entityRow;
  }
}

async function applyPendingPlanChange(supabase: SupabaseClient, subscription: SubscriptionRow) {
  if (!subscription.pending_plan_id) return;
  await supabase
    .from("subscriptions")
    .update({
      plan_id: subscription.pending_plan_id,
      billing_cycle: subscription.pending_billing_cycle ?? subscription.billing_cycle,
      pending_plan_id: null,
      pending_billing_cycle: null,
    })
    .eq("id", subscription.id);
}

async function applyBillingCycleCharge(
  supabase: SupabaseClient,
  input: {
    subscription: SubscriptionRow;
    subscriptionEntity: Record<string, unknown>;
    paymentEntity: Record<string, unknown>;
    invoiceEntity?: Record<string, unknown>;
    event: string;
  }
) {
  const periodStart = unixToDateOrNull(input.subscriptionEntity.current_start);
  const periodEnd = unixToDateOrNull(input.subscriptionEntity.current_end);
  if (periodsMatch(input.subscription, periodStart, periodEnd)) return;
  const wasActive = input.subscription.status === "ACTIVE";
  await activateSubscription(supabase, {
    subscription: input.subscription,
    paymentId: input.paymentEntity.id ? String(input.paymentEntity.id) : null,
    amountPaise: input.paymentEntity.amount
      ? Number(input.paymentEntity.amount)
      : input.invoiceEntity?.amount
        ? Number(input.invoiceEntity.amount)
        : null,
    method: input.paymentEntity.method ? String(input.paymentEntity.method) : null,
    razorpayOrderId: input.paymentEntity.order_id ? String(input.paymentEntity.order_id) : null,
    razorpayInvoiceId: input.invoiceEntity?.id
      ? String(input.invoiceEntity.id)
      : input.paymentEntity.invoice_id
        ? String(input.paymentEntity.invoice_id)
        : null,
    periodStart: periodStart ?? unixToDate(input.subscriptionEntity.current_start),
    periodEnd: periodEnd ?? unixToDate(input.subscriptionEntity.current_end),
    actor: "WEBHOOK",
    reason: input.event,
  });
  await applyPendingPlanChange(supabase, input.subscription);
  if (wasActive) {
    await insertBillingNotification(supabase, {
      organizationId: input.subscription.organization_id,
      ...BILLING_NOTICE.renewal,
      entityId: input.subscription.id,
    });
  }
  if (input.paymentEntity.id) {
    await insertBillingNotification(supabase, {
      organizationId: input.subscription.organization_id,
      ...BILLING_NOTICE.paymentSuccess,
      entityId: input.subscription.id,
    });
  }
}

async function upsertPayment(
  supabase: SupabaseClient,
  input: {
    organizationId: string;
    subscriptionId?: string | null;
    planId?: string | null;
    amountPaise: number;
    status: "PENDING" | "CAPTURED" | "FAILED" | "REFUNDED";
    razorpayPaymentId?: string | null;
    razorpayOrderId?: string | null;
    razorpayInvoiceId?: string | null;
    razorpaySubscriptionId?: string | null;
    billingCycle?: string | null;
    method?: string | null;
    failureReason?: string | null;
    paidAt?: string | null;
  }
) {
  if (!input.razorpayPaymentId) return;
  const { data: existing } = await supabase
    .from("payments")
    .select("id")
    .eq("razorpay_payment_id", input.razorpayPaymentId)
    .maybeSingle();
  if (existing) {
    await supabase
      .from("payments")
      .update({
        status: input.status,
        failure_reason: input.failureReason ?? null,
        paid_at: input.paidAt ?? null,
        refunded_at: input.status === "REFUNDED" ? new Date().toISOString() : null,
        method: input.method ?? null,
      })
      .eq("id", existing.id);
    return;
  }
  await supabase.from("payments").insert({
    organization_id: input.organizationId,
    subscription_id: input.subscriptionId ?? null,
    plan_id: input.planId ?? null,
    amount_paise: input.amountPaise,
    currency: "INR",
    status: input.status,
    razorpay_payment_id: input.razorpayPaymentId,
    razorpay_order_id: input.razorpayOrderId ?? null,
    razorpay_invoice_id: input.razorpayInvoiceId ?? null,
    razorpay_subscription_id: input.razorpaySubscriptionId ?? null,
    billing_cycle: input.billingCycle ?? null,
    method: input.method ?? null,
    failure_reason: input.failureReason ?? null,
    paid_at: input.paidAt ?? null,
  });
}

async function syncPlanFromRazorpay(
  supabase: SupabaseClient,
  subscription: SubscriptionRow,
  subscriptionEntity: Record<string, unknown>
) {
  const razorpayPlanId = String(subscriptionEntity.plan_id ?? "");
  if (!razorpayPlanId) return;
  const { data: monthly } = await supabase
    .from("plans")
    .select("*")
    .eq("razorpay_monthly_plan_id", razorpayPlanId)
    .maybeSingle();
  let plan = monthly;
  let billingCycle: "monthly" | "yearly" = "monthly";
  if (!plan) {
    const { data: yearly } = await supabase
      .from("plans")
      .select("*")
      .eq("razorpay_yearly_plan_id", razorpayPlanId)
      .maybeSingle();
    plan = yearly;
    billingCycle = "yearly";
  }
  if (!plan) return;
  const periodStart = unixToDateOrNull(subscriptionEntity.current_start);
  const periodEnd = unixToDateOrNull(subscriptionEntity.current_end);
  const patch: Record<string, unknown> = {
    plan_id: plan.id,
    billing_cycle: billingCycle,
  };
  if (periodStart) patch.current_period_start = periodStart.toISOString();
  if (periodEnd) {
    patch.current_period_end = periodEnd.toISOString();
    patch.renews_at = periodEnd.toISOString();
  }
  await supabase.from("subscriptions").update(patch).eq("id", subscription.id);
}

export async function processRazorpayEvent(
  supabase: SupabaseClient,
  payload: RazorpayPayload,
  eventId: string
) {
  const event = payload.event ?? "";
  let subscriptionEntity = entity(payload, "subscription");
  const paymentEntity = entity(payload, "payment");
  const refundEntity = entity(payload, "refund");
  const invoiceEntity = entity(payload, "invoice");
  const razorpaySubscriptionId = String(
    subscriptionEntity.id ?? paymentEntity.subscription_id ?? invoiceEntity.subscription_id ?? ""
  );
  const razorpayOrderId = String(paymentEntity.order_id ?? invoiceEntity.order_id ?? "");
  const subscription =
    (await loadSubscription(supabase, razorpaySubscriptionId || null)) ??
    (await loadSubscriptionByOrderId(supabase, razorpayOrderId || null));

  logInfo("razorpay.webhook", { event, eventId, razorpaySubscriptionId, razorpayOrderId });

  if (!subscription && (event.startsWith("subscription.") || event === "invoice.paid")) {
    logError("razorpay.webhook_unmatched_subscription", { event, razorpaySubscriptionId });
    return { ignored: true };
  }

  if (event === "subscription.authenticated" && subscription) {
    await supabase
      .from("subscriptions")
      .update({
        razorpay_subscription_id: razorpaySubscriptionId || subscription.razorpay_subscription_id,
      })
      .eq("id", subscription.id);
    await writeSubscriptionHistory(supabase, {
      organizationId: subscription.organization_id,
      subscriptionId: subscription.id,
      fromStatus: subscription.status,
      toStatus: subscription.status,
      reason: event,
      actor: "WEBHOOK",
    });
  }

  if (event === "subscription.activated" && subscription) {
    subscriptionEntity = await resolveSubscriptionEntity(subscriptionEntity, razorpaySubscriptionId);
    await activateSubscription(supabase, {
      subscription,
      paymentId: paymentEntity.id ? String(paymentEntity.id) : null,
      amountPaise: paymentEntity.amount ? Number(paymentEntity.amount) : null,
      method: paymentEntity.method ? String(paymentEntity.method) : null,
      razorpayOrderId: paymentEntity.order_id ? String(paymentEntity.order_id) : null,
      razorpayInvoiceId: paymentEntity.invoice_id ? String(paymentEntity.invoice_id) : null,
      periodStart: unixToDate(subscriptionEntity.current_start || subscriptionEntity.start_at),
      periodEnd: unixToDate(subscriptionEntity.current_end || subscriptionEntity.end_at),
      actor: "WEBHOOK",
      reason: "subscription.activated",
    });
  }

  if ((event === "subscription.charged" || event === "invoice.paid") && subscription) {
    if (event === "invoice.paid" && !invoiceEntity.subscription_id && !subscriptionEntity.id) {
      return { ignored: true };
    }
    subscriptionEntity = await resolveSubscriptionEntity(subscriptionEntity, razorpaySubscriptionId);
    await applyBillingCycleCharge(supabase, {
      subscription,
      subscriptionEntity,
      paymentEntity: {
        ...paymentEntity,
        id: paymentEntity.id ?? invoiceEntity.payment_id,
        amount: paymentEntity.amount ?? invoiceEntity.amount,
        invoice_id: paymentEntity.invoice_id ?? invoiceEntity.id,
      },
      invoiceEntity,
      event,
    });
  }

  if (event === "subscription.updated" && subscription) {
    subscriptionEntity = await resolveSubscriptionEntity(subscriptionEntity, razorpaySubscriptionId);
    await syncPlanFromRazorpay(supabase, subscription, subscriptionEntity);
  }

  if (event === "subscription.pending" && subscription) {
    await supabase.from("subscriptions").update({ status: "PAST_DUE" }).eq("id", subscription.id);
    await writeSubscriptionHistory(supabase, {
      organizationId: subscription.organization_id,
      subscriptionId: subscription.id,
      fromStatus: subscription.status,
      toStatus: "PAST_DUE",
      reason: event,
      actor: "WEBHOOK",
    });
  }

  if (event === "payment.failed" && subscription) {
    if (subscription.status !== "TRIAL") {
      await supabase.from("subscriptions").update({ status: "PAYMENT_FAILED" }).eq("id", subscription.id);
      await writeSubscriptionHistory(supabase, {
        organizationId: subscription.organization_id,
        subscriptionId: subscription.id,
        fromStatus: subscription.status,
        toStatus: "PAYMENT_FAILED",
        reason: event,
        actor: "WEBHOOK",
      });
    }
    await upsertPayment(supabase, {
      organizationId: subscription.organization_id,
      subscriptionId: subscription.id,
      planId: subscription.plan_id,
      amountPaise: Number(paymentEntity.amount ?? subscription.amount_paise ?? 0),
      status: "FAILED",
      razorpayPaymentId: paymentEntity.id ? String(paymentEntity.id) : `failed-${eventId}`,
      razorpayOrderId: razorpayOrderId || null,
      razorpaySubscriptionId,
      billingCycle: subscription.billing_cycle,
      failureReason: String(paymentEntity.error_description ?? paymentEntity.error_reason ?? "Payment failed"),
    });
    await insertBillingNotification(supabase, {
      organizationId: subscription.organization_id,
      ...BILLING_NOTICE.paymentFailed,
      entityId: subscription.id,
    });
  }

  if (event === "subscription.halted" && subscription) {
    await supabase.from("subscriptions").update({ status: "PAYMENT_FAILED" }).eq("id", subscription.id);
    await writeSubscriptionHistory(supabase, {
      organizationId: subscription.organization_id,
      subscriptionId: subscription.id,
      fromStatus: subscription.status,
      toStatus: "PAYMENT_FAILED",
      reason: event,
      actor: "WEBHOOK",
    });
  }

  if (event === "subscription.paused" && subscription) {
    await supabase.from("subscriptions").update({ status: "PAUSED" }).eq("id", subscription.id);
    await writeSubscriptionHistory(supabase, {
      organizationId: subscription.organization_id,
      subscriptionId: subscription.id,
      fromStatus: subscription.status,
      toStatus: "PAUSED",
      reason: event,
      actor: "WEBHOOK",
    });
  }

  if (event === "subscription.resumed" && subscription) {
    await supabase.from("subscriptions").update({ status: "ACTIVE" }).eq("id", subscription.id);
    await writeSubscriptionHistory(supabase, {
      organizationId: subscription.organization_id,
      subscriptionId: subscription.id,
      fromStatus: subscription.status,
      toStatus: "ACTIVE",
      reason: event,
      actor: "WEBHOOK",
    });
  }

  if (event === "subscription.cancelled" && subscription) {
    const keepActive = subscription.cancel_at_period_end && subscription.current_period_end
      ? new Date(subscription.current_period_end) > new Date()
      : false;
    const next = keepActive ? "ACTIVE" : "CANCELLED";
    await supabase
      .from("subscriptions")
      .update({
        status: next,
        cancel_at_period_end: true,
        cancelled_at: new Date().toISOString(),
      })
      .eq("id", subscription.id);
    await writeSubscriptionHistory(supabase, {
      organizationId: subscription.organization_id,
      subscriptionId: subscription.id,
      fromStatus: subscription.status,
      toStatus: next,
      reason: event,
      actor: "WEBHOOK",
    });
  }

  if (event === "subscription.completed" && subscription) {
    await supabase.from("subscriptions").update({ status: "EXPIRED" }).eq("id", subscription.id);
    await writeSubscriptionHistory(supabase, {
      organizationId: subscription.organization_id,
      subscriptionId: subscription.id,
      fromStatus: subscription.status,
      toStatus: "EXPIRED",
      reason: event,
      actor: "WEBHOOK",
    });
  }

  if (event === "payment.captured") {
    const orderId = paymentEntity.order_id ? String(paymentEntity.order_id) : razorpayOrderId || null;
    const paid = subscription ?? (await loadSubscriptionByOrderId(supabase, orderId));
    if (
      paid &&
      paymentEntity.amount != null &&
      Number(paid.amount_paise) !== Number(paymentEntity.amount)
    ) {
      logError("razorpay.webhook_amount_mismatch", {
        event,
        expected: paid.amount_paise,
        received: paymentEntity.amount,
        orderId,
      });
      return { ignored: true };
    }
    if (paid && paymentEntity.id) {
      await activateSubscription(supabase, {
        subscription: paid,
        paymentId: String(paymentEntity.id),
        amountPaise: paymentEntity.amount ? Number(paymentEntity.amount) : null,
        method: paymentEntity.method ? String(paymentEntity.method) : null,
        razorpayOrderId: orderId,
        razorpayInvoiceId: paymentEntity.invoice_id ? String(paymentEntity.invoice_id) : null,
        actor: "WEBHOOK",
        reason: "payment.captured",
      });
    } else if (paid) {
      await upsertPayment(supabase, {
        organizationId: paid.organization_id,
        subscriptionId: paid.id,
        planId: paid.plan_id,
        amountPaise: Number(paymentEntity.amount ?? 0),
        status: "CAPTURED",
        razorpayPaymentId: paymentEntity.id ? String(paymentEntity.id) : null,
        razorpayOrderId: orderId,
        razorpayInvoiceId: paymentEntity.invoice_id ? String(paymentEntity.invoice_id) : null,
        razorpaySubscriptionId,
        billingCycle: paid.billing_cycle,
        method: paymentEntity.method ? String(paymentEntity.method) : null,
        paidAt: new Date().toISOString(),
      });
    }
  }

  if (event === "refund.processed") {
    const paymentId = String(refundEntity.payment_id ?? paymentEntity.id ?? "");
    if (paymentId) {
      await supabase
        .from("payments")
        .update({ status: "REFUNDED", refunded_at: new Date().toISOString() })
        .eq("razorpay_payment_id", paymentId);
    }
  }

  await writeBillingAudit(supabase, {
    actorType: "WEBHOOK",
    action: `razorpay.${event}`,
    targetType: "subscription",
    targetId: subscription?.id ?? razorpaySubscriptionId,
    organizationId: subscription?.organization_id ?? null,
    metadata: { eventId, event },
  });

  return { processed: true };
}
