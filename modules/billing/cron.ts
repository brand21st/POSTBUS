import type { SupabaseClient } from "@supabase/supabase-js";
import { BILLING_NOTICE, insertBillingNotification } from "@/lib/notifications/billing";
import { writeSubscriptionHistory } from "@/modules/billing/audit";
import { fetchRazorpaySubscription } from "@/modules/razorpay/client";
import { env } from "@/lib/env";
import { logError } from "@/lib/logger";

export async function runBillingSweep(supabase: SupabaseClient) {
  const now = new Date();
  const { data: expiring } = await supabase
    .from("subscriptions")
    .select("id, organization_id, status, cancel_at_period_end, current_period_end, razorpay_subscription_id")
    .in("status", ["TRIAL", "ACTIVE", "PAST_DUE", "PAYMENT_FAILED"])
    .lte("current_period_end", now.toISOString());

  let expired = 0;
  for (const row of expiring ?? []) {
    const shouldExpire = row.cancel_at_period_end || row.status === "TRIAL" || row.status === "PAYMENT_FAILED";
    if (!shouldExpire) continue;
    await supabase.from("subscriptions").update({ status: "EXPIRED" }).eq("id", row.id);
    await writeSubscriptionHistory(supabase, {
      organizationId: row.organization_id,
      subscriptionId: row.id,
      fromStatus: row.status,
      toStatus: "EXPIRED",
      reason: "period_ended",
      actor: "SYSTEM",
    });
    expired += 1;
  }

  const soon = new Date(Date.now() + 3 * 86400000).toISOString();
  const { data: ending } = await supabase
    .from("subscriptions")
    .select("id, organization_id, current_period_end")
    .eq("status", "ACTIVE")
    .lte("current_period_end", soon)
    .gte("current_period_end", now.toISOString());
  for (const row of ending ?? []) {
    await insertBillingNotification(supabase, {
      organizationId: row.organization_id,
      ...BILLING_NOTICE.expiring,
      entityId: row.id,
    });
  }

  let reconciled = 0;
  if (env.razorpayKeyId && env.razorpayKeySecret) {
    const { data: live } = await supabase
      .from("subscriptions")
      .select("id, razorpay_subscription_id, status")
      .not("razorpay_subscription_id", "is", null)
      .in("status", ["ACTIVE", "PAST_DUE", "PAUSED", "PAYMENT_FAILED"]);
    for (const row of live ?? []) {
      try {
        const remote = await fetchRazorpaySubscription(String(row.razorpay_subscription_id));
        const remoteStatus = String(remote.status ?? "");
        const mapped =
          remoteStatus === "active"
            ? "ACTIVE"
            : remoteStatus === "paused"
              ? "PAUSED"
              : remoteStatus === "cancelled"
                ? "CANCELLED"
                : remoteStatus === "completed"
                  ? "EXPIRED"
                  : remoteStatus === "halted"
                    ? "PAYMENT_FAILED"
                    : null;
        if (mapped && mapped !== row.status) {
          await supabase.from("subscriptions").update({ status: mapped }).eq("id", row.id);
          reconciled += 1;
        }
      } catch (error) {
        logError("billing.reconcile_failed", {
          subscriptionId: row.id,
          message: error instanceof Error ? error.message : "unknown",
        });
      }
    }
  }

  return { expired, expiringNotices: ending?.length ?? 0, reconciled };
}
