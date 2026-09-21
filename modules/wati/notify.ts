import { watiPhoneNumber, type WatiTemplateParam } from "@/modules/wati/client";

export const WATI_NOTIFY_EVENTS = [
  "order_confirmation",
  "processing",
  "booked",
  "in_transit",
  "delivered",
] as const;

export type WatiNotifyEvent = (typeof WATI_NOTIFY_EVENTS)[number];

export type WatiTemplateMap = {
  order_confirmation_template_name?: string | null;
  processing_template_name?: string | null;
  booked_template_name?: string | null;
  in_transit_template_name?: string | null;
  delivered_template_name?: string | null;
};

export type WatiNotifyShipment = {
  customerName?: string | null;
  shopName?: string | null;
  phone?: string | null;
  orderNumber?: string | null;
  trackingNumber?: string | null;
  barcode?: string | null;
  trackingUrl?: string | null;
};

const TEMPLATE_COLUMN: Record<WatiNotifyEvent, keyof WatiTemplateMap> = {
  order_confirmation: "order_confirmation_template_name",
  processing: "processing_template_name",
  booked: "booked_template_name",
  in_transit: "in_transit_template_name",
  delivered: "delivered_template_name",
};

export function isApprovedWatiTemplate(status?: string | null) {
  return (status ?? "").trim().toUpperCase() === "APPROVED";
}

export function watiTemplateForEvent(event: WatiNotifyEvent, templates: WatiTemplateMap) {
  return templates[TEMPLATE_COLUMN[event]]?.trim() || null;
}

export function watiBroadcastName(event: WatiNotifyEvent, reference?: string | null) {
  return `postbus_${event}_${reference || "update"}`.slice(0, 80);
}

export function watiShipmentParams(input: WatiNotifyShipment): WatiTemplateParam[] {
  const customer = input.customerName?.trim() || "Customer";
  const shop = input.shopName?.trim() || "";
  const order = input.orderNumber?.trim() || "";
  const tracking = input.trackingNumber?.trim() || input.barcode?.trim() || "";
  const link = input.trackingUrl?.trim() || "";
  const pairs: Array<[string, string]> = [
    ["customer_name", customer],
    ["name", customer],
    ["shop_name", shop],
    ["order_id", order],
    ["order_number", order],
    ["tracking_number", tracking],
    ["tracking_id", tracking],
    ["barcode", tracking],
    ["tracking_url", link],
    ["tracking_link", link],
    ["tracking_url_partial_variable", link],
  ];
  return pairs.filter(([, value]) => value).map(([name, value]) => ({ name, value }));
}

export function watiNotifyRecipient(input: WatiNotifyShipment) {
  const phone = watiPhoneNumber(input.phone);
  if (!phone) return null;
  return {
    phone_number: phone,
    custom_params: watiShipmentParams(input),
  };
}
