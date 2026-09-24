import type { SupabaseClient } from "@supabase/supabase-js";

export const ORDER_STAGE_EVENTS = ["processing", "booked", "in_transit", "delivered"] as const;

export type OrderStageEvent = (typeof ORDER_STAGE_EVENTS)[number];

const STAGE_COPY: Record<OrderStageEvent, { type: string; title: string }> = {
  processing: { type: "order.processing", title: "Order processing" },
  booked: { type: "shipment.booked", title: "Order fulfilled" },
  in_transit: { type: "shipment.in_transit", title: "Order in transit" },
  delivered: { type: "shipment.delivered", title: "Order delivered" },
};

export function orderStageNotificationType(event: OrderStageEvent) {
  return STAGE_COPY[event].type;
}

function defaultBody(event: OrderStageEvent, orderNumber: string) {
  return event === "booked" ? `${orderNumber} · booked` : orderNumber;
}

export async function insertOrderStageNotification(
  supabase: SupabaseClient,
  input: {
    organizationId: string;
    orderId: string;
    event: OrderStageEvent;
    body?: string | null;
  }
) {
  const copy = STAGE_COPY[input.event];
  let body = input.body?.trim() || null;
  if (!body) {
    const { data } = await supabase.from("orders").select("order_number").eq("id", input.orderId).maybeSingle();
    const orderNumber = data?.order_number || input.orderId.slice(0, 8);
    body = defaultBody(input.event, orderNumber);
  }

  await supabase.from("notifications").insert({
    organization_id: input.organizationId,
    type: copy.type,
    title: copy.title,
    body,
    entity_type: "order",
    entity_id: input.orderId,
  });
}
