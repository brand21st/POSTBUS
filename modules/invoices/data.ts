import type { SupabaseClient } from "@supabase/supabase-js";
import { loadLogoBytes } from "@/modules/labels/packing-data";
import {
  DEFAULT_INVOICE_APPEARANCE,
  istDateIso,
  parseInvoiceAppearance,
  parseInvoiceSettings,
  pickStoreWebsite,
  type InvoiceAppearance,
} from "@/modules/invoices/schema";
import { fetchShopifyPrimaryDomain } from "@/modules/shopify/primary-domain";

export type InvoiceLineItem = {
  title: string;
  sku: string | null;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
};

export type InvoiceParty = {
  name: string;
  phone: string;
  email: string;
  lines: string[];
};

export type InvoiceViewModel = {
  appearance: InvoiceAppearance;
  storeName: string;
  storePhone: string;
  storeEmail: string;
  storeGstin: string;
  storeWebsite: string;
  storeAddress: string[];
  logoBytes: Uint8Array | null;
  logoMime: string | null;
  invoiceNumber: string;
  invoiceDate: string;
  orderNumber: string;
  orderDate: string;
  shipmentId: string;
  shipmentNumber: string;
  trackingNumber: string;
  paymentMethod: string;
  paymentStatus: string;
  currency: string;
  customer: InvoiceParty;
  billing: InvoiceParty;
  shipping: InvoiceParty;
  items: InvoiceLineItem[];
  subtotal: number;
  discount: number;
  shippingAmount: number;
  taxAmount: number;
  total: number;
  codAmount: number | null;
};

export const SAMPLE_INVOICE_DATA: InvoiceViewModel = {
  appearance: DEFAULT_INVOICE_APPEARANCE,
  storeName: "Sample Store",
  storePhone: "9876543210",
  storeEmail: "",
  storeGstin: "",
  storeWebsite: "www.aurimo.in",
  storeAddress: ["12 Market Road", "Kochi, Kerala 682311"],
  logoBytes: null,
  logoMime: null,
  invoiceNumber: "INV-2026-000001",
  invoiceDate: "23 Sep 2026",
  orderNumber: "#12345",
  orderDate: "23 Sep 2026",
  shipmentId: "sample",
  shipmentNumber: "SHP-000001",
  trackingNumber: "CL556974806IN",
  paymentMethod: "COD",
  paymentStatus: "COD",
  currency: "INR",
  customer: {
    name: "Priya Nair",
    phone: "9876501234",
    email: "",
    lines: [],
  },
  billing: {
    name: "Sample Store",
    phone: "9876543210",
    email: "",
    lines: ["12 Market Road", "Kochi, Kerala 682311"],
  },
  shipping: {
    name: "Priya Nair",
    phone: "9876501234",
    email: "",
    lines: ["14 Lake View", "Ernakulam, Kerala 682016"],
  },
  items: [
    { title: "Cotton Shirt", sku: "SHIRT-BLK", quantity: 2, unitPrice: 799, lineTotal: 1598 },
    { title: "Black Jeans", sku: "JEAN-BLK", quantity: 1, unitPrice: 999, lineTotal: 999 },
  ],
  subtotal: 2597,
  discount: 100,
  shippingAmount: 50,
  taxAmount: 0,
  total: 2547,
  codAmount: 2547,
};

function moneyNumber(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  if (Array.isArray(value)) return (value[0] as Record<string, unknown> | undefined) ?? null;
  if (typeof value === "object") return value as Record<string, unknown>;
  return null;
}

function formatDisplayDate(value: string | null | undefined) {
  if (!value) return istDateIso();
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

function partyFrom(
  source: Record<string, unknown> | null,
  fallbackName = ""
): InvoiceParty {
  const name = String(source?.name || fallbackName || "").trim();
  const phone = String(source?.phone || "").trim();
  const email = String(source?.email || "").trim();
  const lines = [
    [source?.line1, source?.line2].filter(Boolean).join(", "),
    [source?.city, source?.state, source?.pincode].filter(Boolean).join(", "),
  ].filter(Boolean) as string[];
  return { name, phone, email, lines };
}

export function formatShipmentNumber(value: unknown) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) return "";
  return `SHP-${String(number).padStart(6, "0")}`;
}

export function organizationInvoiceParty(
  source: Record<string, unknown> | null,
  businessEmail: string | null | undefined = ""
): InvoiceParty {
  return {
    ...partyFrom(source),
    email: (businessEmail ?? "").trim(),
  };
}

export function invoicePreviewPayload(data: InvoiceViewModel) {
  return {
    storeName: data.storeName,
    storePhone: data.storePhone,
    storeEmail: data.storeEmail,
    storeGstin: data.storeGstin,
    storeWebsite: data.storeWebsite,
    storeAddress: data.storeAddress,
    hasLogo: Boolean(data.logoBytes),
    invoiceNumber: data.invoiceNumber,
    invoiceDate: data.invoiceDate,
    orderNumber: data.orderNumber,
    orderDate: data.orderDate,
    shipmentId: data.shipmentId,
    shipmentNumber: data.shipmentNumber,
    trackingNumber: data.trackingNumber,
    paymentMethod: data.paymentMethod,
    paymentStatus: data.paymentStatus,
    currency: data.currency,
    customer: data.customer,
    billing: data.billing,
    shipping: data.shipping,
    items: data.items,
    subtotal: data.subtotal,
    discount: data.discount,
    shippingAmount: data.shippingAmount,
    taxAmount: data.taxAmount,
    total: data.total,
    codAmount: data.codAmount,
  };
}

export async function resolveStoreWebsite(
  supabase: SupabaseClient,
  organizationId: string,
  settingsWebsite?: string | null
) {
  const [{ data: shops }, { data: connections }, { data: page }] = await Promise.all([
    supabase.from("shopify_stores").select("shop_domain").eq("organization_id", organizationId),
    supabase.from("shopify_connections").select("shop_domain").eq("organization_id", organizationId),
    supabase.from("tracking_pages").select("social").eq("organization_id", organizationId).maybeSingle(),
  ]);
  const social = asRecord(page?.social);
  const stored = pickStoreWebsite([
    settingsWebsite,
    typeof social?.website === "string" ? social.website : null,
    ...(shops ?? []).map((row) => row.shop_domain),
    ...(connections ?? []).map((row) => row.shop_domain),
  ]);
  if (stored && !/\.myshopify\.com$/i.test(stored)) return stored;
  const live = await fetchShopifyPrimaryDomain(supabase, organizationId);
  return pickStoreWebsite([live, stored]);
}

export async function invoiceDataForShipment(
  supabase: SupabaseClient,
  organizationId: string,
  shipmentId: string,
  extras?: {
    invoiceNumber?: string;
    invoiceDate?: string;
    appearance?: InvoiceAppearance;
  }
): Promise<InvoiceViewModel> {
  const { data: shipment, error } = await supabase
    .from("shipments")
    .select("id, shipment_number, order_id, barcode, tracking_number, payment_mode, cod_amount")
    .eq("organization_id", organizationId)
    .eq("id", shipmentId)
    .maybeSingle();
  if (error) throw error;
  if (!shipment?.order_id) throw Object.assign(new Error("Shipment not found."), { code: "VALIDATION_ERROR" });

  const { data: orderRow, error: orderError } = await supabase
    .from("orders")
    .select(
      "id, order_number, created_at, subtotal, discount, shipping_amount, tax_amount, total_amount, payment_status, currency, customers(name, phone, email), shipping_address:addresses!shipping_address_id(*), order_line_items(title, sku, quantity, unit_price)"
    )
    .eq("organization_id", organizationId)
    .eq("id", shipment.order_id)
    .maybeSingle();
  if (orderError) throw orderError;
  const order = asRecord(orderRow);
  const settingsRow = await supabase
    .from("invoice_settings")
    .select("appearance, gstin, business_email, website")
    .eq("organization_id", organizationId)
    .maybeSingle();
  const settings = parseInvoiceSettings(settingsRow.data);
  const { data: org } = await supabase
    .from("organizations")
    .select("name, phone, line1, line2, city, state, pincode, logo_path")
    .eq("id", organizationId)
    .maybeSingle();
  const logo = await loadLogoBytes(supabase, org?.logo_path);
  const storeWebsite = await resolveStoreWebsite(supabase, organizationId, settings.website);
  const customer = asRecord(order?.customers);
  const billing = organizationInvoiceParty(asRecord(org), settings.businessEmail);
  const shipping = partyFrom(asRecord(order?.shipping_address), String(customer?.name || ""));
  const items = (Array.isArray(order?.order_line_items) ? order.order_line_items : []).map((item) => {
    const row = item as { title?: string; sku?: string | null; quantity?: number; unit_price?: number | string };
    const quantity = Number(row.quantity) || 1;
    const unitPrice = moneyNumber(row.unit_price);
    return {
      title: row.title || "Item",
      sku: row.sku ?? null,
      quantity,
      unitPrice,
      lineTotal: quantity * unitPrice,
    };
  });
  const paymentMode = String(shipment.payment_mode || order?.payment_status || "").toUpperCase();
  const codAmount = paymentMode === "COD" && moneyNumber(shipment.cod_amount) > 0 ? moneyNumber(shipment.cod_amount) : null;

  return {
    appearance: extras?.appearance ?? settings.appearance,
    storeName: String(org?.name || "Store"),
    storePhone: String(org?.phone || ""),
    storeEmail: settings.businessEmail || "",
    storeGstin: settings.gstin || "",
    storeWebsite,
    storeAddress: [
      [org?.line1, org?.line2].filter(Boolean).join(", "),
      [org?.city, org?.state, org?.pincode].filter(Boolean).join(", "),
    ].filter(Boolean),
    logoBytes: logo?.bytes ?? null,
    logoMime: logo?.mime ?? null,
    invoiceNumber: extras?.invoiceNumber || "DRAFT",
    invoiceDate: extras?.invoiceDate || formatDisplayDate(istDateIso()),
    orderNumber: String(order?.order_number || ""),
    orderDate: formatDisplayDate(typeof order?.created_at === "string" ? order.created_at : null),
    shipmentId: String(shipment.id),
    shipmentNumber: formatShipmentNumber(shipment.shipment_number),
    trackingNumber: String(shipment.tracking_number || shipment.barcode || ""),
    paymentMethod: paymentMode || "—",
    paymentStatus: String(order?.payment_status || paymentMode || "—"),
    currency: String(order?.currency || "INR"),
    customer: {
      name: String(customer?.name || shipping.name || "Customer"),
      phone: String(customer?.phone || shipping.phone || ""),
      email: String(customer?.email || ""),
      lines: [],
    },
    billing,
    shipping,
    items,
    subtotal: moneyNumber(order?.subtotal),
    discount: moneyNumber(order?.discount),
    shippingAmount: moneyNumber(order?.shipping_amount),
    taxAmount: moneyNumber(order?.tax_amount),
    total: moneyNumber(order?.total_amount),
    codAmount,
  };
}

export async function invoicePreviewData(
  supabase: SupabaseClient,
  organizationId: string,
  appearance?: InvoiceAppearance
) {
  const settings = parseInvoiceSettings(
    (
      await supabase
        .from("invoice_settings")
        .select("appearance, gstin, business_email, website")
        .eq("organization_id", organizationId)
        .maybeSingle()
    ).data
  );
  const colors = appearance ?? settings.appearance;
  const { data: shipment } = await supabase
    .from("shipments")
    .select("id, tracking_number, barcode")
    .eq("organization_id", organizationId)
    .not("tracking_number", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (shipment?.id) {
    const data = await invoiceDataForShipment(supabase, organizationId, shipment.id, { appearance: colors });
    return { data, sample: false, shipmentId: shipment.id };
  }

  const { data: org } = await supabase
    .from("organizations")
    .select("name, phone, line1, line2, city, state, pincode, logo_path")
    .eq("id", organizationId)
    .maybeSingle();
  const logo = await loadLogoBytes(supabase, org?.logo_path);
  const storeWebsite =
    (await resolveStoreWebsite(supabase, organizationId, settings.website)) || SAMPLE_INVOICE_DATA.storeWebsite;
  const organization = organizationInvoiceParty(asRecord(org), settings.businessEmail);
  return {
    sample: true,
    shipmentId: null as string | null,
    data: {
      ...SAMPLE_INVOICE_DATA,
      appearance: colors,
      storeName: org?.name || SAMPLE_INVOICE_DATA.storeName,
      storePhone: org?.phone || SAMPLE_INVOICE_DATA.storePhone,
      storeEmail: settings.businessEmail || "",
      storeGstin: settings.gstin || "",
      storeWebsite,
      storeAddress: organization.lines.length ? organization.lines : SAMPLE_INVOICE_DATA.storeAddress,
      logoBytes: logo?.bytes ?? null,
      logoMime: logo?.mime ?? null,
      billing: organization.name ? organization : SAMPLE_INVOICE_DATA.billing,
    } satisfies InvoiceViewModel,
  };
}

export { parseInvoiceAppearance };
