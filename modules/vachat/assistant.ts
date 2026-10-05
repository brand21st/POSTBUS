import type { SupabaseClient } from "@supabase/supabase-js";
import { logError } from "@/lib/logger";
import {
  findOrganizationsForCustomerPhone,
  formatKnowledgeDocument,
  loadMerchantKnowledge,
  phoneDigitsForLookup,
  syncMerchantKnowledge,
  type MerchantKnowledge,
  type MerchantKnowledgeOrder,
  VACHAT_ASSISTANT_NAME,
} from "@/modules/vachat/knowledge";
import { getPlatformVachatConfig, isPlatformVachatActive } from "@/modules/vachat/platform-config";
import { vachatHeaders } from "@/modules/vachat/service";

export type AssistantIntent = "merchant" | "tracking" | "shipped" | "order" | "unknown";

export function classifyAssistantIntent(text: string): AssistantIntent {
  const q = text.toLowerCase();
  if (
    /merchant|seller|shop name|workspace|phone number|contact|website|address|email/.test(q)
  ) {
    return "merchant";
  }
  if (/where|now|current|track|status|location|reached|out for delivery|ndr/.test(q)) {
    return "tracking";
  }
  if (/when shipped|shipped|booked|packed|dispatched|handed over/.test(q)) {
    return "shipped";
  }
  if (/order|details|amount|cod|my parcel|my packet/.test(q)) {
    return "order";
  }
  return "unknown";
}

export function pickOrder(knowledge: MerchantKnowledge, text: string) {
  const upper = text.toUpperCase();
  const byNumber = knowledge.orders.find((order) => order.orderNumber && upper.includes(order.orderNumber.toUpperCase()));
  if (byNumber) return byNumber;
  const byTracking = knowledge.orders.find(
    (order) => order.trackingNumber && upper.includes(order.trackingNumber.toUpperCase())
  );
  return byTracking ?? knowledge.orders[0] ?? null;
}

function orderLines(order: MerchantKnowledgeOrder) {
  return [
    `Order ${order.orderNumber} is ${order.status.replace(/_/g, " ").toLowerCase()}.`,
    order.amount ? `Amount ${order.amount}.` : null,
    order.trackingNumber ? `Tracking ID ${order.trackingNumber}.` : "Tracking is not assigned yet.",
    order.shipmentStatus ? `Shipment ${order.shipmentStatus.replace(/_/g, " ").toLowerCase()}.` : null,
    order.bookedAt ? `Handed to India Post at ${order.bookedAt}.` : null,
    order.lastScan ? `Latest scan: ${order.lastScan}${order.lastOffice ? ` at ${order.lastOffice}` : ""}.` : null,
    order.trackingUrl ? `Track: ${order.trackingUrl}` : null,
  ].filter(Boolean) as string[];
}

export function answerFromKnowledge(knowledge: MerchantKnowledge, text: string) {
  const intent = classifyAssistantIntent(text);
  const org = knowledge.organization;
  if (intent === "merchant") {
    return [
      `${org.name} is the merchant on this order.`,
      org.phone ? `Phone ${org.phone}.` : null,
      org.website ? `Website ${org.website}.` : null,
      org.email ? `Email ${org.email}.` : null,
      org.address ? `Address ${org.address}.` : null,
    ]
      .filter(Boolean)
      .join(" ");
  }
  const order = pickOrder(knowledge, text);
  if (!order) {
    return `I can help with orders and tracking for ${org.name}. Share your order number if you have one.`;
  }
  if (intent === "tracking") {
    return [
      order.lastScan
        ? `Your order ${order.orderNumber} is currently: ${order.lastScan}${order.lastOffice ? ` at ${order.lastOffice}` : ""}.`
        : `Order ${order.orderNumber} is ${order.status.replace(/_/g, " ").toLowerCase()}.`,
      order.trackingNumber ? `Tracking ID ${order.trackingNumber}.` : null,
      order.trackingUrl ? `Track: ${order.trackingUrl}` : null,
    ]
      .filter(Boolean)
      .join(" ");
  }
  if (intent === "shipped") {
    return order.bookedAt
      ? `Order ${order.orderNumber} was handed to India Post at ${order.bookedAt}. Tracking ID ${order.trackingNumber ?? "is not assigned yet"}.`
      : `Order ${order.orderNumber} is ${order.status.replace(/_/g, " ").toLowerCase()}. It is not marked as shipped yet.`;
  }
  if (intent === "unknown") {
    return `I am the ${VACHAT_ASSISTANT_NAME}. I can share order status, where the parcel is now, when it shipped, and ${org.name} contact details.`;
  }
  return orderLines(order).join(" ");
}

export function parseInboundMessage(data: Record<string, unknown> | undefined) {
  const record = data ?? {};
  const nested =
    record.message && typeof record.message === "object" ? (record.message as Record<string, unknown>) : record;
  const from = String(record.from ?? record.wa_id ?? record.phone ?? record.to ?? nested.from ?? "").trim();
  const text = String(
    record.text ?? record.body ?? nested.text ?? nested.body ?? (typeof record.message === "string" ? record.message : "")
  ).trim();
  return { from, text };
}

export function isInboundAssistantEvent(event: string, data?: Record<string, unknown>) {
  const key = event.toLowerCase();
  if (key.includes("status")) return false;
  if (key.includes("inbound") || key.includes("received") || key.includes("conversation")) return true;
  if (key.includes("message") && parseInboundMessage(data).text) return true;
  return false;
}

async function postAssistantReply(to: string, text: string, merchantId: string | null) {
  const platform = await getPlatformVachatConfig();
  if (!isPlatformVachatActive(platform)) return { sent: false };
  const res = await fetch(`${platform.apiBaseUrl.replace(/\/$/, "")}/api/postbus/messages`, {
    method: "POST",
    headers: vachatHeaders(platform.apiKey),
    body: JSON.stringify({
      merchant_id: merchantId,
      to,
      text,
      role: "assistant",
      assistant: VACHAT_ASSISTANT_NAME,
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    logError("vachat.assistant.reply_failed", { status: res.status });
    return { sent: false };
  }
  return { sent: true };
}

export async function handleVachatAssistantMessage(
  supabase: SupabaseClient,
  input: { from: string; text: string; merchantId?: string | null }
) {
  const platform = await getPlatformVachatConfig();
  if (!isPlatformVachatActive(platform)) return { handled: false, reason: "platform_off" };
  if (!input.text.trim()) return { handled: false, reason: "empty" };

  let merchantId = input.merchantId?.trim() || "";
  if (!merchantId) {
    const orgs = await findOrganizationsForCustomerPhone(supabase, input.from);
    merchantId = orgs[0] ?? "";
  }
  if (!merchantId) {
    await postAssistantReply(
      input.from,
      "I can help with PostBus orders and tracking. Share the order number from your merchant.",
      null
    );
    return { handled: true, reason: "no_merchant" };
  }

  const knowledge = await loadMerchantKnowledge(supabase, merchantId);
  if (!knowledge) {
    return { handled: false, reason: "missing_org" };
  }
  const reply = answerFromKnowledge(knowledge, input.text);
  await postAssistantReply(input.from, reply, merchantId);
  void syncMerchantKnowledge(supabase, merchantId).catch((error) => {
    logError("vachat.knowledge.sync_failed", {
      organizationId: merchantId,
      message: error instanceof Error ? error.message : "unknown",
    });
  });
  return { handled: true, reply, merchantId, document: formatKnowledgeDocument(knowledge) };
}
