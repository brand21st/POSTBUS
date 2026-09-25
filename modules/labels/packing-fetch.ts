import type { SupabaseClient } from "@supabase/supabase-js";
import { officialAddressLines } from "@/modules/labels/official-address";
import { loadLogoBytes } from "@/modules/labels/packing-data";
import { renderPackingSlipPdf, type PackingLabelData, type PackingParty } from "@/modules/labels/packing-pdf";
import { getLabelTemplate } from "@/modules/labels/template-service";
import type { LabelTemplate } from "@/modules/labels/template-schema";

export type PackingPartyInput = {
  name?: string | null;
  line1?: string | null;
  line2?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
  phone?: string | null;
};

function validationError(message: string): Error {
  return Object.assign(new Error(message), { code: "VALIDATION_ERROR" });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  if (Array.isArray(value)) return (value[0] as Record<string, unknown> | undefined) ?? null;
  if (typeof value === "object") return value as Record<string, unknown>;
  return null;
}

function moneyNumber(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function isPackingPlaceholder(value: string | null | undefined) {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return true;
  return /^address pending$/i.test(trimmed) || /^n\/?a$/i.test(trimmed) || /^registered\s*pickup$/i.test(trimmed);
}

function roleLabel(role: "receiver" | "sender") {
  return role === "receiver" ? "Receiver" : "Sender";
}

export function packingParty(input: PackingPartyInput, role: "receiver" | "sender"): PackingParty {
  const label = roleLabel(role);
  const name = (input.name ?? "").trim();
  if (isPackingPlaceholder(name)) {
    throw validationError(`${label} name is required for the packing slip.`);
  }
  const line1 = (input.line1 ?? "").trim();
  if (isPackingPlaceholder(line1)) {
    throw validationError(`${label} address is required for the packing slip.`);
  }
  const city = (input.city ?? "").trim();
  if (isPackingPlaceholder(city)) {
    throw validationError(`${label} city is required for the packing slip.`);
  }
  const state = (input.state ?? "").trim();
  if (isPackingPlaceholder(state)) {
    throw validationError(`${label} state is required for the packing slip.`);
  }
  const pin = (input.pincode ?? "").replace(/\D/g, "");
  if (!/^\d{6}$/.test(pin)) {
    throw validationError(`${label} pincode must be a 6-digit PIN for the packing slip.`);
  }
  const phoneDigits = (input.phone ?? "").replace(/\D/g, "");
  const phone = phoneDigits.length > 10 ? phoneDigits.slice(-10) : phoneDigits;
  if (phone === "0000000000" || phone.length !== 10) {
    throw validationError(`${label} phone number is required for the packing slip.`);
  }
  return {
    name,
    phone,
    lines: officialAddressLines({
      line1,
      line2: input.line2,
      city,
      state,
      pin,
    }),
  };
}

export function packingMerchantFromOrganization(org?: {
  name?: string | null;
  phone?: string | null;
  line1?: string | null;
  line2?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
} | null): PackingPartyInput {
  return {
    name: org?.name ?? null,
    phone: org?.phone ?? null,
    line1: org?.line1 ?? null,
    line2: org?.line2 ?? null,
    city: org?.city ?? null,
    state: org?.state ?? null,
    pincode: org?.pincode ?? null,
  };
}

export function packingCustomerFromShopifyAddress(
  shopifyAddress: Record<string, unknown> | null,
  customer: Record<string, unknown> | null
): PackingPartyInput {
  const text = (value: unknown) => (typeof value === "string" ? value : null);
  return {
    name: String(shopifyAddress?.name || customer?.name || "").trim() || null,
    line1: text(shopifyAddress?.line1) ?? text(shopifyAddress?.address1),
    line2: text(shopifyAddress?.line2) ?? text(shopifyAddress?.address2),
    city: text(shopifyAddress?.city),
    state: text(shopifyAddress?.state) ?? text(shopifyAddress?.province),
    pincode: text(shopifyAddress?.pincode) ?? text(shopifyAddress?.zip),
    phone: String(shopifyAddress?.phone || customer?.phone || "").trim() || null,
  };
}

export async function fetchPackingSlipPdf(
  supabase: SupabaseClient,
  organizationId: string,
  shipmentId: string
) {
  const { data: shipment } = await supabase
    .from("shipments")
    .select(
      "id, order_id, payment_mode, cod_amount, orders(id, order_number, source_order_id, created_at, payment_status, subtotal, discount, shipping_amount, total_amount, metadata, shipping_address:addresses!shipping_address_id(*), billing_address:addresses!billing_address_id(*)), customers(name, phone), addresses:shipping_address_id(*)"
    )
    .eq("id", shipmentId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (!shipment) {
    throw validationError("Shipment is missing.");
  }

  const order = asRecord(shipment.orders);
  const customer = asRecord(shipment.customers);
  const shopifyShipping =
    asRecord(order?.shipping_address) ?? asRecord(shipment.addresses);
  const receiver = packingParty(packingCustomerFromShopifyAddress(shopifyShipping, customer), "receiver");

  const { data: org } = await supabase
    .from("organizations")
    .select("name, phone, line1, line2, city, state, pincode, logo_path")
    .eq("id", organizationId)
    .maybeSingle();
  const { data: shop } = await supabase
    .from("shopify_stores")
    .select("shop_name, shop_domain")
    .eq("organization_id", organizationId)
    .maybeSingle();

  const sender = packingParty(packingMerchantFromOrganization(org), "sender");

  const orderId = String(order?.id || shipment.order_id || "");
  const { data: lineRows } = orderId
    ? await supabase
        .from("order_line_items")
        .select("title, sku, quantity, unit_price")
        .eq("order_id", orderId)
        .eq("organization_id", organizationId)
    : { data: [] as Array<{ title?: string; sku?: string | null; quantity?: number; unit_price?: number }> };

  const items = (lineRows ?? []).map((item) => ({
    title: item.title || "Item",
    sku: item.sku ?? null,
    quantity: Number(item.quantity) || 1,
    unitPrice: moneyNumber(item.unit_price),
  }));

  const paymentMode = String(shipment.payment_mode || order?.payment_status || "").toUpperCase();
  const metadata = asRecord(order?.metadata);
  const note = typeof metadata?.note === "string" ? metadata.note : "";
  const logo = await loadLogoBytes(supabase, org?.logo_path);
  const template = await getLabelTemplate(supabase, organizationId);
  const data: PackingLabelData = {
    storeName: String(org?.name || sender.name),
    storePhone: String(org?.phone || sender.phone),
    storeWebsite: String(shop?.shop_domain || shop?.shop_name || ""),
    orderNumber: String(order?.order_number || ""),
    shopifyOrderNumber: String(order?.source_order_id || ""),
    orderDate: formatPackingDate(order?.created_at),
    items,
    subtotal: moneyNumber(order?.subtotal),
    shipping: moneyNumber(order?.shipping_amount),
    discount: moneyNumber(order?.discount),
    total: moneyNumber(order?.total_amount),
    codAmount: paymentMode === "COD" ? moneyNumber(shipment.cod_amount) : 0,
    paymentMethod: paymentMode || "",
    customerNote: note,
    returnAddress: [sender.name, ...sender.lines].filter(Boolean).join(", "),
    receiver,
    sender,
    logoBytes: logo?.bytes ?? null,
    logoMime: logo?.mime ?? null,
  };

  const pdf = await renderPackingSlipPdf(data);
  return { pdf: Buffer.from(pdf), shipmentId: String(shipment.id), template };
}

function formatPackingDate(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

export type PackingSlipResult = {
  pdf: Buffer;
  shipmentId: string;
  template: LabelTemplate;
};
