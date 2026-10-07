import type { SupabaseClient } from "@supabase/supabase-js";
import { logError } from "@/lib/logger";
import { extractIndiaMobileDigits } from "@/lib/phone/india-whatsapp";
import { enqueueVachatNotify, sendVachatSessionText } from "@/modules/vachat/send";
import { enqueueWatiNotify } from "@/modules/wati/send";
import {
  formatCustomerStorefrontOrderMessage,
  formatMerchantStorefrontOrderMessage,
  type StorefrontOrderMessage,
} from "@/modules/storefront/order-messages";

export async function notifyStorefrontOrderCreated(
  supabase: SupabaseClient,
  organizationId: string,
  orderId: string,
  message: StorefrontOrderMessage
) {
  try {
    await enqueueWatiNotify(supabase, organizationId, "order_confirmation", { orderId });
  } catch (error) {
    logError("storefront.wati_notify.failed", {
      orderId,
      message: error instanceof Error ? error.message : "wati enqueue failed",
    });
  }
  try {
    await enqueueVachatNotify(supabase, organizationId, "order_confirmation", { orderId });
  } catch (error) {
    logError("storefront.vachat_notify.failed", {
      orderId,
      message: error instanceof Error ? error.message : "vachat enqueue failed",
    });
  }

  try {
    await sendVachatSessionText(message.whatsapp, formatCustomerStorefrontOrderMessage(message));
  } catch (error) {
    logError("storefront.customer_whatsapp.failed", {
      orderId,
      message: error instanceof Error ? error.message : "customer session text failed",
    });
  }

  const { data: org } = await supabase.from("organizations").select("phone").eq("id", organizationId).maybeSingle();
  const merchantPhone = extractIndiaMobileDigits(String(org?.phone ?? ""));
  if (!merchantPhone) return;
  try {
    await sendVachatSessionText(merchantPhone, formatMerchantStorefrontOrderMessage(message));
  } catch (error) {
    logError("storefront.merchant_whatsapp.failed", {
      orderId,
      message: error instanceof Error ? error.message : "merchant session text failed",
    });
  }
}
