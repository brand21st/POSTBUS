import type { SupabaseClient } from "@supabase/supabase-js";
import { AI_CREDITS_BILLING_CYCLE } from "@/modules/ai-credits/constants";
import {
  ADDON_PAYMENT_PURPOSE,
  AI_CREDITS_PAYMENT_PURPOSE,
  isAddonPaymentRow,
} from "@/modules/addons/constants";

export type PlatformPaymentDomain = "ADDON" | "AI_CREDITS" | "SUBSCRIPTION" | "UNMATCHED_PLATFORM";

export async function classifyPlatformRazorpayPayment(
  supabase: SupabaseClient,
  input: {
    razorpayOrderId?: string | null;
    subscriptionMatched?: boolean;
  }
): Promise<PlatformPaymentDomain> {
  if (input.razorpayOrderId) {
    // Several rows can share an order (legacy FAILED attempt rows). maybeSingle
    // errors on two rows, which left a captured subscription payment unmatched.
    const { data } = await supabase
      .from("payments")
      .select("billing_cycle, payment_purpose")
      .eq("razorpay_order_id", input.razorpayOrderId)
      .limit(20);
    const rows = (data ?? []) as Array<{ billing_cycle?: string | null; payment_purpose?: string | null }>;
    if (rows.some((row) => isAddonPaymentRow(row) || row.payment_purpose === ADDON_PAYMENT_PURPOSE)) {
      return "ADDON";
    }
    if (
      rows.some(
        (row) =>
          row.payment_purpose === AI_CREDITS_PAYMENT_PURPOSE || row.billing_cycle === AI_CREDITS_BILLING_CYCLE
      )
    ) {
      return "AI_CREDITS";
    }
    // A subscription purchase intent exists even when it names no subscription row.
    if (rows.some((row) => !row.payment_purpose || row.payment_purpose === "subscription")) {
      return "SUBSCRIPTION";
    }
  }
  if (input.subscriptionMatched) return "SUBSCRIPTION";
  return "UNMATCHED_PLATFORM";
}
