import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { BILLING_NOTICE, insertBillingNotification } from "@/lib/notifications/billing";

export const LIVE_STATUSES = ["TRIAL", "ACTIVE", "PAST_DUE", "PAUSED", "PAYMENT_FAILED"] as const;
export const BOOKABLE_STATUSES = ["TRIAL", "ACTIVE", "PAST_DUE"] as const;

export const ORDER_LIMIT_MESSAGE =
  "You have reached your monthly order limit. Please upgrade your plan to continue processing orders.";

export const ACCOUNT_BLOCKED_MESSAGE =
  "This account is locked. Contact support to continue processing orders.";

export const SUBSCRIPTION_INACTIVE_MESSAGE =
  "Your subscription is not active. Please choose a plan to continue processing orders.";

export type QuotaSnapshot = {
  organizationId: string;
  subscriptionId: string | null;
  status: string | null;
  planName: string | null;
  ordersUsed: number;
  orderLimit: number | null;
  remaining: number | null;
  periodStart: string | null;
  periodEnd: string | null;
  bookable: boolean;
};

type UsageRow = {
  id: string;
  orders_used: number;
  order_limit: number | null;
  period_start: string;
  period_end: string;
  alert_80_sent_at: string | null;
  alert_90_sent_at: string | null;
  alert_100_sent_at: string | null;
};

async function loadLiveSubscription(supabase: SupabaseClient, organizationId: string) {
  const { data } = await supabase
    .from("subscriptions")
    .select("id, status, order_limit, current_period_start, current_period_end, plans(name, monthly_order_limit)")
    .eq("organization_id", organizationId)
    .in("status", [...LIVE_STATUSES])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

export async function getQuotaSnapshot(
  supabase: SupabaseClient,
  organizationId: string
): Promise<QuotaSnapshot> {
  const { data: org } = await supabase
    .from("organizations")
    .select("account_status")
    .eq("id", organizationId)
    .maybeSingle();
  const subscription = await loadLiveSubscription(supabase, organizationId);
  const planRaw = subscription?.plans as { name?: string; monthly_order_limit?: number } | { name?: string; monthly_order_limit?: number }[] | null;
  const plan = Array.isArray(planRaw) ? planRaw[0] : planRaw;
  let usage: UsageRow | null = null;
  if (subscription?.id) {
    const ensured = await supabase.rpc("ensure_billing_period", { p_org: organizationId });
    usage = (Array.isArray(ensured.data) ? ensured.data[0] : ensured.data) as UsageRow | null;
    if (!usage) {
      const { data: row } = await supabase
        .from("billing_usage")
        .select("*")
        .eq("organization_id", organizationId)
        .order("period_start", { ascending: false })
        .limit(1)
        .maybeSingle();
      usage = row as UsageRow | null;
    }
  }
  let orderLimit = usage?.order_limit ?? subscription?.order_limit ?? plan?.monthly_order_limit ?? null;
  if (subscription?.status === "TRIAL") {
    const { data: topPlan } = await supabase
      .from("plans")
      .select("monthly_order_limit")
      .eq("is_active", true)
      .order("monthly_order_limit", { ascending: false })
      .limit(1)
      .maybeSingle();
    const trialLimit = Number(topPlan?.monthly_order_limit) || 0;
    if (trialLimit > 0) orderLimit = Math.max(orderLimit ?? 0, trialLimit);
  }
  const ordersUsed = usage?.orders_used ?? 0;
  const remaining = orderLimit === null ? null : Math.max(0, orderLimit - ordersUsed);
  const accountOk = (org?.account_status ?? "ACTIVE") === "ACTIVE";
  const statusOk = Boolean(subscription && BOOKABLE_STATUSES.includes(subscription.status as (typeof BOOKABLE_STATUSES)[number]));
  const limitOk = remaining === null || remaining > 0;
  return {
    organizationId,
    subscriptionId: subscription?.id ?? null,
    status: subscription?.status ?? null,
    planName: plan?.name ?? null,
    ordersUsed,
    orderLimit,
    remaining,
    periodStart: usage?.period_start ?? subscription?.current_period_start ?? null,
    periodEnd: usage?.period_end ?? subscription?.current_period_end ?? null,
    bookable: accountOk && statusOk && limitOk,
  };
}

export async function checkQuota(
  supabase: SupabaseClient,
  organizationId: string,
  needed = 1
) {
  const { data: org } = await supabase
    .from("organizations")
    .select("account_status")
    .eq("id", organizationId)
    .maybeSingle();
  if ((org?.account_status ?? "ACTIVE") !== "ACTIVE") {
    throw new AppError(ERROR_CODES.FORBIDDEN, ACCOUNT_BLOCKED_MESSAGE);
  }
  const snapshot = await getQuotaSnapshot(supabase, organizationId);
  if (!snapshot.status || !BOOKABLE_STATUSES.includes(snapshot.status as (typeof BOOKABLE_STATUSES)[number])) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, SUBSCRIPTION_INACTIVE_MESSAGE);
  }
  if (snapshot.orderLimit !== null && snapshot.ordersUsed + needed > snapshot.orderLimit) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, ORDER_LIMIT_MESSAGE);
  }
  return snapshot;
}

export async function consumeQuota(supabase: SupabaseClient, organizationId: string) {
  await checkQuota(supabase, organizationId, 1);
  const { data, error } = await supabase.rpc("consume_order_quota", { p_org: organizationId });
  if (error) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  }
  const row = (Array.isArray(data) ? data[0] : data) as { orders_used?: number; order_limit?: number } | null;
  if (!row?.orders_used) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, ORDER_LIMIT_MESSAGE);
  }
  await supabase.from("usage_events").insert({
    organization_id: organizationId,
    metric: "shipments",
    quantity: 1,
  });
  await maybeAlertUsage(supabase, organizationId, Number(row.orders_used), row.order_limit ?? null);
  return row;
}

async function maybeAlertUsage(
  supabase: SupabaseClient,
  organizationId: string,
  used: number,
  limit: number | null
) {
  if (!limit || limit <= 0) return;
  const ratio = used / limit;
  const { data: usage } = await supabase
    .from("billing_usage")
    .select("id, alert_80_sent_at, alert_90_sent_at, alert_100_sent_at")
    .eq("organization_id", organizationId)
    .order("period_start", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!usage) return;
  const patch: Record<string, string> = {};
  if (ratio >= 1 && !usage.alert_100_sent_at) {
    patch.alert_100_sent_at = new Date().toISOString();
    await insertBillingNotification(supabase, {
      organizationId,
      ...BILLING_NOTICE.usage100,
    });
  } else if (ratio >= 0.9 && !usage.alert_90_sent_at) {
    patch.alert_90_sent_at = new Date().toISOString();
    await insertBillingNotification(supabase, {
      organizationId,
      ...BILLING_NOTICE.usage90,
    });
  } else if (ratio >= 0.8 && !usage.alert_80_sent_at) {
    patch.alert_80_sent_at = new Date().toISOString();
    await insertBillingNotification(supabase, {
      organizationId,
      ...BILLING_NOTICE.usage80,
    });
  }
  if (Object.keys(patch).length) {
    await supabase.from("billing_usage").update(patch).eq("id", usage.id);
  }
}
