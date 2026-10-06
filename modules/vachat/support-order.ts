import type { SupabaseClient } from "@supabase/supabase-js";
import {
  customerPhonesMatch,
  orderIdsForCustomerPhone,
  postbusTrackingLink,
  VACHAT_BUSINESS_WHATSAPP,
} from "@/modules/vachat/knowledge";
import { isWhatsAppSupportEligible } from "@/modules/vachat/support-eligibility";
import {
  findSupportSessionById,
  isSupportSessionExpired,
  sessionPhoneDigits,
} from "@/modules/vachat/support-session";

export const BOUND_SUPPORT_REJECTED = "REJECTED";
export const BOUND_SUPPORT_EXPIRED = "SESSION_EXPIRED";
export const BOUND_SUPPORT_UNBOUND = "UNBOUND";

export type BoundSupportLastEvent = {
  at: string | null;
  office: string | null;
  description: string | null;
};

export type BoundSupportOrder = {
  order_ref: string;
  order_status: string;
  created_at: string | null;
  merchant_name: string;
  merchant_phone: string | null;
  merchant_website: string | null;
  merchant_email: string | null;
  shipment_status: string | null;
  tracking_number: string | null;
  booked_at: string | null;
  last_event: BoundSupportLastEvent | null;
  items: string[];
  tracking_link: string;
};

export type GetBoundSupportOrderInput = {
  sessionId: string;
  now?: Date;
  order_id?: string | null;
  organization_id?: string | null;
  merchant_id?: string | null;
  tracking_number?: string | null;
  whatsapp?: string | null;
  phone?: string | null;
  customer_id?: string | null;
};

export type GetBoundSupportOrderResult =
  | { ok: true; order: BoundSupportOrder }
  | {
      ok: false;
      code: typeof BOUND_SUPPORT_REJECTED | typeof BOUND_SUPPORT_EXPIRED | typeof BOUND_SUPPORT_UNBOUND;
      message: string;
    };

const SAFE_REJECT: Extract<GetBoundSupportOrderResult, { ok: false }> = {
  ok: false,
  code: BOUND_SUPPORT_REJECTED,
  message: "That order is not available for WhatsApp support.",
};

const SAFE_EXPIRED: Extract<GetBoundSupportOrderResult, { ok: false }> = {
  ok: false,
  code: BOUND_SUPPORT_EXPIRED,
  message: "This support session has expired. Please start again.",
};

const SAFE_UNBOUND: Extract<GetBoundSupportOrderResult, { ok: false }> = {
  ok: false,
  code: BOUND_SUPPORT_UNBOUND,
  message: "Please choose which order you want help with first.",
};

function asList<T>(value: T | T[] | null | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function firstRelated<T>(value: T | T[] | null | undefined): T | null {
  return asList(value)[0] ?? null;
}

function safeMerchantPhone(raw?: string | null) {
  const phone = raw?.trim() || null;
  if (!phone) return null;
  if (customerPhonesMatch(phone, VACHAT_BUSINESS_WHATSAPP)) return null;
  if (customerPhonesMatch(phone, "8848772371")) return null;
  return phone;
}

export function formatBoundSupportOrderReply(order: BoundSupportOrder) {
  const lines = [
    `${order.merchant_name} order ${order.order_ref} is ${order.order_status.replace(/_/g, " ").toLowerCase()}.`,
    order.items.length ? `Items: ${order.items.join(", ")}.` : null,
    order.shipment_status
      ? `Shipment ${order.shipment_status.replace(/_/g, " ").toLowerCase()}.`
      : null,
    order.tracking_number ? `India Post tracking ID ${order.tracking_number}.` : "Tracking is not assigned yet.",
    order.last_event?.description
      ? `Latest scan: ${order.last_event.description}${order.last_event.office ? ` at ${order.last_event.office}` : ""}.`
      : null,
    order.tracking_number ? `Track: ${order.tracking_link}` : null,
    order.merchant_phone ? `Store phone ${order.merchant_phone}.` : null,
  ].filter(Boolean) as string[];
  return lines.join(" ");
}

export async function getBoundSupportOrder(
  supabase: SupabaseClient,
  input: GetBoundSupportOrderInput
): Promise<GetBoundSupportOrderResult> {
  const now = input.now ?? new Date();
  void input.order_id;
  void input.organization_id;
  void input.merchant_id;
  void input.tracking_number;
  void input.whatsapp;
  void input.phone;
  void input.customer_id;
  const session = await findSupportSessionById(supabase, input.sessionId);
  if (!session || session.source !== "platform" || !session.phone_digits) return SAFE_REJECT;
  if (isSupportSessionExpired(session, now)) return SAFE_EXPIRED;
  try {
    sessionPhoneDigits(session.phone_digits);
  } catch {
    return SAFE_REJECT;
  }
  if (session.state !== "ORDER_BOUND" || !session.selected_order_id || !session.selected_organization_id) {
    return SAFE_UNBOUND;
  }

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select(
      "id, order_number, status, created_at, organization_id, customer_id, shipping_address_id, customers(phone), addresses:shipping_address_id(phone)"
    )
    .eq("id", session.selected_order_id)
    .eq("organization_id", session.selected_organization_id)
    .maybeSingle();
  if (orderError || !order?.id) return SAFE_REJECT;

  const customer = firstRelated(order.customers as { phone?: string | null } | { phone?: string | null }[]);
  const address = firstRelated(order.addresses as { phone?: string | null } | { phone?: string | null }[]);
  const owned =
    customerPhonesMatch(address?.phone ?? customer?.phone, session.phone_digits) ||
    (await orderIdsForCustomerPhone(supabase, session.selected_organization_id, `+91${session.phone_digits}`)).includes(
      String(order.id)
    );
  if (!owned) return SAFE_REJECT;

  const [
    { data: org },
    { data: invoice },
    { data: items },
    { data: shipments, error: shipmentError },
  ] = await Promise.all([
    supabase.from("organizations").select("id, name, phone").eq("id", session.selected_organization_id).maybeSingle(),
    supabase
      .from("invoice_settings")
      .select("website, business_email")
      .eq("organization_id", session.selected_organization_id)
      .maybeSingle(),
    supabase
      .from("order_line_items")
      .select("title, quantity")
      .eq("organization_id", session.selected_organization_id)
      .eq("order_id", session.selected_order_id)
      .limit(20),
    supabase
      .from("shipments")
      .select("id, organization_id, order_id, status, tracking_number, barcode, booked_at, delivered_at")
      .eq("organization_id", session.selected_organization_id)
      .eq("order_id", session.selected_order_id)
      .order("updated_at", { ascending: false })
      .limit(1),
  ]);
  if (shipmentError) return SAFE_REJECT;
  if (!org?.id || String(org.id) !== session.selected_organization_id) return SAFE_REJECT;

  const shipment = asList(shipments as Array<Record<string, unknown>> | null)[0] ?? null;
  if (shipment && String(shipment.order_id) !== session.selected_order_id) return SAFE_REJECT;
  if (shipment && String(shipment.organization_id) !== session.selected_organization_id) return SAFE_REJECT;
  if (
    !isWhatsAppSupportEligible({
      deliveredAt: shipment?.delivered_at ? String(shipment.delivered_at) : null,
      now,
    })
  ) {
    return SAFE_REJECT;
  }

  let lastEvent: BoundSupportLastEvent | null = null;
  if (shipment?.id) {
    const { data: events } = await supabase
      .from("tracking_events")
      .select("event_description, office_name, occurred_at, event_code, shipment_id, organization_id")
      .eq("organization_id", session.selected_organization_id)
      .eq("shipment_id", String(shipment.id))
      .order("occurred_at", { ascending: false })
      .limit(1);
    const event = asList(events as Array<Record<string, unknown>> | null)[0];
    if (event && String(event.shipment_id) === String(shipment.id)) {
      lastEvent = {
        at: event.occurred_at ? String(event.occurred_at) : null,
        office: event.office_name ? String(event.office_name) : null,
        description: event.event_description
          ? String(event.event_description)
          : event.event_code
            ? String(event.event_code)
            : null,
      };
    }
  }

  const trackingNumber = shipment
    ? String(shipment.tracking_number || shipment.barcode || "") || null
    : null;

  return {
    ok: true,
    order: {
      order_ref: String(order.order_number ?? "").trim(),
      order_status: String(order.status ?? ""),
      created_at: order.created_at ? String(order.created_at) : null,
      merchant_name: String(org.name ?? "").trim() || "Merchant",
      merchant_phone: safeMerchantPhone(typeof org.phone === "string" ? org.phone : null),
      merchant_website: typeof invoice?.website === "string" ? invoice.website.trim() || null : null,
      merchant_email: typeof invoice?.business_email === "string" ? invoice.business_email.trim() || null : null,
      shipment_status: shipment ? String(shipment.status ?? "") : null,
      tracking_number: trackingNumber,
      booked_at: shipment?.booked_at ? String(shipment.booked_at) : null,
      last_event: lastEvent,
      items: asList(items as Array<{ title?: string; quantity?: number }> | null)
        .map((item) => [item.quantity ? `${item.quantity}x` : null, item.title].filter(Boolean).join(" "))
        .filter(Boolean),
      tracking_link: postbusTrackingLink(trackingNumber),
    },
  };
}
