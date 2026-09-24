import type { SupabaseClient } from "@supabase/supabase-js";
import { logError, logInfo } from "@/lib/logger";
import { BILLING_NOTICE, insertBillingNotification } from "@/lib/notifications/billing";
import { writeBillingAudit, writeSubscriptionHistory } from "@/modules/billing/audit";
import { activateSubscription, unixToDate, type SubscriptionRow } from "@/modules/billing/subscriptions";

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
  };
};

function entity(payload: RazorpayPayload, key: "subscription" | "payment" | "refund") {
  return payload.payload?.[key]?.entity ?? {};
}

async function loadSubscription(supabase: SupabaseClient, razorpaySubscriptionId?: string | null) {
  if (!razorpaySubscriptionId) return null;
  const { data } = await supabase
    .from("subscriptions")
    .select("*, plans(*)")
    .eq("razorpay_subscription_id", razorpaySubscriptionId)
    .maybeSingle();
  return data as SubscriptionRow | null;
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

export async function processRazorpayEvent(
  supabase: SupabaseClient,
  payload: RazorpayPayload,
  eventId: string
) {
  const event = payload.event ?? "";
  const subscriptionEntity = entity(payload, "subscription");
  const paymentEntity = entity(payload, "payment");
  const refundEntity = entity(payload, "refund");
  const razorpaySubscriptionId = String(subscriptionEntity.id ?? paymentEntity.subscription_id ?? "");
  const subscription = await loadSubscription(supabase, razorpaySubscriptionId || null);

  logInfo("razorpay.webhook", { event, eventId, razorpaySubscriptionId });

  if (!subscription && event.startsWith("subscription.")) {
    logError("razorpay.webhook_unmatched_subscription", { event, razorpaySubscriptionId });
    return { ignored: true };
  }

  if (event === "subscription.activated" && subscription) {
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

  if (event === "subscription.charged" && subscription) {
    const wasActive = subscription.status === "ACTIVE";
    await activateSubscription(supabase, {
      subscription,
      paymentId: paymentEntity.id ? String(paymentEntity.id) : null,
      amountPaise: paymentEntity.amount ? Number(paymentEntity.amount) : null,
      method: paymentEntity.method ? String(paymentEntity.method) : null,
      razorpayOrderId: paymentEntity.order_id ? String(paymentEntity.order_id) : null,
      razorpayInvoiceId: paymentEntity.invoice_id ? String(paymentEntity.invoice_id) : null,
      periodStart: unixToDate(subscriptionEntity.current_start),
      periodEnd: unixToDate(subscriptionEntity.current_end),
      actor: "WEBHOOK",
      reason: "subscription.charged",
    });
    if (subscription.pending_plan_id) {
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
    if (wasActive) {
      await insertBillingNotification(supabase, {
        organizationId: subscription.organization_id,
        ...BILLING_NOTICE.renewal,
        entityId: subscription.id,
      });
    }
    if (paymentEntity.id) {
      await insertBillingNotification(supabase, {
        organizationId: subscription.organization_id,
        ...BILLING_NOTICE.paymentSuccess,
        entityId: subscription.id,
      });
    }
  }

  if ((event === "subscription.pending" || event === "payment.failed") && subscription) {
    const next = event === "subscription.pending" ? "PAST_DUE" : "PAYMENT_FAILED";
    await supabase.from("subscriptions").update({ status: next }).eq("id", subscription.id);
    await writeSubscriptionHistory(supabase, {
      organizationId: subscription.organization_id,
      subscriptionId: subscription.id,
      fromStatus: subscription.status,
      toStatus: next,
      reason: event,
      actor: "WEBHOOK",
    });
    await upsertPayment(supabase, {
      organizationId: subscription.organization_id,
      subscriptionId: subscription.id,
      planId: subscription.plan_id,
      amountPaise: Number(paymentEntity.amount ?? subscription.amount_paise ?? 0),
      status: "FAILED",
      razorpayPaymentId: paymentEntity.id ? String(paymentEntity.id) : `failed-${eventId}`,
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
    const orgId = subscription?.organization_id;
    if (orgId) {
      await upsertPayment(supabase, {
        organizationId: orgId,
        subscriptionId: subscription?.id,
        planId: subscription?.plan_id,
        amountPaise: Number(paymentEntity.amount ?? 0),
        status: "CAPTURED",
        razorpayPaymentId: paymentEntity.id ? String(paymentEntity.id) : null,
        razorpayOrderId: paymentEntity.order_id ? String(paymentEntity.order_id) : null,
        razorpayInvoiceId: paymentEntity.invoice_id ? String(paymentEntity.invoice_id) : null,
        razorpaySubscriptionId,
        billingCycle: subscription?.billing_cycle,
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
