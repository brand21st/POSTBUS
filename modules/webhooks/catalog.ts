export const WEBHOOK_ENVELOPE_VERSION = "2026-10-18";

export const MERCHANT_WEBHOOK_EVENTS = [
  "order.created",
  "order.updated",
  "shipment.booking_requested",
  "shipment.booked",
  "shipment.booking_failed",
  "tracking.updated",
  "shipment.out_for_delivery",
  "shipment.delivered",
  "shipment.exception",
  "webhook.test",
] as const;

export type MerchantWebhookEvent = (typeof MERCHANT_WEBHOOK_EVENTS)[number];

const ALIASES: Record<string, MerchantWebhookEvent> = {
  "shipment.created": "shipment.booking_requested",
  "shipment.failed": "shipment.booking_failed",
};

const RETURN_STATUSES = new Set(["RTO", "RTO_IN_TRANSIT", "RTO_DELIVERED"]);

export function canonicalWebhookEvent(event: string): MerchantWebhookEvent | null {
  if ((MERCHANT_WEBHOOK_EVENTS as readonly string[]).includes(event)) return event as MerchantWebhookEvent;
  return ALIASES[event] ?? null;
}

export function subscriptionMatches(subscribed: string[] | null | undefined, eventType: string) {
  if (!subscribed?.length) return true;
  const canonical = canonicalWebhookEvent(eventType) ?? eventType;
  return subscribed.some((name) => {
    const mapped = canonicalWebhookEvent(name) ?? name;
    return mapped === canonical || name === eventType;
  });
}

export function normalizeSubscriptionEvents(events: string[] | undefined) {
  if (!events?.length) {
    return MERCHANT_WEBHOOK_EVENTS.filter((event) => event !== "webhook.test");
  }
  const unique = new Set<string>();
  for (const event of events) {
    const canonical = canonicalWebhookEvent(event);
    if (!canonical || canonical === "webhook.test") {
      throw new Error(`Unsupported webhook event: ${event}`);
    }
    unique.add(canonical);
  }
  return [...unique];
}

export type WebhookEventData = {
  shipment_id?: string | null;
  order_id?: string | null;
  order_number?: string | null;
  external_order_id?: string | null;
  awb?: string | null;
  status?: string | null;
  previous_status?: string | null;
  tracking_url?: string | null;
  error_code?: string | null;
};

export function buildWebhookEnvelope(input: {
  id: string;
  type: string;
  createdAt: string;
  data: WebhookEventData;
}) {
  const data: Record<string, string> = {};
  for (const [key, value] of Object.entries(input.data)) {
    if (typeof value === "string" && value.trim()) data[key] = value;
  }
  return {
    id: input.id,
    type: input.type,
    api_version: WEBHOOK_ENVELOPE_VERSION,
    created_at: input.createdAt,
    data,
  };
}

export function trackingStageEvents(input: {
  inserted: boolean;
  previousStatus: string;
  nextStatus: string;
  previousOperational: string | null;
  nextOperational: string | null;
}) {
  const events: Array<{ type: MerchantWebhookEvent; status: string }> = [];
  if (input.inserted) events.push({ type: "tracking.updated", status: input.nextStatus });
  if (input.nextStatus === "OUT_FOR_DELIVERY" && input.previousStatus !== "OUT_FOR_DELIVERY") {
    events.push({ type: "shipment.out_for_delivery", status: "OUT_FOR_DELIVERY" });
  }
  if (
    input.nextOperational === "DELIVERED" &&
    input.previousOperational !== "DELIVERED" &&
    input.nextStatus === "DELIVERED" &&
    !RETURN_STATUSES.has(input.previousOperational ?? "")
  ) {
    events.push({ type: "shipment.delivered", status: "DELIVERED" });
  }
  if (
    (input.nextOperational === "NDR" || input.nextOperational === "RTO") &&
    input.nextOperational !== input.previousOperational
  ) {
    events.push({ type: "shipment.exception", status: input.nextOperational });
  }
  return events;
}

export function shouldEmitOrderUpdated(previousStatus: string | null | undefined, nextStatus: string | null | undefined) {
  if (!previousStatus || !nextStatus) return false;
  return previousStatus !== nextStatus;
}

export function shouldEmitBookingRequested(previousStatus: string | null | undefined) {
  return previousStatus !== "QUEUED";
}
