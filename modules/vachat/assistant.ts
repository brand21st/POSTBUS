import type { SupabaseClient } from "@supabase/supabase-js";
import { logError } from "@/lib/logger";
import {
  CUSTOMER_PHONE_ONLY_REPLY,
  type MerchantKnowledge,
  type MerchantKnowledgeOrder,
  VACHAT_ASSISTANT_NAME,
} from "@/modules/vachat/knowledge";
import { getPlatformVachatConfig, isPlatformVachatActive } from "@/modules/vachat/platform-config";
import { sendVachatSessionText } from "@/modules/vachat/send";

export type AssistantIntent =
  | "merchant"
  | "tracking"
  | "shipped"
  | "invoice"
  | "shipment"
  | "order"
  | "unknown";

export function classifyAssistantIntent(text: string): AssistantIntent {
  const q = text.toLowerCase();
  if (/merchant|seller|shop name|workspace|phone number|contact|website|address|email|gstin/.test(q)) {
    return "merchant";
  }
  if (/invoice|bill|gst/.test(q)) return "invoice";
  if (/timeline|scan|history|where|now|current|track|status|location|reached|out for delivery|ndr/.test(q)) {
    return "tracking";
  }
  if (/when shipped|shipped|booked|packed|dispatched|handed over/.test(q)) {
    return "shipped";
  }
  if (/shipment information|shipment details|my shipment/.test(q)) return "shipment";
  if (
    /order|details|amount|cod|item|product|my parcel|my packet/.test(q) ||
    /\b[A-Z]{2}\d{9}[A-Z]{2}\b/i.test(text) ||
    /\b(?:order\s*)?#?\s*(?:PB-)?\d{3,}\b/i.test(text)
  ) {
    return "order";
  }
  return "unknown";
}

export function looksLikeOrderOrTrackingQuery(text: string) {
  return /\b[A-Z]{2}\d{9}[A-Z]{2}\b/i.test(text) || /\b(?:order\s*)?#?\s*(?:PB-)?\d{3,}\b/i.test(text);
}

export function pickOrder(knowledge: MerchantKnowledge, text: string) {
  const upper = text.toUpperCase();
  const byNumber = knowledge.orders.find(
    (order) => order.orderNumber && upper.includes(order.orderNumber.toUpperCase())
  );
  if (byNumber) return byNumber;
  const byTracking = knowledge.orders.find(
    (order) => order.trackingNumber && upper.includes(order.trackingNumber.toUpperCase())
  );
  if (byTracking) return byTracking;
  if (looksLikeOrderOrTrackingQuery(text)) return null;
  return knowledge.orders[0] ?? null;
}

function orderLines(order: MerchantKnowledgeOrder) {
  return [
    `Order ${order.orderNumber} is ${order.status.replace(/_/g, " ").toLowerCase()}.`,
    order.amount ? `Amount ${order.amount}.` : null,
    order.paymentStatus ? `Payment ${order.paymentStatus.replace(/_/g, " ").toLowerCase()}.` : null,
    order.items.length ? `Items: ${order.items.join(", ")}.` : null,
    order.invoiceNumber ? `Invoice ${order.invoiceNumber}${order.invoiceTotal ? ` total ${order.invoiceTotal}` : ""}.` : null,
    order.trackingNumber ? `India Post tracking ID ${order.trackingNumber}.` : "Tracking is not assigned yet.",
    order.shipmentStatus ? `Shipment ${order.shipmentStatus.replace(/_/g, " ").toLowerCase()}.` : null,
    order.bookedAt ? `Handed to India Post at ${order.bookedAt}.` : null,
    order.lastScan ? `Latest scan: ${order.lastScan}${order.lastOffice ? ` at ${order.lastOffice}` : ""}.` : null,
    order.trackingUrl ? `Track: ${order.trackingUrl}` : null,
  ].filter(Boolean) as string[];
}

function timelineLines(order: MerchantKnowledgeOrder) {
  if (!order.timeline.length) return [] as string[];
  return [
    "Tracking timeline:",
    ...order.timeline.slice(0, 8).map((item) =>
      [item.at, item.office, item.description].filter(Boolean).join(" · ")
    ),
  ];
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
      org.gstin ? `GSTIN ${org.gstin}.` : null,
      org.address ? `Address ${org.address}.` : null,
    ]
      .filter(Boolean)
      .join(" ");
  }
  const order = pickOrder(knowledge, text);
  if (!order) {
    return CUSTOMER_PHONE_ONLY_REPLY;
  }
  if (intent === "tracking") {
    return [
      order.lastScan
        ? `Your order ${order.orderNumber} is currently: ${order.lastScan}${order.lastOffice ? ` at ${order.lastOffice}` : ""}.`
        : `Order ${order.orderNumber} is ${order.status.replace(/_/g, " ").toLowerCase()}.`,
      order.trackingNumber ? `India Post tracking ID ${order.trackingNumber}.` : null,
      order.trackingUrl ? `Track: ${order.trackingUrl}` : null,
      ...timelineLines(order),
    ]
      .filter(Boolean)
      .join(" ");
  }
  if (intent === "shipped") {
    return order.bookedAt
      ? `Order ${order.orderNumber} was handed to India Post at ${order.bookedAt}. India Post tracking ID ${order.trackingNumber ?? "is not assigned yet"}.`
      : `Order ${order.orderNumber} is ${order.status.replace(/_/g, " ").toLowerCase()}. It is not marked as shipped yet.`;
  }
  if (intent === "invoice") {
    return order.invoiceNumber
      ? `Invoice ${order.invoiceNumber} for order ${order.orderNumber}${order.invoiceDate ? ` dated ${order.invoiceDate}` : ""}${order.invoiceTotal ? ` total ${order.invoiceTotal}` : ""}.`
      : `No invoice is ready yet for order ${order.orderNumber}.`;
  }
  if (intent === "shipment") {
    return [
      order.shipmentStatus
        ? `Shipment for order ${order.orderNumber} is ${order.shipmentStatus.replace(/_/g, " ").toLowerCase()}.`
        : `No shipment is created yet for order ${order.orderNumber}.`,
      order.trackingNumber ? `India Post tracking ID ${order.trackingNumber}.` : null,
      order.bookedAt ? `Booked ${order.bookedAt}.` : null,
    ]
      .filter(Boolean)
      .join(" ");
  }
  if (intent === "unknown") {
    return `I am the ${VACHAT_ASSISTANT_NAME}. I can share this number's order information, shipment information, India Post tracking ID, tracking timeline, invoice, and ${org.name} contact details.`;
  }
  return orderLines(order).join(" ");
}

export function parseInboundMessage(data: Record<string, unknown> | undefined) {
  const record = data ?? {};
  const nested =
    record.message && typeof record.message === "object" ? (record.message as Record<string, unknown>) : record;
  const contact =
    record.contact && typeof record.contact === "object" ? (record.contact as Record<string, unknown>) : {};
  const from = String(
    record.from ??
      record.wa_id ??
      record.phone ??
      nested.from ??
      contact.phone ??
      contact.wa_id ??
      ""
  ).trim();
  const text = String(
    record.text ??
      record.content_text ??
      record.body ??
      nested.text ??
      nested.content_text ??
      nested.body ??
      (typeof record.message === "string" ? record.message : "")
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

async function postAssistantReply(to: string, text: string) {
  return sendVachatSessionText(to, text);
}

export async function handleVachatAssistantMessage(
  supabase: SupabaseClient,
  input: { from: string; text: string; merchantId?: string | null }
) {
  const platform = await getPlatformVachatConfig();
  if (!isPlatformVachatActive(platform)) return { handled: false, reason: "platform_off" };
  if (!input.text.trim() || !input.from.trim()) return { handled: false, reason: "empty" };

  try {
    const { searchOrderDetails } = await import("@/modules/vachat/mcp");
    const search = await searchOrderDetails(supabase, {
      whatsapp: input.from,
      query: input.text,
      merchant_id: input.merchantId || undefined,
      account: "post@post.com",
    });
    const sent = await postAssistantReply(input.from, search.answer);
    return {
      handled: true,
      sent: sent.sent,
      reply: search.answer,
      merchantId: search.results[0]?.merchant_id ?? search.organizations[0]?.merchant_id ?? null,
    };
  } catch (error) {
    logError("vachat.assistant.search_failed", {
      message: error instanceof Error ? error.message : "unknown",
    });
    return { handled: false, reason: "search_failed" };
  }
}
