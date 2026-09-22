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

export function isWatiUtilityTemplate(category?: string | null) {
  return (category ?? "").trim().toUpperCase() === "UTILITY";
}

export function isApprovedWatiUtilityTemplate(status?: string | null, category?: string | null) {
  return isApprovedWatiTemplate(status) && isWatiUtilityTemplate(category);
}

export function watiTemplateForEvent(event: WatiNotifyEvent, templates: WatiTemplateMap) {
  return templates[TEMPLATE_COLUMN[event]]?.trim() || null;
}

export function watiBroadcastName(event: WatiNotifyEvent, reference?: string | null) {
  return `postbus_${event}_${reference || "update"}`.slice(0, 80);
}

export function watiTemplatePreview(body?: string | null) {
  return (body ?? "").replace(/\s+/g, " ").trim();
}

export function watiValuesForPlaceholders(body: string | null | undefined, input: WatiNotifyShipment) {
  const customer = input.customerName?.trim() || "Customer";
  const shop = input.shopName?.trim() || "our store";
  const order = input.orderNumber?.trim() || "";
  const tracking = input.trackingNumber?.trim() || input.barcode?.trim() || "";
  const link = input.trackingUrl?.trim() || tracking;
  const text = body ?? "";
  const indexes = [...text.matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((match) => Number(match[1]));
  const unique = [...new Set(indexes)].filter((index) => index > 0).sort((left, right) => left - right);
  return unique.map((index) => placeholderValue(text, index, { customer, shop, order, tracking, link }));
}

function placeholderValue(
  text: string,
  index: number,
  values: { customer: string; shop: string; order: string; tracking: string; link: string }
) {
  const at = text.search(new RegExp(`\\{\\{\\s*${index}\\s*\\}\\}`));
  const before = text.slice(Math.max(0, at - 90), Math.max(0, at)).toLowerCase();
  if (/track|shipment here|click|button|http/.test(before)) return values.link || values.tracking;
  if (/from\s*$/.test(before) || /this is\s*$/.test(before)) return values.shop;
  if (/order(?:\s+of)?\s*$/.test(before)) return values.order || values.tracking;
  if (/(?:hi|hello|dear)\b[^.\n]{0,24}$/.test(before)) return values.customer;
  return values.customer;
}

export function watiTemplateCustomParams(
  input: WatiNotifyShipment,
  template?: { body?: string | null; customParams?: Array<{ name?: string | null }> | null } | null
): WatiTemplateParam[] {
  const positional = watiValuesForPlaceholders(template?.body, input);
  const names = (template?.customParams ?? []).map((param) => param.name?.trim() || "").filter(Boolean);
  const params: WatiTemplateParam[] = [];
  const seen = new Set<string>();
  const add = (name: string, value: string) => {
    if (!name || seen.has(name) || !value) return;
    seen.add(name);
    params.push({ name, value });
  };
  names.forEach((name, index) => add(name, positional[index] || ""));
  positional.forEach((value, index) => add(String(index + 1), value));
  for (const param of watiShipmentParams(input)) add(param.name, param.value);
  return params;
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

export function watiNotifyRecipient(
  input: WatiNotifyShipment,
  template?: { body?: string | null; customParams?: Array<{ name?: string | null }> | null } | null
) {
  const phone = watiPhoneNumber(input.phone);
  if (!phone) return null;
  return {
    phone_number: phone,
    custom_params: watiTemplateCustomParams(input, template),
  };
}
