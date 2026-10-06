import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError } from "@/lib/api/errors";
import { logError } from "@/lib/logger";
import {
  CUSTOMER_PHONE_ONLY_REPLY,
  findOrganizationsForCustomerPhone,
  type MerchantKnowledge,
  type MerchantKnowledgeOrder,
  VACHAT_ASSISTANT_NAME,
} from "@/modules/vachat/knowledge";
import {
  listEligibleOrders,
  type EligibleOrderChoice,
} from "@/modules/vachat/eligible-orders";
import { getPlatformVachatConfig, isPlatformVachatActive } from "@/modules/vachat/platform-config";
import { searchOrderDetails } from "@/modules/vachat/mcp";
import { platformSupportMcpContext } from "@/modules/vachat/mcp-context";
import { sendVachatSessionText } from "@/modules/vachat/send";
import { selectSupportOrder } from "@/modules/vachat/select-order";
import {
  getOrCreateSupportSession,
  getSupportSessionByPhone,
  setSupportSessionState,
  type WhatsappSupportSession,
} from "@/modules/vachat/support-session";
import {
  isInboundAssistantEvent,
  parseInboundMessage,
  resolveInboundSender,
} from "@/modules/vachat/inbound";
import {
  formatPolicyWhatsAppReply,
  loadOrganizationPolicies,
  loadPolicyReplyContext,
  matchPolicyIntent,
  POLICY_PICK_MERCHANT_REPLY,
  policyExtrasMap,
} from "@/modules/vachat/policies";

export { isInboundAssistantEvent, parseInboundMessage, resolveInboundSender };

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

export function isPlatformOrderSupportTurn(text: string, session?: WhatsappSupportSession | null) {
  const intent = classifyAssistantIntent(text);
  if (intent === "tracking" || intent === "shipped" || intent === "shipment" || intent === "order" || intent === "invoice") {
    return true;
  }
  if (session?.state === "AWAIT_SELECTION") {
    const raw = text.trim();
    if (/^\d+$/.test(raw) || looksLikeOrderOrTrackingQuery(text)) return true;
  }
  return false;
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

export const NO_ELIGIBLE_ORDERS_REPLY =
  "We couldn't find any active orders linked to this WhatsApp number. Please contact the merchant if you believe this is incorrect.";

export const SUPPORT_UNAVAILABLE_REPLY =
  "Sorry, I couldn't retrieve that information right now. Please try again shortly.";

export function formatOrderPicker(choices: EligibleOrderChoice[]) {
  const lines = choices.map(
    (choice, index) => `${index + 1}. ${choice.merchant_name} — ${choice.order_ref} — ${choice.status}`
  );
  return [
    "I found multiple orders linked to this WhatsApp number:",
    "",
    ...lines,
    "",
    "Please reply with the number of the order you want help with.",
  ].join("\n");
}

export function matchPickerSelection(text: string, choices: EligibleOrderChoice[]) {
  const raw = text.trim();
  if (!raw || !choices.length) return null;
  if (/^\d+$/.test(raw)) {
    const index = Number(raw);
    if (index >= 1 && index <= choices.length) return choices[index - 1] ?? null;
    return null;
  }
  const upper = raw.toUpperCase();
  const hits = choices.filter((choice) => upper.includes(choice.order_ref.toUpperCase()));
  return hits.length === 1 ? hits[0] : null;
}

function isBusinessLineError(error: unknown) {
  return error instanceof AppError && /PostBus WhatsApp line/i.test(error.message);
}

async function liveBoundTurn(
  supabase: SupabaseClient,
  session: WhatsappSupportSession,
  query: string,
  now: Date
) {
  const trusted = platformSupportMcpContext(session.id);
  const bound = await searchOrderDetails(supabase, { query, now }, trusted);
  return {
    reply: bound.answer,
    session,
    organizationId: bound.found ? session.selected_organization_id : null,
  };
}

export async function handlePlatformSupportTurn(
  supabase: SupabaseClient,
  input: { from: string; text: string; now?: Date }
) {
  const now = input.now ?? new Date();
  const session = await getOrCreateSupportSession(supabase, input.from, now);

  if (session.state === "ORDER_BOUND" && session.selected_order_id && session.selected_organization_id) {
    return liveBoundTurn(supabase, session, input.text, now);
  }

  const listed = await listEligibleOrders(supabase, { session, now });
  const choices = listed.choices;

  if (choices.length === 0) {
    await setSupportSessionState(supabase, session.id, "LIST_ELIGIBLE", now);
    return { reply: NO_ELIGIBLE_ORDERS_REPLY, session, organizationId: null as string | null };
  }

  const picked = choices.length === 1 ? choices[0] : matchPickerSelection(input.text, choices);
  if (picked) {
    const selected = await selectSupportOrder(supabase, {
      sessionId: session.id,
      choiceRef: picked.ref,
      now,
    });
    if (!selected.ok) {
      return { reply: selected.message, session, organizationId: null as string | null };
    }
    return liveBoundTurn(supabase, selected.session, input.text, now);
  }

  const waiting = await setSupportSessionState(supabase, session.id, "AWAIT_SELECTION", now);
  return {
    reply: formatOrderPicker(choices),
    session: waiting,
    organizationId: null as string | null,
  };
}

async function postAssistantReply(to: string, text: string) {
  return sendVachatSessionText(to, text);
}

export async function handleVachatAssistantMessage(
  supabase: SupabaseClient,
  input: { from: string; text: string }
) {
  const platform = await getPlatformVachatConfig();
  if (!isPlatformVachatActive(platform)) return { handled: false, reason: "platform_off" };
  if (!input.text.trim() || !input.from.trim()) return { handled: false, reason: "empty" };

  try {
    let existing: WhatsappSupportSession | null = null;
    try {
      existing = await getSupportSessionByPhone(supabase, input.from);
    } catch (error) {
      if (isBusinessLineError(error)) {
        return { handled: false, reason: "business_number" };
      }
      throw error;
    }
    if (isPlatformOrderSupportTurn(input.text, existing)) {
      const turn = await handlePlatformSupportTurn(supabase, { from: input.from, text: input.text });
      const sent = await postAssistantReply(input.from, turn.reply);
      return {
        handled: true,
        sent: sent.sent,
        reply: turn.reply,
        organizationId: turn.organizationId,
      };
    }
    const extras = existing?.selected_organization_id
      ? policyExtrasMap(await loadOrganizationPolicies(supabase, existing.selected_organization_id))
      : undefined;
    const policyKind = matchPolicyIntent(input.text, extras);
    if (!policyKind) {
      return { handled: false, reason: "native" };
    }
    let organizationId = existing?.selected_organization_id ?? null;
    if (!organizationId) {
      const orgIds = await findOrganizationsForCustomerPhone(supabase, input.from);
      if (orgIds.length > 1) {
        const sent = await postAssistantReply(input.from, POLICY_PICK_MERCHANT_REPLY);
        return {
          handled: true,
          sent: sent.sent,
          reply: POLICY_PICK_MERCHANT_REPLY,
          organizationId: null,
        };
      }
      organizationId = orgIds[0] ?? null;
    }
    if (!organizationId) {
      return { handled: false, reason: "native" };
    }
    const context = await loadPolicyReplyContext(supabase, organizationId);
    const reply = formatPolicyWhatsAppReply(policyKind, context.policies, context.merchant);
    const sent = await postAssistantReply(input.from, reply);
    return {
      handled: true,
      sent: sent.sent,
      reply,
      organizationId,
    };
  } catch (error) {
    if (isBusinessLineError(error)) {
      return { handled: false, reason: "business_number" };
    }
    logError("vachat.assistant.support_failed", {
      message: error instanceof Error ? error.message : "unknown",
    });
    try {
      await postAssistantReply(input.from, SUPPORT_UNAVAILABLE_REPLY);
    } catch {
      // keep original failure
    }
    return { handled: false, reason: "search_failed" };
  }
}
