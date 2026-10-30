import type { SupabaseClient } from "@supabase/supabase-js";
import { writeSubscriptionHistory } from "@/modules/billing/audit";
import { fetchRazorpaySubscription } from "@/modules/razorpay/client";
import { isBillingConfiguredAsync } from "@/modules/razorpay/config";
import { logError, logInfo } from "@/lib/logger";

/**
 * Expiring-soon in-app notices are optional. Production `notifications` has no
 * uniqueness on (organization_id, type, entity_id), so a 5-minute cron plus
 * overlapping runs cannot insert them safely. Keep this fail-closed until a
 * dedicated uniqueness migration is approved.
 */
export const BILLING_EXPIRING_NOTICES_ENABLED = false;

export async function runBillingSweep(supabase: SupabaseClient) {
  const started = Date.now();
  const nowIso = new Date().toISOString();
  const { data: expiring, error: expiringError } = await supabase
    .from("subscriptions")
    .select("id, organization_id, status, cancel_at_period_end, current_period_end, razorpay_subscription_id")
    .in("status", ["TRIAL", "ACTIVE", "PAST_DUE", "PAYMENT_FAILED"])
    .lte("current_period_end", nowIso);

  if (expiringError) {
    throw new Error(expiringError.message || "Failed to load expiring subscriptions.");
  }

  let expired = 0;
  let skipped = 0;
  let failures = 0;
  const eligible = expiring?.length ?? 0;

  for (const row of expiring ?? []) {
    const shouldExpire =
      row.cancel_at_period_end || row.status === "TRIAL" || row.status === "PAYMENT_FAILED";
    if (!shouldExpire) {
      skipped += 1;
      continue;
    }
    try {
      const { data: updated, error } = await supabase
        .from("subscriptions")
        .update({ status: "EXPIRED" })
        .eq("id", row.id)
        .eq("organization_id", row.organization_id)
        .eq("status", row.status)
        .eq("current_period_end", row.current_period_end)
        .lte("current_period_end", nowIso)
        .select("id");
      if (error) {
        failures += 1;
        logError("billing.expire_failed", {
          subscriptionId: row.id,
          message: error.message,
        });
        continue;
      }
      if (!updated?.length) {
        skipped += 1;
        continue;
      }
      try {
        await writeSubscriptionHistory(supabase, {
          organizationId: row.organization_id,
          subscriptionId: row.id,
          fromStatus: row.status,
          toStatus: "EXPIRED",
          reason: "period_ended",
          actor: "SYSTEM",
        });
      } catch (historyError) {
        failures += 1;
        logError("billing.expire_history_failed", {
          subscriptionId: row.id,
          message: historyError instanceof Error ? historyError.message : "unknown",
        });
      }
      expired += 1;
    } catch (error) {
      failures += 1;
      logError("billing.expire_failed", {
        subscriptionId: row.id,
        message: error instanceof Error ? error.message : "unknown",
      });
    }
  }

  const expiringNotices = 0;
  if (BILLING_EXPIRING_NOTICES_ENABLED) {
    logError("billing.expiring_notices_unexpectedly_enabled", {
      message: "Expiring notices require a uniqueness constraint before they can be enabled.",
    });
  }

  let reconciled = 0;
  if (await isBillingConfiguredAsync()) {
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
          const { data: updated, error } = await supabase
            .from("subscriptions")
            .update({ status: mapped })
            .eq("id", row.id)
            .eq("status", row.status)
            .select("id");
          if (error) {
            failures += 1;
            logError("billing.reconcile_failed", {
              subscriptionId: row.id,
              message: error.message,
            });
            continue;
          }
          if (updated?.length) reconciled += 1;
          else skipped += 1;
        }
      } catch (error) {
        failures += 1;
        logError("billing.reconcile_failed", {
          subscriptionId: row.id,
          message: error instanceof Error ? error.message : "unknown",
        });
      }
    }
  }

  const durationMs = Date.now() - started;
  const status = failures > 0 ? "partial_failure" : "ok";
  logInfo("billing.cron_completed", {
    status,
    durationMs,
    eligible,
    expired,
    skipped,
    failures,
    expiringNotices,
    reconciled,
  });

  return { expired, skipped, failures, eligible, expiringNotices, reconciled, durationMs, status };
}
