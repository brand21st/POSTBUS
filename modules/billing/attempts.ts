import type { SupabaseClient } from "@supabase/supabase-js";
import { logError } from "@/lib/logger";

export type PaymentAttemptStatus = "FAILED" | "AUTHORIZED" | "CAPTURED" | "REFUNDED";

/**
 * Record one Razorpay payment attempt. Attempts never touch the purchase intent
 * status, and a later FAILED event can never downgrade a CAPTURED attempt.
 * Error text is truncated; card, contact, and email fields are never stored.
 */
export async function recordPaymentAttempt(
  supabase: SupabaseClient,
  input: {
    organizationId?: string | null;
    purchaseId?: string | null;
    razorpayOrderId: string;
    razorpayPaymentId: string;
    status: PaymentAttemptStatus;
    amountPaise?: number | null;
    currency?: string | null;
    method?: string | null;
    errorCode?: string | null;
    errorReason?: string | null;
    source: "webhook" | "verify" | "reconcile";
    eventId?: string | null;
  }
) {
  const row = {
    organization_id: input.organizationId ?? null,
    purchase_id: input.purchaseId ?? null,
    razorpay_order_id: input.razorpayOrderId,
    razorpay_payment_id: input.razorpayPaymentId,
    status: input.status,
    amount_paise: input.amountPaise ?? null,
    currency: input.currency ?? null,
    method: input.method ?? null,
    error_code: input.errorCode ? input.errorCode.slice(0, 120) : null,
    error_reason: input.errorReason ? input.errorReason.slice(0, 500) : null,
    source: input.source,
    event_id: input.eventId ?? null,
  };
  // ignoreDuplicates: the first record of a payment id wins, so an out-of-order
  // payment.failed cannot overwrite a captured attempt written by fulfillment.
  const { error } = await supabase
    .from("payment_attempts")
    .upsert(row, { onConflict: "razorpay_payment_id", ignoreDuplicates: true });
  if (error) {
    // Attempt history is best effort; it must never block fulfillment.
    logError("billing.payment_attempt_record_failed", {
      razorpayOrderId: input.razorpayOrderId,
      status: input.status,
      message: error.message,
    });
  }
}
