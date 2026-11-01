import type { SupabaseClient } from "@supabase/supabase-js";
import { logError, logInfo } from "@/lib/logger";
import { recordPaymentAttempt } from "@/modules/billing/attempts";
import { isCapturedRazorpayStatus } from "@/modules/billing/purchase";
import { fulfillCapturedSubscriptionPurchase } from "@/modules/billing/subscriptions";
import { fetchRazorpayOrderPayments } from "@/modules/razorpay/client";

export type ReconcileSummary = {
  checked: number;
  fulfilled: number;
  duplicate: number;
  unpaid: number;
  authorizedOnly: number;
  manualReview: number;
  failures: number;
  skipped?: "migration_pending";
};

type PendingRow = {
  id: string;
  organization_id: string;
  razorpay_order_id: string;
  amount_paise: number;
  currency: string | null;
  reconcile_attempts?: number | null;
};

/**
 * Recover paid customers whose browser verification and webhook both failed.
 *
 * Reads stale PENDING subscription purchases, asks Razorpay (read-only) which
 * payments exist for each order, and sends exactly one captured payment through
 * the same fulfillment RPC as verify and webhooks. Never creates charges or
 * refunds, never activates an authorized-only or unpaid order, and leaves orders
 * with more than one captured payment for manual review.
 */
export async function reconcilePendingSubscriptionPayments(
  supabase: SupabaseClient,
  options: {
    now?: Date;
    minAgeMinutes?: number;
    maxAgeDays?: number;
    recheckMinutes?: number;
    limit?: number;
  } = {}
): Promise<ReconcileSummary> {
  const now = options.now ?? new Date();
  const minAge = new Date(now.getTime() - (options.minAgeMinutes ?? 15) * 60_000).toISOString();
  const maxAge = new Date(now.getTime() - (options.maxAgeDays ?? 30) * 86_400_000).toISOString();
  const recheckBefore = new Date(now.getTime() - (options.recheckMinutes ?? 60) * 60_000).toISOString();
  const summary: ReconcileSummary = {
    checked: 0,
    fulfilled: 0,
    duplicate: 0,
    unpaid: 0,
    authorizedOnly: 0,
    manualReview: 0,
    failures: 0,
  };

  const { data, error } = await supabase
    .from("payments")
    .select("id, organization_id, razorpay_order_id, amount_paise, currency, reconcile_attempts")
    .eq("status", "PENDING")
    .eq("payment_purpose", "subscription")
    .not("razorpay_order_id", "is", null)
    .lte("created_at", minAge)
    .gte("created_at", maxAge)
    .or(`reconcile_checked_at.is.null,reconcile_checked_at.lt.${recheckBefore}`)
    .order("created_at", { ascending: true })
    .limit(options.limit ?? 25);
  if (error) {
    if (/reconcile_checked_at|reconcile_attempts|column/i.test(error.message ?? "")) {
      return { ...summary, skipped: "migration_pending" };
    }
    throw new Error(error.message || "Could not load pending payments.");
  }

  for (const row of (data ?? []) as PendingRow[]) {
    summary.checked += 1;
    try {
      const response = await fetchRazorpayOrderPayments(row.razorpay_order_id);
      const items = (response.items ?? []).filter(
        (item) => String(item.order_id ?? "") === row.razorpay_order_id
      );
      for (const item of items) {
        if (String(item.status ?? "") === "failed" && item.id) {
          await recordPaymentAttempt(supabase, {
            organizationId: row.organization_id,
            purchaseId: row.id,
            razorpayOrderId: row.razorpay_order_id,
            razorpayPaymentId: String(item.id),
            status: "FAILED",
            amountPaise: item.amount != null ? Number(item.amount) : null,
            currency: item.currency ? String(item.currency) : null,
            method: item.method ? String(item.method) : null,
            errorCode: item.error_code ? String(item.error_code) : null,
            errorReason: item.error_description ? String(item.error_description) : null,
            source: "reconcile",
          });
        }
      }
      const captured = items.filter((item) => isCapturedRazorpayStatus(String(item.status ?? "")));
      if (captured.length > 1) {
        summary.manualReview += 1;
        logError("billing.reconcile_multiple_captures", {
          purchaseId: row.id,
          razorpayOrderId: row.razorpay_order_id,
          count: captured.length,
        });
      } else if (captured.length === 1) {
        const payment = captured[0];
        const result = await fulfillCapturedSubscriptionPurchase(supabase, {
          razorpayOrderId: row.razorpay_order_id,
          paymentId: String(payment.id),
          amountPaise: Number(payment.amount),
          currency: payment.currency ? String(payment.currency) : "INR",
          method: payment.method ? String(payment.method) : null,
          organizationId: row.organization_id,
          actor: "RECONCILE",
          reason: "reconcile.payment_captured",
        });
        if (result.duplicate) summary.duplicate += 1;
        else if (result.handled && result.subscriptionId && !result.notFound) summary.fulfilled += 1;
        else {
          summary.manualReview += 1;
          logError("billing.reconcile_not_fulfilled", {
            purchaseId: row.id,
            razorpayOrderId: row.razorpay_order_id,
            outcome: Object.keys(result).filter((key) => (result as Record<string, unknown>)[key] === true),
          });
        }
      } else if (items.some((item) => String(item.status ?? "") === "authorized")) {
        // Orders use payment_capture=1; an authorized-only payment is not money received.
        summary.authorizedOnly += 1;
      } else {
        summary.unpaid += 1;
      }
      await supabase
        .from("payments")
        .update({
          reconcile_checked_at: now.toISOString(),
          reconcile_attempts: Number(row.reconcile_attempts ?? 0) + 1,
        })
        .eq("id", row.id)
        .eq("status", "PENDING");
    } catch (rowError) {
      summary.failures += 1;
      logError("billing.reconcile_failed", {
        purchaseId: row.id,
        message: rowError instanceof Error ? rowError.message : "unknown",
      });
    }
  }

  logInfo("billing.reconcile_completed", summary);
  return summary;
}
