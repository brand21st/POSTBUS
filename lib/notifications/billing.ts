import type { SupabaseClient } from "@supabase/supabase-js";

export async function insertBillingNotification(
  supabase: SupabaseClient,
  input: {
    organizationId: string;
    type: string;
    title: string;
    body: string;
    entityType?: string;
    entityId?: string | null;
  }
) {
  await supabase.from("notifications").insert({
    organization_id: input.organizationId,
    type: input.type,
    title: input.title,
    body: input.body,
    entity_type: input.entityType ?? "billing",
    entity_id: input.entityId ?? null,
  });
}

export const BILLING_NOTICE = {
  activated: {
    type: "billing.subscription_activated",
    title: "Subscription activated",
    body: "Your PostBus subscription is active.",
  },
  paymentSuccess: {
    type: "billing.payment_successful",
    title: "Payment successful",
    body: "We received your subscription payment.",
  },
  paymentFailed: {
    type: "billing.payment_failed",
    title: "Payment failed",
    body: "Your subscription payment failed. Update your payment method to keep processing orders.",
  },
  renewal: {
    type: "billing.subscription_renewed",
    title: "Subscription renewed",
    body: "Your subscription has been renewed for the next billing period.",
  },
  expiring: {
    type: "billing.subscription_expiring",
    title: "Subscription expiring",
    body: "Your subscription will expire soon. Renew to keep processing orders.",
  },
  cancelled: {
    type: "billing.subscription_cancelled",
    title: "Subscription cancelled",
    body: "Your subscription is cancelled. You can keep using PostBus until the paid period ends.",
  },
  usage80: {
    type: "billing.usage_80",
    title: "Order usage at 80%",
    body: "You have used 80% of your monthly order limit.",
  },
  usage90: {
    type: "billing.usage_90",
    title: "Order usage at 90%",
    body: "You have used 90% of your monthly order limit.",
  },
  usage100: {
    type: "billing.usage_100",
    title: "Order limit reached",
    body: "You have reached your monthly order limit. Please upgrade your plan to continue processing orders.",
  },
} as const;
