import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { extractIndiaMobileDigits } from "@/lib/phone/india-whatsapp";
import { confirmWhatsAppOrder } from "@/modules/orders/service";
import { sendVachatSessionText } from "@/modules/vachat/send";

export type MerchantOrderDecision = {
  action: "YES" | "NO";
  orderNumber: string;
};

const ORDER_REF = /(?:#?\s*)?(PB-\d+)/i;

export function parseMerchantOrderAction(text: string): MerchantOrderDecision | null {
  const raw = text.replace(/\s+/g, " ").trim();
  if (!raw) return null;
  const orderMatch = raw.match(ORDER_REF);
  if (!orderMatch) return null;
  const orderNumber = orderMatch[1].toUpperCase();
  if (/^\s*(yes|y|✅|process)\b/i.test(raw) || /\byes\b.+\bprocess\b/i.test(raw)) {
    return { action: "YES", orderNumber };
  }
  if (/^\s*(no|n|❌|reject|cancel)\b/i.test(raw) || /\bno\b.+\breject\b/i.test(raw)) {
    return { action: "NO", orderNumber };
  }
  return null;
}

function merchantCtx(organizationId: string) {
  return {
    userId: "",
    email: null,
    fullName: null,
    organizationId,
    organizationName: "",
    role: "OWNER" as const,
    permissions: ["orders.write" as const],
  };
}

async function organizationsForMerchantPhone(supabase: SupabaseClient, from: string) {
  const digits = extractIndiaMobileDigits(from);
  if (!digits) return [] as string[];
  const { data } = await supabase
    .from("organizations")
    .select("id, phone")
    .not("phone", "is", null)
    .or(`phone.eq.${digits},phone.eq.+91${digits},phone.ilike.%${digits}`);
  return (data ?? [])
    .filter((row) => extractIndiaMobileDigits(String(row.phone ?? "")) === digits)
    .map((row) => String(row.id));
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
  const decision = parseMerchantOrderAction(input.text);
  if (!decision) return { handled: false as const, reason: "not_action" };
  const orgIds = await organizationsForMerchantPhone(supabase, input.from);
  if (!orgIds.length) return { handled: false as const, reason: "not_merchant" };

  const { data: order } = await supabase
    .from("orders")
    .select("id, organization_id, order_number, source, status, payment_status, metadata, total_amount")
    .in("organization_id", orgIds)
    .eq("order_number", decision.orderNumber)
    .maybeSingle();
  if (!order) return { handled: false as const, reason: "order_not_found" };

  const storefront =
    order.metadata && typeof order.metadata === "object"
      ? ((order.metadata as { storefront?: { paymentPreference?: string; expectedAdvance?: number; total?: number } }).storefront ?? {})
      : {};
  const preference = storefront.paymentPreference === "COD" ? "COD" : "PREPAID";
  const total = Number(storefront.total ?? order.total_amount ?? 0);
  const advance = Number(storefront.expectedAdvance ?? 0);

  try {
    if (decision.action === "YES") {
      await confirmWhatsAppOrder(supabase, merchantCtx(order.organization_id), order.id, {
        paymentType: preference,
        amount: preference === "PREPAID" ? total : advance,
      });
      const reply = `${decision.orderNumber} is now processing.`;
      await sendVachatSessionText(input.from, reply);
      return { handled: true as const, action: decision.action, orderNumber: decision.orderNumber, reply };
    }
    await rejectWhatsAppOrder(supabase, order.organization_id, order.id, "Merchant rejected from WhatsApp");
    const reply = `${decision.orderNumber} was rejected. The order remains in Postbus as cancelled.`;
    await sendVachatSessionText(input.from, reply);
    return { handled: true as const, action: decision.action, orderNumber: decision.orderNumber, reply };
  } catch (error) {
    const reply =
      error instanceof AppError ? error.message : `Could not update ${decision.orderNumber}. Check it in Postbus.`;
    await sendVachatSessionText(input.from, reply);
    return { handled: true as const, action: decision.action, orderNumber: decision.orderNumber, reply };
  }
}
