import type { SupabaseClient } from "@supabase/supabase-js";
import { logError } from "@/lib/logger";
import { extractIndiaMobileDigits } from "@/lib/phone/india-whatsapp";
import { enqueueVachatSessionText, sendVachatSessionText } from "@/modules/vachat/send";
import {
  formatCustomerCodAcceptedMessage,
  formatCustomerOrderCancelledMessage,
  formatCustomerPaymentConfirmedMessage,
  formatCustomerPaymentRejectedMessage,
  formatCustomerPaymentRequiredMessage,
  formatMerchantPaymentClaimedMessage,
  formatMerchantStorefrontOrderMessage,
  formatCustomerStorefrontOrderMessage,
  type StorefrontOrderMessage,
} from "@/modules/storefront/order-messages";
import {
  iHavePaidInteractive,
  paymentVerifyInteractive,
  processCancelInteractive,
  yesNoInteractive,
} from "@/modules/orders/whatsapp-commands";
import { formatWhatsAppOrderNumber } from "@/modules/orders/order-number";

function displayOrderNumber(orderNumber: string) {
  return formatWhatsAppOrderNumber(orderNumber) || orderNumber;
}

function withDisplayOrderNumber(message: StorefrontOrderMessage): StorefrontOrderMessage {
  return { ...message, orderNumber: displayOrderNumber(message.orderNumber) };
}

async function merchantPhone(supabase: SupabaseClient, organizationId: string) {
  const { data: org } = await supabase.from("organizations").select("phone").eq("id", organizationId).maybeSingle();
  return extractIndiaMobileDigits(String(org?.phone ?? ""));
}

async function queueSession(
  supabase: SupabaseClient,
  organizationId: string,
  payload: Parameters<typeof enqueueVachatSessionText>[2]
) {
  try {
    await enqueueVachatSessionText(supabase, organizationId, payload);
  } catch (error) {
    logError("storefront.whatsapp_session.enqueue_failed", {
      organizationId,
      orderId: payload.orderId,
      message: error instanceof Error ? error.message : "enqueue failed",
    });
  }
}

export async function notifyStorefrontOrderCreated(
  supabase: SupabaseClient,
  organizationId: string,
  orderId: string,
  message: StorefrontOrderMessage
) {
  try {
    await sendVachatSessionText(message.whatsapp, formatCustomerStorefrontOrderMessage(withDisplayOrderNumber(message)), {
      interactive_payload: yesNoInteractive(message.orderNumber),
    });
  } catch (error) {
    logError("storefront.customer_whatsapp.failed", {
      orderId,
      organizationId,
      message: error instanceof Error ? error.message : "customer session text failed",
    });
  }
}

export async function notifyMerchantWhatsAppOrderReady(
  supabase: SupabaseClient,
  organizationId: string,
  message: StorefrontOrderMessage,
  orderId?: string
) {
  const phone = await merchantPhone(supabase, organizationId);
  if (!phone) return;
  await queueSession(supabase, organizationId, {
    to: phone,
    text: formatMerchantStorefrontOrderMessage(withDisplayOrderNumber(message)),
    extras: { interactive_payload: processCancelInteractive(message.orderNumber) },
    orderId,
  });
}

export async function notifyCustomerWhatsAppCodAccepted(
  supabase: SupabaseClient,
  organizationId: string,
  to: string,
  orderNumber: string,
  orderId?: string
) {
  await queueSession(supabase, organizationId, {
    to,
    text: formatCustomerCodAcceptedMessage(displayOrderNumber(orderNumber)),
    orderId,
  });
}

export async function notifyCustomerPaymentRequired(
  supabase: SupabaseClient,
  organizationId: string,
  to: string,
  input: { orderNumber: string; amount: number; upiId?: string | null; gpay?: string | null; qrImageUrl?: string | null },
  orderId?: string
) {
  await queueSession(supabase, organizationId, {
    to,
    text: formatCustomerPaymentRequiredMessage({ ...input, orderNumber: displayOrderNumber(input.orderNumber) }),
    extras: {
      interactive_payload: iHavePaidInteractive(input.orderNumber),
      image_url: input.qrImageUrl ?? undefined,
    },
    orderId,
  });
}

export async function notifyMerchantPaymentClaimed(
  supabase: SupabaseClient,
  organizationId: string,
  input: { orderNumber: string; customerName: string; amount: number },
  orderId?: string
) {
  const phone = await merchantPhone(supabase, organizationId);
  if (!phone) return;
  await queueSession(supabase, organizationId, {
    to: phone,
    text: formatMerchantPaymentClaimedMessage({ ...input, orderNumber: displayOrderNumber(input.orderNumber) }),
    extras: { interactive_payload: paymentVerifyInteractive(input.orderNumber) },
    orderId,
  });
}

export async function notifyCustomerPaymentConfirmed(
  supabase: SupabaseClient,
  organizationId: string,
  to: string,
  orderNumber: string,
  orderId?: string
) {
  await queueSession(supabase, organizationId, {
    to,
    text: formatCustomerPaymentConfirmedMessage(displayOrderNumber(orderNumber)),
    orderId,
  });
}

export async function notifyCustomerPaymentRejected(
  supabase: SupabaseClient,
  organizationId: string,
  to: string,
  orderNumber: string,
  orderId?: string
) {
  await queueSession(supabase, organizationId, {
    to,
    text: formatCustomerPaymentRejectedMessage(displayOrderNumber(orderNumber)),
    orderId,
  });
}

export async function notifyCustomerWhatsAppCancelled(
  supabase: SupabaseClient,
  organizationId: string,
  to: string,
  orderNumber: string,
  orderId?: string
) {
  await queueSession(supabase, organizationId, {
    to,
    text: formatCustomerOrderCancelledMessage(displayOrderNumber(orderNumber)),
    orderId,
  });
}
