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
    const { data } = await supabase
      .from("payments")
      .select("billing_cycle, payment_purpose")
      .eq("razorpay_order_id", input.razorpayOrderId)
      .maybeSingle();
    if (isAddonPaymentRow(data)) return "ADDON";
    const purpose = String(data?.payment_purpose ?? "");
    const cycle = String(data?.billing_cycle ?? "");
    if (purpose === AI_CREDITS_PAYMENT_PURPOSE || cycle === AI_CREDITS_BILLING_CYCLE) {
      return "AI_CREDITS";
    }
    if (purpose === ADDON_PAYMENT_PURPOSE) return "ADDON";
  }
  if (input.subscriptionMatched) return "SUBSCRIPTION";
  return "UNMATCHED_PLATFORM";
}
