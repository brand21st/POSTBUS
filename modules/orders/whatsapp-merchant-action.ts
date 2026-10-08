import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { parseWhatsAppOrderCommand } from "@/modules/orders/whatsapp-commands";
import { handleWhatsAppStorefrontAction } from "@/modules/orders/whatsapp-lifecycle";

export type MerchantOrderDecision = {
  action: "YES" | "NO";
  orderNumber: string;
};

export function parseMerchantOrderAction(text: string): MerchantOrderDecision | null {
  const command = parseWhatsAppOrderCommand(text);
  if (!command) return null;
  if (command.kind === "CUSTOMER_YES" || command.kind === "MERCHANT_PROCESS") {
    return { action: "YES", orderNumber: command.orderNumber };
  }
  if (command.kind === "CUSTOMER_NO" || command.kind === "MERCHANT_CANCEL") {
    return { action: "NO", orderNumber: command.orderNumber };
  }
  return null;
}

export async function rejectWhatsAppOrder(
  supabase: SupabaseClient,
  organizationId: string,
  orderId: string,
  reason: string
) {
  const { data: updated, error } = await supabase
    .from("orders")
    .update({ status: "CANCELLED" })
    .eq("id", orderId)
    .eq("organization_id", organizationId)
    .eq("source", "WHATSAPP")
    .eq("status", "IMPORTED")
    .eq("payment_status", "PENDING")
    .select("id, order_number")
    .maybeSingle();
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  if (!updated) throw new AppError(ERROR_CODES.CONFLICT, "This WhatsApp order has already been processed.");
  await supabase
    .from("order_payment_claims")
    .update({ status: "REJECTED", resolved_at: new Date().toISOString() })
    .eq("organization_id", organizationId)
    .eq("order_id", orderId)
    .eq("status", "OPEN");
  await supabase.from("audit_logs").insert({
    organization_id: organizationId,
    actor_id: null,
    action: "order.whatsapp_rejected",
    entity_type: "order",
    entity_id: orderId,
    after: { reason, channel: "whatsapp" },
  });
  return updated;
}

export async function handleMerchantWhatsAppOrderAction(
  supabase: SupabaseClient,
  input: { from: string; text: string }
) {
  return handleWhatsAppStorefrontAction(supabase, input);
}
