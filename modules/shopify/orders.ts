import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptSecret } from "@/lib/security/crypto";
import { AUTOMATION_DEFAULTS, getAutomationSettings } from "@/modules/automation/service";
import { parcelDefaultsFromConnection, type WorkspaceParcelDefaults } from "@/modules/india-post/parcel-defaults";
import {
  normalizeShopDomain,
  resolveShopifyAppCredentials,
  shopifyWebhookUrl,
  type ShopifyCredentialRow,
} from "@/modules/shopify/oauth";
import { buildPostBusTrackingUrl } from "@/modules/tracking-pages/host";
import { logError } from "@/lib/logger";
import { createAdminClient, hasAdminClient } from "@/lib/supabase/admin";
import { settleOrderPayment } from "@/modules/orders/payment";
import { fetchWithShopifyTimeout, shopifyHttpError } from "@/modules/shopify/http";
import type { FulfillmentStatus, PaymentStatus } from "@/types/domain";

export const SHOPIFY_API_VERSION = "2025-01";
export const SHOPIFY_GRAPHQL_API_VERSION = "2026-04";
export const ORDER_WEBHOOK_TOPICS = [
  "orders/create",
  "orders/updated",
  "orders/cancelled",
  "fulfillment_orders/progress_reported",
] as const;
export const FULFILLMENT_ORDER_REPORT_PROGRESS = `
  mutation FulfillmentOrderReportProgress($id: ID!, $progressReport: FulfillmentOrderReportProgressInput) {
    fulfillmentOrderReportProgress(id: $id, progressReport: $progressReport) {
      fulfillmentOrder { id status }
      userErrors { field message code }
    }
  }
`;
export const SHOPIFY_ORDER_FULFILLMENT_ORDERS = `
  query ShopifyOrderFulfillmentOrders($id: ID!) {
    order(id: $id) {
      id
      tags
      displayFulfillmentStatus
      fulfillmentOrders(first: 20) {
        nodes { id status }
      }
    }
  }
`;
export const SHOPIFY_ORDER_UPDATE = `
  mutation ShopifyOrderUpdate($input: OrderInput!) {
    orderUpdate(input: $input) {
      order { id tags displayFulfillmentStatus }
      userErrors { field message }
    }
  }
`;
export const SHOPIFY_FULFILLMENT_CREATE = `
  mutation ShopifyFulfillmentCreate($fulfillment: FulfillmentInput!) {
    fulfillmentCreate(fulfillment: $fulfillment) {
      fulfillment {
        id
        status
        trackingInfo { company number url }
      }
      userErrors { field message }
    }
  }
`;
export const SHOPIFY_FULFILLMENT_TRACKING_INFO_UPDATE = `
  mutation ShopifyFulfillmentTrackingInfoUpdate(
    $fulfillmentId: ID!
    $trackingInfoInput: FulfillmentTrackingInput!
    $notifyCustomer: Boolean
  ) {
    fulfillmentTrackingInfoUpdate(
      fulfillmentId: $fulfillmentId
      trackingInfoInput: $trackingInfoInput
      notifyCustomer: $notifyCustomer
    ) {
      fulfillment {
        id
        status
        trackingInfo { company number url }
      }
      userErrors { field message }
    }
  }
`;
export const SHOPIFY_ORDER_FULFILLMENTS = `
  query ShopifyOrderFulfillments($id: ID!) {
    order(id: $id) {
      id
      fulfillments(first: 50) {
        id
        createdAt
      }
    }
  }
`;
const SHOPIFY_STAGE_TAGS = {
  processing: "postbus-processing",
  booked: "postbus-booked",
  in_transit: "postbus-in-transit",
  delivered: "postbus-delivered",
} as const;
type ShopifyStageTag = keyof typeof SHOPIFY_STAGE_TAGS;

export type ShopifyConnectionRow = ShopifyCredentialRow & {
  id?: string;
  organization_id?: string;
  shop_domain?: string | null;
  encrypted_access_token?: string | null;
  status?: string | null;
  last_sync_at?: string | null;
};

export type ShopifyRemoteOrder = {
  id?: number | string;
  name?: string;
  order_number?: number | string;
  email?: string | null;
  cancelled_at?: string | null;
  financial_status?: string | null;
  fulfillment_status?: string | null;
  currency?: string | null;
  subtotal_price?: string | number | null;
  total_discounts?: string | number | null;
  total_shipping_price_set?: { shop_money?: { amount?: string } } | null;
  total_tax?: string | number | null;
  total_price?: string | number | null;
  total_outstanding?: string | number | null;
  shipping_address?: Record<string, string | null> | null;
  billing_address?: Record<string, string | null> | null;
  customer?: { first_name?: string | null; last_name?: string | null; email?: string | null; phone?: string | null } | null;
  payment_gateway_names?: string[] | null;
  gateway?: string | null;
  tags?: string | string[] | null;
  line_items?: ShopifyRemoteLineItem[];
};

export type ShopifyWeightValue =
  | number
  | string
  | { value?: number | string | null; unit?: string | null }
  | null;

export type ShopifyRemoteLineItem = {
  title?: string;
  name?: string | null;
  variant_title?: string | null;
  sku?: string | null;
  quantity?: number;
  price?: string | number;
  grams?: number | string | null;
  weight?: ShopifyWeightValue;
  weight_unit?: string | null;
  product_id?: number | string | null;
  variant_id?: number | string | null;
  image?: { src?: string | null; url?: string | null } | string | null;
  variant?: {
    grams?: number | string | null;
    weight?: ShopifyWeightValue;
    weight_unit?: string | null;
    image?: { src?: string | null; url?: string | null } | null;
  } | null;
  length_cm?: number | null;
  width_cm?: number | null;
  height_cm?: number | null;
};

type ShopifyProductImage = { id?: number | string; src?: string | null };
type ShopifyProduct = {
  id?: number | string;
  title?: string | null;
  image?: { src?: string | null } | null;
  images?: ShopifyProductImage[];
  variants?: Array<{
    id?: number | string;
    sku?: string | null;
    title?: string | null;
    image_id?: number | string | null;
    grams?: number | string | null;
    weight?: ShopifyWeightValue;
    weight_unit?: string | null;
  }>;
};

export type ShopifyParcelDims = {
  lengthCm: number | null;
  widthCm: number | null;
  heightCm: number | null;
  weightGrams: number | null;
};

type ShopifyVariantShipping = {
  grams?: number | null;
  weight?: { value: number; unit: string } | null;
  lengthCm?: number | null;
  widthCm?: number | null;
  heightCm?: number | null;
};

const SHOPIFY_PARCEL_LENGTH_CM = { min: 14, max: 150 };
const SHOPIFY_PARCEL_WIDTH_CM = { min: 9, max: 150 };
const SHOPIFY_PARCEL_HEIGHT_CM = { min: 1, max: 150 };

const SHOPIFY_CM_PER_UNIT: Record<string, number> = {
  cm: 1,
  centimeter: 1,
  centimeters: 1,
  mm: 0.1,
  millimeter: 0.1,
  millimeters: 0.1,
  in: 2.54,
  inch: 2.54,
  inches: 2.54,
  ft: 30.48,
  foot: 30.48,
  feet: 30.48,
  m: 100,
  meter: 100,
  meters: 100,
  metre: 100,
  metres: 100,
};

const SHOPIFY_VARIANT_SHIPPING_QUERY = `
  query ShopifyVariantShipping($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on ProductVariant {
        id
        customLength: metafield(namespace: "custom", key: "length") { value type }
        customWidth: metafield(namespace: "custom", key: "width") { value type }
        customHeight: metafield(namespace: "custom", key: "height") { value type }
        customLengthCm: metafield(namespace: "custom", key: "length_cm") { value type }
        customWidthCm: metafield(namespace: "custom", key: "width_cm") { value type }
        customHeightCm: metafield(namespace: "custom", key: "height_cm") { value type }
        customPackageLength: metafield(namespace: "custom", key: "package_length") { value type }
        customPackageWidth: metafield(namespace: "custom", key: "package_width") { value type }
        customPackageHeight: metafield(namespace: "custom", key: "package_height") { value type }
        shippingLength: metafield(namespace: "shipping", key: "length") { value type }
        shippingWidth: metafield(namespace: "shipping", key: "width") { value type }
        shippingHeight: metafield(namespace: "shipping", key: "height") { value type }
        shippingLengthCm: metafield(namespace: "shipping", key: "length_cm") { value type }
        shippingWidthCm: metafield(namespace: "shipping", key: "width_cm") { value type }
        shippingHeightCm: metafield(namespace: "shipping", key: "height_cm") { value type }
      }
    }
  }
`;

const SHOPIFY_DIM_METAFIELD_ALIASES = [
  ["customLength", "custom.length"],
  ["customWidth", "custom.width"],
  ["customHeight", "custom.height"],
  ["customLengthCm", "custom.length_cm"],
  ["customWidthCm", "custom.width_cm"],
  ["customHeightCm", "custom.height_cm"],
  ["customPackageLength", "custom.package_length"],
  ["customPackageWidth", "custom.package_width"],
  ["customPackageHeight", "custom.package_height"],
  ["shippingLength", "shipping.length"],
  ["shippingWidth", "shipping.width"],
  ["shippingHeight", "shipping.height"],
  ["shippingLengthCm", "shipping.length_cm"],
  ["shippingWidthCm", "shipping.width_cm"],
  ["shippingHeightCm", "shipping.height_cm"],
] as const;

export type ShopifyProductImageCatalog = {
  bySku: Map<string, string>;
  byTitle: Map<string, string>;
};

const shopifyImageBackfillInFlight = new Set<string>();

export function shopifyLineItemImageUrl(
  item: ShopifyRemoteLineItem,
  product?: ShopifyProduct | null
) {
  if (typeof item.image === "string" && item.image.trim()) return item.image.trim();
  const nested = item.image && typeof item.image === "object" ? item.image.src || item.image.url : null;
  if (nested?.trim()) return nested.trim();
  const variantImage = item.variant?.image?.src || item.variant?.image?.url;
  if (variantImage?.trim()) return variantImage.trim();
  if (!product) return null;
  const variant = product.variants?.find((row) => String(row.id) === String(item.variant_id ?? ""));
  if (variant?.image_id != null) {
    const match = product.images?.find((image) => String(image.id) === String(variant.image_id));
    if (match?.src?.trim()) return match.src.trim();
  }
  return product.image?.src?.trim() || product.images?.[0]?.src?.trim() || null;
}

export function shopifyImageLookupKey(value: string | null | undefined) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s*:\s*/g, ":")
    .replace(/\s+/g, " ");
}

export function indexShopifyProductsForLineItemImages(products: ShopifyProduct[]): ShopifyProductImageCatalog {
  const bySku = new Map<string, string>();
  const byTitle = new Map<string, string>();
  const remember = (map: Map<string, string>, key: string | null | undefined, src: string) => {
    const normalized = shopifyImageLookupKey(key);
    if (!normalized || map.has(normalized)) return;
    map.set(normalized, src);
  };
  for (const product of products) {
    const featured = product.image?.src?.trim() || product.images?.[0]?.src?.trim() || "";
    if (featured) remember(byTitle, product.title, featured);
    for (const variant of product.variants ?? []) {
      let src = featured;
      if (variant.image_id != null) {
        const match = product.images?.find((image) => String(image.id) === String(variant.image_id));
        if (match?.src?.trim()) src = match.src.trim();
      }
      if (!src) continue;
      remember(bySku, variant.sku, src);
      const variantTitle = String(variant.title ?? "").trim();
      const combined =
        variantTitle && variantTitle.toLowerCase() !== "default title" && product.title
          ? `${product.title} - ${variantTitle}`
          : product.title || variantTitle;
      remember(byTitle, combined, src);
    }
  }
  return { bySku, byTitle };
}

export function shopifyCatalogImageForLineItem(
  title: string | null | undefined,
  sku: string | null | undefined,
  catalog: ShopifyProductImageCatalog
) {
  const skuKey = shopifyImageLookupKey(sku);
  if (skuKey && catalog.bySku.has(skuKey)) return catalog.bySku.get(skuKey) ?? null;
  const titleKey = shopifyImageLookupKey(title);
  if (titleKey && catalog.byTitle.has(titleKey)) return catalog.byTitle.get(titleKey) ?? null;
  return null;
}

export type OrderLineItemImageRow = {
  id?: string;
  title?: string | null;
  sku?: string | null;
  imageUrl?: string | null;
  image_url?: string | null;
};

export type OrderWithLineItemImages = {
  source?: string | null;
  lineItems?: OrderLineItemImageRow[];
};

const shopifyCatalogCache = new Map<string, { catalog: ShopifyProductImageCatalog | null; at: number }>();
const SHOPIFY_CATALOG_TTL_MS = 5 * 60 * 1000;
const SHOPIFY_CATALOG_FAILURE_TTL_MS = 60 * 1000;

export function applyShopifyCatalogToLineItems(
  items: OrderLineItemImageRow[],
  catalog: ShopifyProductImageCatalog
) {
  const patches: Array<{ id: string; src: string }> = [];
  for (const item of items) {
    const current = String(item.imageUrl ?? item.image_url ?? "").trim();
    if (current) continue;
    const src = shopifyCatalogImageForLineItem(item.title, item.sku, catalog);
    if (!src) continue;
    item.imageUrl = src;
    item.image_url = src;
    if (item.id) patches.push({ id: item.id, src });
  }
  return patches;
}

function getCachedShopifyProductImageCatalog(organizationId: string): ShopifyProductImageCatalog | null {
  const cached = shopifyCatalogCache.get(organizationId);
  if (!cached?.catalog) return null;
  if (Date.now() - cached.at >= SHOPIFY_CATALOG_TTL_MS) return null;
  return cached.catalog;
}

function shopifyOrdersMissingLineItemImages(orders: OrderWithLineItemImages[]) {
  return orders
    .filter((order) => String(order.source ?? "").toUpperCase() === "SHOPIFY")
    .some((order) =>
      (order.lineItems ?? []).some((item) => !String(item.imageUrl ?? item.image_url ?? "").trim())
    );
}

function applyShopifyCatalogToOrders(orders: OrderWithLineItemImages[], catalog: ShopifyProductImageCatalog) {
  const patches: Array<{ id: string; src: string }> = [];
  for (const order of orders) {
    if (String(order.source ?? "").toUpperCase() !== "SHOPIFY") continue;
    patches.push(...applyShopifyCatalogToLineItems(order.lineItems ?? [], catalog));
  }
  return patches;
}

function persistShopifyLineItemImagePatches(
  supabase: SupabaseClient,
  organizationId: string,
  patches: Array<{ id: string; src: string }>
) {
  if (!patches.length) return;
  void Promise.all(
    patches.map((patch) =>
      supabase
        .from("order_line_items")
        .update({ image_url: patch.src })
        .eq("id", patch.id)
        .eq("organization_id", organizationId)
        .is("image_url", null)
    )
  ).catch((error) => {
    logError("shopify.line-item-images.enrich", {
      organizationId,
      message: error instanceof Error ? error.message : "unknown",
    });
  });
}

export function enrichShopifyLineItemImagesFromCache(
  supabase: SupabaseClient,
  organizationId: string,
  orders: OrderWithLineItemImages[]
) {
  if (!shopifyOrdersMissingLineItemImages(orders)) return;
  const catalog = getCachedShopifyProductImageCatalog(organizationId);
  if (!catalog) return;
  persistShopifyLineItemImagePatches(
    supabase,
    organizationId,
    applyShopifyCatalogToOrders(orders, catalog)
  );
}

async function loadShopifyProductImageCatalog(
  supabase: SupabaseClient,
  organizationId: string
): Promise<ShopifyProductImageCatalog | null> {
  const cached = shopifyCatalogCache.get(organizationId);
  if (cached) {
    const ttl = cached.catalog ? SHOPIFY_CATALOG_TTL_MS : SHOPIFY_CATALOG_FAILURE_TTL_MS;
    if (Date.now() - cached.at < ttl) return cached.catalog;
  }

  let catalog: ShopifyProductImageCatalog | null = null;
  try {
    const db = hasAdminClient() ? createAdminClient() : supabase;
    const connection = await loadShopifyConnection(db, organizationId);
    const token = connection?.shop_domain ? await resolveShopifyAdminToken(connection) : null;
    if (connection?.shop_domain && token) {
      catalog = await fetchShopifyProductImageCatalog(connection.shop_domain, token);
    }
  } catch (error) {
    logError("shopify.line-item-images.catalog", {
      organizationId,
      message: error instanceof Error ? error.message : "unknown",
    });
  }
  shopifyCatalogCache.set(organizationId, { catalog, at: Date.now() });
  return catalog;
}

export async function enrichShopifyLineItemImagesInOrders(
  supabase: SupabaseClient,
  organizationId: string,
  orders: OrderWithLineItemImages[]
) {
  if (!shopifyOrdersMissingLineItemImages(orders)) return;

  enrichShopifyLineItemImagesFromCache(supabase, organizationId, orders);
  if (!shopifyOrdersMissingLineItemImages(orders)) return;

  const catalog = await loadShopifyProductImageCatalog(supabase, organizationId);
  if (!catalog) return;

  persistShopifyLineItemImagePatches(
    supabase,
    organizationId,
    applyShopifyCatalogToOrders(orders, catalog)
  );
}

export type ShopifySyncResult = {
  imported: number;
  updated: number;
  skipped: number;
  hasMore: boolean;
  connected: boolean;
  nextPageInfo?: string | null;
};

export function shopifyReadyToSync(row?: ShopifyConnectionRow | null) {
  return Boolean(row?.shop_domain && resolveShopifyAppCredentials(row));
}

const COD_GATEWAY = /cash[_\s-]*on[_\s-]*delivery|\bcod\b/i;

export function isShopifyCodGateway(gateways?: string[] | string | null) {
  const list = Array.isArray(gateways) ? gateways : gateways ? [gateways] : [];
  return list.some((gateway) => COD_GATEWAY.test(gateway));
}

export function mapShopifyPaymentStatus(
  value?: string | null,
  gateways?: string[] | string | null
): PaymentStatus {
  switch ((value || "").toLowerCase()) {
    case "paid":
      return "PAID";
    case "partially_paid":
      return "PARTIAL";
    case "refunded":
    case "partially_refunded":
      return "REFUNDED";
    case "voided":
      return "FAILED";
    case "pending":
    case "authorized":
    default:
      if (isShopifyCodGateway(gateways)) return "COD";
      return "PENDING";
  }
}

export function mapShopifyCollectable(
  remote: Pick<ShopifyRemoteOrder, "total_price" | "total_outstanding">,
  paymentStatus: PaymentStatus
) {
  const total = Number(remote.total_price ?? 0);
  if (paymentStatus === "PARTIAL") {
    const outstanding =
      remote.total_outstanding == null || remote.total_outstanding === ""
        ? null
        : Number(remote.total_outstanding);
    const amountPaid =
      outstanding == null || Number.isNaN(outstanding) ? 0 : Math.max(0, total - outstanding);
    return settleOrderPayment({
      paymentStatus: "PARTIAL",
      totalAmount: total,
      amountPaid,
      strict: false,
    });
  }
  return settleOrderPayment({
    paymentStatus,
    totalAmount: total,
    strict: false,
  });
}

export function nextShopifyOrderStatus(input: {
  cancelledAt?: string | null;
  fulfillmentStatus: FulfillmentStatus;
  currentStatus?: string | null;
}) {
  if (input.cancelledAt) return "CANCELLED";
  const current = (input.currentStatus ?? "").toUpperCase();
  if (input.fulfillmentStatus === "FULFILLED") {
    if (["BOOKED", "IN_TRANSIT", "DELIVERED"].includes(current)) return current;
    return "SHIPPED";
  }
  if (["PROCESSING", "BOOKED", "SHIPPED", "IN_TRANSIT", "DELIVERED"].includes(current)) {
    return current;
  }
  return "READY";
}

export function shopifyFulfillmentOrderGid(id: number | string) {
  const raw = String(id);
  return raw.startsWith("gid://") ? raw : `gid://shopify/FulfillmentOrder/${raw}`;
}

export function shopifyFulfillmentGid(id: number | string) {
  const raw = String(id);
  return raw.startsWith("gid://") ? raw : `gid://shopify/Fulfillment/${raw}`;
}

export function shopifyNumericId(id: number | string) {
  const raw = String(id).trim();
  const fromGid = raw.match(/\/(\d+)\s*$/);
  const value = fromGid ? Number(fromGid[1]) : Number(raw);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function shopifyOrderGid(id: number | string) {
  const raw = String(id);
  return raw.startsWith("gid://") ? raw : `gid://shopify/Order/${raw}`;
}

export function shopifyRemoteSignalsProcessing(remote: { tags?: string | string[] | null }) {
  const tags = Array.isArray(remote.tags) ? remote.tags.join(",") : String(remote.tags ?? "");
  return tags
    .split(",")
    .some((tag) => tag.trim().toLowerCase() === SHOPIFY_STAGE_TAGS.processing);
}

export function shouldNotifyWatiForShopifyProcessing(currentStatus?: string | null) {
  const current = (currentStatus ?? "").toUpperCase();
  return !["BOOKED", "SHIPPED", "IN_TRANSIT", "DELIVERED", "CANCELLED"].includes(current);
}

export async function notifyShopifyProcessingWati(
  supabase: SupabaseClient,
  organizationId: string,
  orderId: string
) {
  const { data: order } = await supabase
    .from("orders")
    .select("status")
    .eq("id", orderId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (!shouldNotifyWatiForShopifyProcessing(order?.status)) return { skipped: true, reason: "advanced" };
  try {
    const { enqueueWatiNotify } = await import("@/modules/wati/send");
    await enqueueWatiNotify(supabase, organizationId, "processing", { orderId });
  } catch {
    // WhatsApp Wati is optional.
  }
  try {
    const { enqueueVachatNotify } = await import("@/modules/vachat/send");
    await enqueueVachatNotify(supabase, organizationId, "processing", { orderId });
  } catch {
    // Vachat is optional.
  }
  return { skipped: false };
}

export function nextShopifyStageTags(
  existing: string[] | string | null | undefined,
  stage: ShopifyStageTag
) {
  const list = Array.isArray(existing)
    ? existing
    : String(existing ?? "")
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean);
  return [...list.filter((tag) => !/^postbus-/i.test(tag)), SHOPIFY_STAGE_TAGS[stage]];
}

export function canReportShopifyFulfillmentProgress(status?: string | null) {
  const value = (status || "open").toLowerCase();
  return value === "open" || value === "in_progress";
}

export function parseShopifyProgressReported(payload: unknown) {
  const record = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const fulfillmentOrder =
    record.fulfillment_order && typeof record.fulfillment_order === "object"
      ? (record.fulfillment_order as Record<string, unknown>)
      : record;
  const status = String(fulfillmentOrder.status ?? record.status ?? "").toLowerCase();
  const sourceOrderId = fulfillmentOrder.order_id ?? record.order_id ?? "";
  return {
    status,
    sourceOrderId: sourceOrderId ? String(sourceOrderId) : "",
    inProgress: status === "in_progress",
  };
}

export function mapShopifyFulfillmentStatus(value?: string | null, cancelledAt?: string | null): FulfillmentStatus {
  if (cancelledAt) return "CANCELLED";
  switch ((value || "").toLowerCase()) {
    case "fulfilled":
      return "FULFILLED";
    case "partial":
      return "PARTIAL";
    default:
      return "UNFULFILLED";
  }
}

export function isUnfulfilledShopifyOrder(order: Pick<ShopifyRemoteOrder, "fulfillment_status" | "cancelled_at">) {
  if (order.cancelled_at) return false;
  const status = (order.fulfillment_status || "unfulfilled").toLowerCase();
  return status === "unfulfilled" || status === "unshipped" || status === "partial" || status === "null";
}

export function shopifyOrderNumber(order: ShopifyRemoteOrder, sourceId: string) {
  const name = String(order.name || "").trim();
  if (name) return name;
  if (order.order_number) return `#${order.order_number}`;
  return `SH-${sourceId}`;
}

export function shopifyLineItemTitle(item: {
  name?: string | null;
  title?: string | null;
  variant_title?: string | null;
}) {
  const fullName = String(item.name || "").trim();
  if (fullName) return fullName;
  const title = String(item.title || "").trim();
  const variant = String(item.variant_title || "").trim();
  if (title && variant && !title.toLowerCase().includes(variant.toLowerCase())) {
    return `${title} — ${variant}`;
  }
  return title || "Item";
}

const SHOPIFY_GRAMS_PER_UNIT: Record<string, number> = {
  g: 1,
  gram: 1,
  grams: 1,
  kg: 1000,
  kilogram: 1000,
  kilograms: 1000,
  oz: 28.3495,
  ounce: 28.3495,
  ounces: 28.3495,
  lb: 453.592,
  lbs: 453.592,
  pound: 453.592,
  pounds: 453.592,
};

const SHOPIFY_WEIGHT_LOCKED_ORDER = new Set(["BOOKED", "SHIPPED", "IN_TRANSIT", "DELIVERED", "CANCELLED"]);
const SHOPIFY_WEIGHT_LOCKED_SHIPMENT = new Set([
  "VALIDATING",
  "QUEUED",
  "BOOKING",
  "BOOKED",
  "LABEL_PENDING",
  "LABEL_READY",
  "MANIFEST_PENDING",
  "MANIFEST_READY",
  "IN_TRANSIT",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
  "NDR",
]);

function shopifyNumeric(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const amount = typeof value === "number" ? value : Number(value);
  return Number.isFinite(amount) ? amount : null;
}

function shopifyWeightPair(weight: ShopifyWeightValue | undefined, unit?: string | null) {
  if (weight && typeof weight === "object") {
    const value = shopifyNumeric(weight.value);
    if (value == null) return null;
    return { value, unit: weight.unit ?? unit ?? null };
  }
  const value = shopifyNumeric(weight);
  if (value == null) return null;
  return { value, unit: unit ?? null };
}

export function shopifyWeightToGrams(value: number, unit?: string | null) {
  const factor = SHOPIFY_GRAMS_PER_UNIT[String(unit || "").trim().toLowerCase()];
  if (!factor || !Number.isFinite(value) || value <= 0) return null;
  const grams = Math.round(value * factor);
  return grams > 0 ? grams : null;
}

/** Per-unit grams. Shopify product weight is not multiplied by quantity. */
export function shopifyLineItemWeightGrams(item: ShopifyRemoteLineItem) {
  const grams = shopifyNumeric(item.grams);
  if (grams != null && grams >= 1) return Math.round(grams);

  const variantGrams = shopifyNumeric(item.variant?.grams);
  if (variantGrams != null && variantGrams >= 1) return Math.round(variantGrams);

  const pairs = [
    shopifyWeightPair(item.weight, item.weight_unit),
    shopifyWeightPair(item.variant?.weight, item.variant?.weight_unit ?? item.weight_unit),
  ];
  for (const pair of pairs) {
    if (!pair || pair.value <= 0 || !pair.unit) continue;
    const converted = shopifyWeightToGrams(pair.value, pair.unit);
    if (converted) return converted;
  }

  if (grams != null && grams > 0 && grams < 1) return Math.round(grams * 1000);
  return null;
}

export function shopifyVariantGid(id: number | string | null | undefined) {
  const raw = String(id ?? "").trim();
  if (!raw) return null;
  if (raw.startsWith("gid://")) return raw;
  return `gid://shopify/ProductVariant/${raw}`;
}

function clampShopifyCm(value: number, min: number, max: number) {
  if (!Number.isFinite(value) || value <= 0) return null;
  const rounded = Math.round(value * 10) / 10;
  return Math.min(max, Math.max(min, rounded));
}

export function shopifyDimensionToCm(value: unknown, unit?: string | null): number | null {
  if (value == null || value === "") return null;
  if (typeof value === "object") {
    const row = value as { value?: unknown; unit?: string | null };
    return shopifyDimensionToCm(row.value, row.unit ?? unit);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        return shopifyDimensionToCm(JSON.parse(trimmed) as unknown, unit);
      } catch {
        // Fall through to numeric + unit suffix parsing.
      }
    }
    const match = trimmed.match(/^(-?\d+(?:\.\d+)?)\s*([a-zA-Z]+)?$/);
    if (match) {
      return shopifyDimensionToCm(Number(match[1]), match[2] || unit);
    }
  }
  const amount = shopifyNumeric(value);
  if (amount == null || amount <= 0) return null;
  const key = String(unit || "cm").trim().toLowerCase();
  const factor = SHOPIFY_CM_PER_UNIT[key] ?? (key.endsWith("s") ? SHOPIFY_CM_PER_UNIT[key.slice(0, -1)] : undefined);
  if (!factor) return amount;
  const cm = amount * factor;
  return cm > 0 ? cm : null;
}

function metafieldMapFromVariantNode(node: Record<string, unknown> | null | undefined) {
  const map = new Map<string, string>();
  if (!node) return map;
  for (const [alias, key] of SHOPIFY_DIM_METAFIELD_ALIASES) {
    const field = node[alias] as { value?: string | null } | null | undefined;
    if (field?.value == null || field.value === "") continue;
    map.set(key, field.value);
  }
  return map;
}

function dimsFromMetafields(fields: Map<string, string>): { lengthCm: number; widthCm: number; heightCm: number } | null {
  const groups = [
    ["custom.length", "custom.width", "custom.height"],
    ["custom.length_cm", "custom.width_cm", "custom.height_cm"],
    ["custom.package_length", "custom.package_width", "custom.package_height"],
    ["shipping.length", "shipping.width", "shipping.height"],
    ["shipping.length_cm", "shipping.width_cm", "shipping.height_cm"],
  ] as const;
  for (const [lengthKey, widthKey, heightKey] of groups) {
    const lengthCm = shopifyDimensionToCm(fields.get(lengthKey));
    const widthCm = shopifyDimensionToCm(fields.get(widthKey));
    const heightCm = shopifyDimensionToCm(fields.get(heightKey));
    if (lengthCm && widthCm && heightCm) return { lengthCm, widthCm, heightCm };
  }
  return null;
}

export function shopifyParcelFromLineItems(items: ShopifyRemoteLineItem[]): ShopifyParcelDims {
  let weightGrams = 0;
  let maxL = 0;
  let maxW = 0;
  let maxH = 0;
  let hasBox = false;
  for (const item of items) {
    const quantity = Number(item.quantity) || 1;
    const grams = shopifyLineItemWeightGrams(item);
    if (grams && quantity > 0) weightGrams += grams * quantity;
    const lengthCm = shopifyNumeric(item.length_cm);
    const widthCm = shopifyNumeric(item.width_cm);
    const heightCm = shopifyNumeric(item.height_cm);
    if (lengthCm && widthCm && heightCm && lengthCm > 0 && widthCm > 0 && heightCm > 0) {
      hasBox = true;
      maxL = Math.max(maxL, lengthCm);
      maxW = Math.max(maxW, widthCm);
      maxH = Math.max(maxH, heightCm);
    }
  }
  return {
    weightGrams: weightGrams > 0 ? Math.round(weightGrams) : null,
    lengthCm: hasBox ? clampShopifyCm(maxL, SHOPIFY_PARCEL_LENGTH_CM.min, SHOPIFY_PARCEL_LENGTH_CM.max) : null,
    widthCm: hasBox ? clampShopifyCm(maxW, SHOPIFY_PARCEL_WIDTH_CM.min, SHOPIFY_PARCEL_WIDTH_CM.max) : null,
    heightCm: hasBox ? clampShopifyCm(maxH, SHOPIFY_PARCEL_HEIGHT_CM.min, SHOPIFY_PARCEL_HEIGHT_CM.max) : null,
  };
}

export type ShopifyShipmentDimExtras = {
  lengthCm?: number;
  widthCm?: number;
  heightCm?: number;
};

export function shopifyShipmentParcelExtras(lineItems: ShopifyRemoteLineItem[]): ShopifyShipmentDimExtras {
  const parcel = shopifyParcelFromLineItems(lineItems);
  if (parcel.lengthCm == null || parcel.widthCm == null || parcel.heightCm == null) return {};
  return { lengthCm: parcel.lengthCm, widthCm: parcel.widthCm, heightCm: parcel.heightCm };
}

/** Metafield box first; else complete workspace L×W×H. Saved Shopify packages are not readable on Admin 2026-04. */
export function shopifyResolvedShipmentDims(
  lineItems: ShopifyRemoteLineItem[],
  workspace?: WorkspaceParcelDefaults | null
): ShopifyShipmentDimExtras {
  const fromItems = shopifyShipmentParcelExtras(lineItems);
  if (fromItems.lengthCm != null && fromItems.widthCm != null && fromItems.heightCm != null) {
    return fromItems;
  }
  const lengthCm = workspace?.lengthCm != null
    ? clampShopifyCm(workspace.lengthCm, SHOPIFY_PARCEL_LENGTH_CM.min, SHOPIFY_PARCEL_LENGTH_CM.max)
    : null;
  const widthCm = workspace?.widthCm != null
    ? clampShopifyCm(workspace.widthCm, SHOPIFY_PARCEL_WIDTH_CM.min, SHOPIFY_PARCEL_WIDTH_CM.max)
    : null;
  const heightCm = workspace?.heightCm != null
    ? clampShopifyCm(workspace.heightCm, SHOPIFY_PARCEL_HEIGHT_CM.min, SHOPIFY_PARCEL_HEIGHT_CM.max)
    : null;
  if (lengthCm != null && widthCm != null && heightCm != null) {
    return { lengthCm, widthCm, heightCm };
  }
  return {};
}

async function loadWorkspaceParcelDefaults(supabase: SupabaseClient, organizationId: string) {
  try {
    const { data } = await supabase
      .from("india_post_connections")
      .select("default_length_cm, default_width_cm, default_height_cm, default_weight_grams")
      .eq("organization_id", organizationId)
      .maybeSingle();
    return parcelDefaultsFromConnection(data);
  } catch {
    return parcelDefaultsFromConnection(null);
  }
}

export function applyShopifyProductShippingToLineItem(
  item: ShopifyRemoteLineItem,
  product?: ShopifyProduct | null,
  shipping?: ShopifyVariantShipping | null
): ShopifyRemoteLineItem {
  let next: ShopifyRemoteLineItem = { ...item };
  const variant = product?.variants?.find((row) => String(row.id) === String(item.variant_id ?? ""));

  if (!shopifyLineItemImageUrl(next) && product) {
    const src = shopifyLineItemImageUrl(item, product);
    if (src) next = { ...next, image: { src } };
  }

  if (shopifyLineItemWeightGrams(next) == null) {
    const mergedVariant = {
      ...next.variant,
      grams: next.variant?.grams ?? variant?.grams ?? shipping?.grams ?? null,
      weight: next.variant?.weight ?? variant?.weight ?? shipping?.weight ?? null,
      weight_unit: next.variant?.weight_unit ?? variant?.weight_unit ?? shipping?.weight?.unit ?? null,
    };
    if (mergedVariant.grams != null || mergedVariant.weight != null) {
      next = { ...next, variant: mergedVariant };
    }
  }

  const lengthCm = next.length_cm ?? shipping?.lengthCm ?? null;
  const widthCm = next.width_cm ?? shipping?.widthCm ?? null;
  const heightCm = next.height_cm ?? shipping?.heightCm ?? null;
  if (lengthCm && widthCm && heightCm) {
    next = { ...next, length_cm: lengthCm, width_cm: widthCm, height_cm: heightCm };
  }
  return next;
}

function shopifyLineItemRows(organizationId: string, orderId: string, lineItems: ShopifyRemoteLineItem[]) {
  return lineItems.map((item) => ({
    organization_id: organizationId,
    order_id: orderId,
    title: shopifyLineItemTitle(item),
    sku: item.sku ? String(item.sku) : null,
    quantity: Number(item.quantity ?? 1),
    unit_price: Number(item.price ?? 0),
    weight_grams: shopifyLineItemWeightGrams(item),
    weight_edited: false,
    image_url: shopifyLineItemImageUrl(item),
  }));
}

function shopifyWeightKey(title?: string | null, sku?: string | null) {
  return `${String(title ?? "").trim().toLowerCase()}|${String(sku ?? "").trim().toLowerCase()}`;
}

export function preserveEditedShopifyLineWeights<T extends { title: string; sku: string | null; weight_grams: number | null }>(
  rows: T[],
  existing: Array<{
    title?: string | null;
    sku?: string | null;
    weight_grams?: number | null;
    weight_edited?: boolean | null;
  }>
) {
  const edited = new Map<string, number | null>();
  for (const row of existing) {
    if (!row.weight_edited) continue;
    edited.set(shopifyWeightKey(row.title, row.sku), row.weight_grams ?? null);
  }
  return rows.map((row) => {
    const key = shopifyWeightKey(row.title, row.sku);
    if (!edited.has(key)) return row;
    return { ...row, weight_grams: edited.get(key) ?? null, weight_edited: true };
  });
}

async function applyShopifyLineItemImages(
  supabase: SupabaseClient,
  input: {
    organizationId: string;
    orderId: string;
    lineItems: ShopifyRemoteLineItem[];
  }
) {
  const { data: existingItems, error } = await supabase
    .from("order_line_items")
    .select("id, title, sku, image_url")
    .eq("organization_id", input.organizationId)
    .eq("order_id", input.orderId);
  if (error || !Array.isArray(existingItems) || !existingItems.length) return;

  const byKey = new Map<string, string>();
  for (const item of input.lineItems) {
    const src = shopifyLineItemImageUrl(item);
    if (!src) continue;
    byKey.set(shopifyWeightKey(shopifyLineItemTitle(item), item.sku ? String(item.sku) : null), src);
  }

  for (const row of existingItems as Array<{
    id: string;
    title?: string | null;
    sku?: string | null;
    image_url?: string | null;
  }>) {
    if (String(row.image_url ?? "").trim()) continue;
    const src = byKey.get(shopifyWeightKey(row.title, row.sku));
    if (!src) continue;
    await supabase
      .from("order_line_items")
      .update({ image_url: src })
      .eq("id", row.id)
      .eq("organization_id", input.organizationId);
  }
}

async function refreshShopifyLineItems(
  supabase: SupabaseClient,
  input: {
    organizationId: string;
    orderId: string;
    orderStatus?: string | null;
    lineItems: ShopifyRemoteLineItem[];
  }
) {
  if (!input.lineItems.length) return;
  const orderLocked = SHOPIFY_WEIGHT_LOCKED_ORDER.has((input.orderStatus ?? "").toUpperCase());
  let shipmentLocked = false;
  if (!orderLocked) {
    const { data: shipments, error: shipmentError } = await supabase
      .from("shipments")
      .select("status")
      .eq("organization_id", input.organizationId)
      .eq("order_id", input.orderId);
    if (shipmentError) return;
    const shipmentRows = Array.isArray(shipments) ? shipments : [];
    shipmentLocked = shipmentRows.some((row) =>
      SHOPIFY_WEIGHT_LOCKED_SHIPMENT.has(String((row as { status?: string }).status ?? "").toUpperCase())
    );
  }
  if (orderLocked || shipmentLocked) {
    await applyShopifyLineItemImages(supabase, input);
    return;
  }

  const { data: existingItems, error: itemsReadError } = await supabase
    .from("order_line_items")
    .select("title, sku, weight_grams, weight_edited")
    .eq("organization_id", input.organizationId)
    .eq("order_id", input.orderId);
  if (itemsReadError) return;

  const rows = preserveEditedShopifyLineWeights(
    shopifyLineItemRows(input.organizationId, input.orderId, input.lineItems),
    Array.isArray(existingItems) ? existingItems : []
  );

  const { error: deleteError } = await supabase
    .from("order_line_items")
    .delete()
    .eq("organization_id", input.organizationId)
    .eq("order_id", input.orderId);
  if (deleteError) throw new Error(deleteError.message);

  const { error: itemsError } = await supabase.from("order_line_items").insert(rows);
  if (itemsError) throw new Error(itemsError.message);

  await applyShopifyParcelToShipment(supabase, {
    organizationId: input.organizationId,
    orderId: input.orderId,
    orderStatus: input.orderStatus,
    userId: undefined,
    lineItems: input.lineItems,
    createIfMissing: true,
  });
}

async function applyShopifyParcelToShipment(
  supabase: SupabaseClient,
  input: {
    organizationId: string;
    orderId: string;
    orderStatus?: string | null;
    userId?: string;
    lineItems: ShopifyRemoteLineItem[];
    createIfMissing?: boolean;
    enqueueBooking?: boolean;
  }
) {
  const parcel = shopifyParcelFromLineItems(input.lineItems);
  const workspace = await loadWorkspaceParcelDefaults(supabase, input.organizationId);
  const extras = shopifyResolvedShipmentDims(input.lineItems, workspace);
  const orderLocked = SHOPIFY_WEIGHT_LOCKED_ORDER.has((input.orderStatus ?? "").toUpperCase());
  if (orderLocked) return;

  const { data: shipments } = await supabase
    .from("shipments")
    .select("id, status, length_cm, width_cm, height_cm, weight_grams")
    .eq("organization_id", input.organizationId)
    .eq("order_id", input.orderId);
  const rows = Array.isArray(shipments) ? shipments : [];
  const unlocked = rows.filter(
    (row) => !SHOPIFY_WEIGHT_LOCKED_SHIPMENT.has(String((row as { status?: string }).status ?? "").toUpperCase())
  );

  if (!rows.length) {
    if (!input.createIfMissing) return;
    if (!extras.lengthCm) return;
    try {
      const { createShipmentsForOrders } = await import("@/modules/shipments/service");
      await createShipmentsForOrders(
        supabase,
        {
          userId: input.userId ?? "",
          email: null,
          fullName: null,
          organizationId: input.organizationId,
          organizationName: "",
          role: "OWNER",
          permissions: [],
        },
        [input.orderId],
        { enqueueBooking: input.enqueueBooking === true, runBookingNow: false, ...extras }
      );
    } catch {
      // Parcel hydrate is optional; order import/update should still succeed.
    }
    return;
  }

  const { data: order } = await supabase
    .from("orders")
    .select("parcel_weight_mode")
    .eq("id", input.orderId)
    .maybeSingle();
  const autoWeight = String((order as { parcel_weight_mode?: string } | null)?.parcel_weight_mode ?? "auto").toLowerCase() !== "manual";

  for (const row of unlocked as Array<{
    id: string;
    length_cm?: number | null;
    width_cm?: number | null;
    height_cm?: number | null;
    weight_grams?: number | null;
  }>) {
    const hasDims =
      Number(row.length_cm) > 0 && Number(row.width_cm) > 0 && Number(row.height_cm) > 0;
    const patch: Record<string, number> = {};
    if (!hasDims && extras.lengthCm != null && extras.widthCm != null && extras.heightCm != null) {
      patch.length_cm = extras.lengthCm;
      patch.width_cm = extras.widthCm;
      patch.height_cm = extras.heightCm;
    }
    if (autoWeight && parcel.weightGrams != null && parcel.weightGrams >= 1) {
      patch.weight_grams = parcel.weightGrams;
    }
    if (!Object.keys(patch).length) continue;
    await supabase
      .from("shipments")
      .update(patch)
      .eq("id", row.id)
      .eq("organization_id", input.organizationId);
  }
}

export function shopifyPhone(value?: string | null) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length >= 8) return digits.slice(-12);
  return "0000000000";
}

export function shopifyPincode(value?: string | null) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length >= 6) return digits.slice(0, 6);
  return digits.padEnd(6, "0");
}

export function shopifyCustomerName(order: ShopifyRemoteOrder) {
  const shipping = order.shipping_address ?? {};
  const billing = order.billing_address ?? {};
  const customer = order.customer;
  const named =
    String(shipping.name || "").trim() ||
    `${shipping.first_name ?? ""} ${shipping.last_name ?? ""}`.trim() ||
    `${customer?.first_name ?? ""} ${customer?.last_name ?? ""}`.trim() ||
    String(billing.name || "").trim();
  return named || "Shopify customer";
}

async function shopifyRequest(shop: string, token: string, path: string, init?: RequestInit) {
  const url = path.startsWith("http")
    ? path
    : `https://${normalizeShopDomain(shop)}/admin/api/${SHOPIFY_API_VERSION}${path}`;
  return fetchWithShopifyTimeout(url, {
    ...init,
    headers: {
      "X-Shopify-Access-Token": token,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
}

async function shopifyGraphql<T>(
  shop: string,
  token: string,
  query: string,
  variables: Record<string, unknown>
) {
  const response = await fetchWithShopifyTimeout(
    `https://${normalizeShopDomain(shop)}/admin/api/${SHOPIFY_GRAPHQL_API_VERSION}/graphql.json`,
    {
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, variables }),
    }
  );
  const json = (await response.json()) as {
    data?: T;
    errors?: Array<{ message?: string }>;
  };
  return { ok: response.ok && !json.errors?.length, json };
}

export async function resolveShopifyAdminToken(row?: ShopifyConnectionRow | null) {
  if (row?.encrypted_access_token) {
    try {
      const token = decryptSecret(row.encrypted_access_token);
      if (token) return token;
    } catch {
      // Fall through to client credentials.
    }
  }
  const creds = resolveShopifyAppCredentials(row);
  const shop = row?.shop_domain;
  if (!creds || !shop) return null;
  const response = await fetchWithShopifyTimeout(`https://${normalizeShopDomain(shop)}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
    }),
  });
  if (!response.ok) return null;
  const json = (await response.json()) as { access_token?: string };
  return json.access_token || null;
}

export async function loadShopifyConnection(supabase: SupabaseClient, organizationId: string) {
  const { data, error } = await supabase
    .from("shopify_connections")
    .select("*")
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data ?? null) as ShopifyConnectionRow | null;
}

export async function markShopifyConnected(
  supabase: SupabaseClient,
  connection: ShopifyConnectionRow,
  patch?: Record<string, unknown>
) {
  if (!connection.id) return;
  await supabase
    .from("shopify_connections")
    .update({
      status: "CONNECTED",
      last_error: null,
      ...patch,
    })
    .eq("id", connection.id);
}

export const POSTBUS_TRACKING_COMPANY = "PostBus";

export type ShopifyFulfillmentOrder = {
  id: number | string;
  status?: string | null;
  line_items?: Array<{
    id?: number | string;
    remaining_quantity?: number | string | null;
    quantity?: number | string | null;
  }>;
};

export type ShopifyFulfillmentResult = {
  skipped: boolean;
  reason?: string;
  fulfilled?: boolean;
};

function asRecord<T extends object>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

export type ShopifyTrackingInfo = {
  company: string;
  number: string;
  url: string;
};

function isAlreadyFulfilledShopifyMessage(message: string) {
  return /already fulfilled|already closed|closed|no remaining|fulfillment order.*closed/i.test(message);
}

export function shopifyTrackingInfo(articleId: string): ShopifyTrackingInfo | null {
  const number = articleId.trim();
  if (!number) return null;
  const url = buildPostBusTrackingUrl(number);
  if (!url.startsWith("https://www.postbus.in/track") || url.includes("indiapost.gov.in")) {
    return null;
  }
  return {
    company: POSTBUS_TRACKING_COMPANY,
    number,
    url,
  };
}

export function shopifyFulfillmentPayload(input: {
  fulfillmentOrders: ShopifyFulfillmentOrder[];
  trackingNumber: string;
  notifyCustomer?: boolean;
}) {
  const trackingInfo = shopifyTrackingInfo(input.trackingNumber);
  const lineItemsByFulfillmentOrder = input.fulfillmentOrders
    .filter((order) => {
      const status = (order.status || "open").toLowerCase();
      return status === "open" || status === "in_progress";
    })
    .map((order) => ({ fulfillmentOrderId: shopifyFulfillmentOrderGid(order.id) }))
    .filter((row) => Boolean(shopifyNumericId(row.fulfillmentOrderId)));

  return {
    fulfillment: {
      lineItemsByFulfillmentOrder,
      trackingInfo,
      notifyCustomer: input.notifyCustomer !== false,
    },
  };
}

function restShopifyFulfillmentBody(payload: ReturnType<typeof shopifyFulfillmentPayload>) {
  return {
    fulfillment: {
      line_items_by_fulfillment_order: payload.fulfillment.lineItemsByFulfillmentOrder
        .map((row) => ({ fulfillment_order_id: shopifyNumericId(row.fulfillmentOrderId) }))
        .filter((row): row is { fulfillment_order_id: number } => row.fulfillment_order_id != null),
      tracking_info: payload.fulfillment.trackingInfo,
      notify_customer: payload.fulfillment.notifyCustomer,
    },
  };
}

async function latestShopifyFulfillmentGid(shop: string, token: string, sourceOrderId: string) {
  const result = await shopifyGraphql<{
    order?: { fulfillments?: Array<{ id?: string | null; createdAt?: string | null }> | null };
  }>(shop, token, SHOPIFY_ORDER_FULFILLMENTS, { id: shopifyOrderGid(sourceOrderId) });
  if (result.ok) {
    const latest = [...(result.json.data?.order?.fulfillments ?? [])]
      .filter((row): row is { id: string; createdAt?: string | null } => Boolean(row?.id))
      .sort((a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")))[0];
    if (latest?.id) return latest.id;
  }

  const listRes = await shopifyRequest(
    shop,
    token,
    `/orders/${encodeURIComponent(sourceOrderId)}/fulfillments.json`
  );
  if (!listRes.ok) return null;
  const json = (await listRes.json()) as { fulfillments?: Array<{ id?: number | string }> };
  const latestNumeric = [...(json.fulfillments ?? [])]
    .map((row) => shopifyNumericId(row.id ?? ""))
    .filter((id): id is number => id != null)
    .sort((a, b) => b - a)[0];
  return latestNumeric ? shopifyFulfillmentGid(latestNumeric) : null;
}

async function updateExistingShopifyTracking(
  shop: string,
  token: string,
  sourceOrderId: string,
  articleId: string
) {
  const trackingInfo = shopifyTrackingInfo(articleId);
  if (!trackingInfo) return false;
  const fulfillmentId = await latestShopifyFulfillmentGid(shop, token, sourceOrderId);
  if (!fulfillmentId) return false;

  const result = await shopifyGraphql<{
    fulfillmentTrackingInfoUpdate?: {
      fulfillment?: { id?: string | null } | null;
      userErrors?: Array<{ message?: string }>;
    };
  }>(shop, token, SHOPIFY_FULFILLMENT_TRACKING_INFO_UPDATE, {
    fulfillmentId,
    trackingInfoInput: trackingInfo,
    notifyCustomer: true,
  });
  const payload = result.json.data?.fulfillmentTrackingInfoUpdate;
  if (result.ok && payload?.fulfillment?.id && !payload.userErrors?.length) {
    return true;
  }

  const numericId = shopifyNumericId(fulfillmentId);
  if (!numericId) return false;
  const updateRes = await shopifyRequest(shop, token, `/fulfillments/${numericId}/update_tracking.json`, {
    method: "POST",
    body: JSON.stringify({
      fulfillment: {
        notify_customer: true,
        tracking_info: trackingInfo,
      },
    }),
  });
  return updateRes.ok;
}

async function markOrderFulfilled(supabase: SupabaseClient, orderId: string) {
  await supabase.from("orders").update({ fulfillment_status: "FULFILLED" }).eq("id", orderId);
}

type ShopifyFulfillmentOrderNode = { id: string; status: string };

async function loadShopifyOrderFulfillmentContext(
  shop: string,
  token: string,
  sourceOrderId: string
) {
  const result = await shopifyGraphql<{
    order?: {
      tags?: string[] | null;
      displayFulfillmentStatus?: string | null;
      fulfillmentOrders?: { nodes?: Array<{ id?: string | null; status?: string | null }> };
    } | null;
  }>(shop, token, SHOPIFY_ORDER_FULFILLMENT_ORDERS, { id: shopifyOrderGid(sourceOrderId) });
  if (result.ok && result.json.data?.order) {
    return {
      tags: result.json.data.order.tags ?? [],
      displayFulfillmentStatus: result.json.data.order.displayFulfillmentStatus ?? null,
      fulfillmentOrders: (result.json.data.order.fulfillmentOrders?.nodes ?? [])
        .filter((node): node is { id: string; status: string | null } => Boolean(node?.id))
        .map((node) => ({ id: node.id, status: node.status ?? "" })),
    };
  }

  const fulfillmentOrdersRes = await shopifyRequest(
    shop,
    token,
    `/orders/${encodeURIComponent(sourceOrderId)}/fulfillment_orders.json`
  );
  if (!fulfillmentOrdersRes.ok) {
    return {
      tags: [] as string[],
      displayFulfillmentStatus: null as string | null,
      fulfillmentOrders: [] as ShopifyFulfillmentOrderNode[],
      reason: `fulfillment_orders_${fulfillmentOrdersRes.status}`,
    };
  }
  const json = (await fulfillmentOrdersRes.json()) as {
    fulfillment_orders?: Array<{ id?: number | string; status?: string }>;
  };
  return {
    tags: [] as string[],
    displayFulfillmentStatus: null as string | null,
    fulfillmentOrders: (json.fulfillment_orders ?? [])
      .filter((row) => row.id != null && row.id !== "")
      .map((row) => ({ id: shopifyFulfillmentOrderGid(row.id as number | string), status: row.status ?? "" })),
  };
}

async function applyShopifyStageTag(
  shop: string,
  token: string,
  sourceOrderId: string,
  existingTags: string[],
  stage: ShopifyStageTag
) {
  const tags = nextShopifyStageTags(existingTags, stage);
  const result = await shopifyGraphql<{
    orderUpdate?: {
      order?: { tags?: string[] | null; displayFulfillmentStatus?: string | null };
      userErrors?: Array<{ message?: string }>;
    };
  }>(shop, token, SHOPIFY_ORDER_UPDATE, {
    input: { id: shopifyOrderGid(sourceOrderId), tags },
  });
  const payload = result.json.data?.orderUpdate;
  if (!result.ok || payload?.userErrors?.length) {
    logError("shopify.stage_tag_failed", {
      sourceOrderId,
      stage,
      message: payload?.userErrors?.[0]?.message ?? result.json.errors?.[0]?.message ?? "orderUpdate failed",
    });
    return { skipped: true as const, reason: "tag_failed" };
  }
  return {
    skipped: false as const,
    tags: payload?.order?.tags ?? tags,
    displayFulfillmentStatus: payload?.order?.displayFulfillmentStatus ?? null,
  };
}

export async function markShopifyOrderProcessing(
  supabase: SupabaseClient,
  input: { organizationId: string; orderId: string }
) {
  const { data: order } = await supabase
    .from("orders")
    .select("id, source, source_order_id")
    .eq("id", input.orderId)
    .eq("organization_id", input.organizationId)
    .maybeSingle();
  if ((order?.source || "").toUpperCase() !== "SHOPIFY") return { skipped: true, reason: "not_shopify" };

  let sourceOrderId = order?.source_order_id ? String(order.source_order_id).trim() : "";
  if (!sourceOrderId) {
    const { data: ref } = await supabase
      .from("external_order_references")
      .select("source_order_id")
      .eq("organization_id", input.organizationId)
      .eq("order_id", input.orderId)
      .eq("source", "SHOPIFY")
      .maybeSingle();
    sourceOrderId = ref?.source_order_id ? String(ref.source_order_id).trim() : "";
  }
  if (!sourceOrderId) return { skipped: true, reason: "no_shopify_order_id" };

  const connection = await loadShopifyConnection(supabase, input.organizationId);
  const shop = connection?.shop_domain;
  const token = await resolveShopifyAdminToken(connection);
  if (!shop || !token) return { skipped: true, reason: "shopify_not_connected" };

  const context = await loadShopifyOrderFulfillmentContext(shop, token, sourceOrderId);
  if (!context.fulfillmentOrders.length && "reason" in context && context.reason) {
    logError("shopify.processing_skipped", { orderId: input.orderId, sourceOrderId, reason: context.reason });
    return { skipped: true, reason: context.reason };
  }

  let marked = 0;
  const errors: string[] = [];
  for (const fulfillmentOrder of context.fulfillmentOrders) {
    if ((fulfillmentOrder.status || "").toUpperCase() === "IN_PROGRESS") {
      marked += 1;
      continue;
    }
    if (!canReportShopifyFulfillmentProgress(fulfillmentOrder.status)) continue;
    const result = await shopifyGraphql<{
      fulfillmentOrderReportProgress?: {
        fulfillmentOrder?: { status?: string | null };
        userErrors?: Array<{ message?: string; code?: string }>;
      };
    }>(shop, token, FULFILLMENT_ORDER_REPORT_PROGRESS, {
      id: fulfillmentOrder.id.startsWith("gid://")
        ? fulfillmentOrder.id
        : shopifyFulfillmentOrderGid(fulfillmentOrder.id),
      progressReport: { reasonNotes: "Processing" },
    });
    const payload = result.json.data?.fulfillmentOrderReportProgress;
    const status = (payload?.fulfillmentOrder?.status ?? "").toUpperCase();
    if (result.ok && !payload?.userErrors?.length && status === "IN_PROGRESS") {
      marked += 1;
      continue;
    }
    const message =
      payload?.userErrors?.[0]?.message ??
      result.json.errors?.[0]?.message ??
      `progress_${status || "unknown"}`;
    errors.push(message);
    logError("shopify.processing_progress_failed", {
      orderId: input.orderId,
      sourceOrderId,
      fulfillmentOrderId: fulfillmentOrder.id,
      code: payload?.userErrors?.[0]?.code,
      message,
    });
  }

  const tagged = await applyShopifyStageTag(shop, token, sourceOrderId, context.tags, "processing");
  if (marked === 0 && (context.displayFulfillmentStatus || "").toUpperCase() === "IN_PROGRESS") {
    marked = 1;
  }

  if (marked === 0) {
    return {
      skipped: true,
      marked,
      tagged: !tagged.skipped,
      reason: errors[0] ?? "no_open_fulfillment_orders",
    };
  }
  return { skipped: false, marked, tagged: !tagged.skipped };
}

async function tagShopifyOrderStage(
  shop: string,
  token: string,
  sourceOrderId: string,
  stage: ShopifyStageTag
) {
  const context = await loadShopifyOrderFulfillmentContext(shop, token, sourceOrderId);
  return applyShopifyStageTag(shop, token, sourceOrderId, context.tags, stage);
}

export function shopifyStageFromJobProgress(
  progress: unknown
): "processing" | "booked" | "in_transit" | "delivered" | null {
  const event =
    progress && typeof progress === "object" ? (progress as { event?: string }).event : undefined;
  if (event === "processing" || event === "booked" || event === "in_transit" || event === "delivered") {
    return event;
  }
  return null;
}

export async function enqueueShopifyStageSync(
  supabase: SupabaseClient,
  input: {
    organizationId: string;
    orderId: string;
    shipmentId?: string | null;
    stage: "processing" | "booked" | "in_transit" | "delivered";
    userId?: string;
  }
) {
  try {
    const settings = await getAutomationSettings(supabase, input.organizationId);
    if (!settings.autoShopifyFulfillment) return;
  } catch {
    if (!AUTOMATION_DEFAULTS.auto_shopify_fulfillment) return;
  }
  const { createBackgroundJob } = await import("@/modules/jobs/service");
  await createBackgroundJob(supabase, {
    organizationId: input.organizationId,
    jobType: "shopify-fulfillment",
    entityType: input.shipmentId ? "shipment" : "order",
    entityId: input.shipmentId ?? input.orderId,
    userId: input.userId,
    progress: {
      event: input.stage,
      orderId: input.orderId,
      shipmentId: input.shipmentId ?? null,
    },
  });
}

export function shopifyFulfillmentEventStatus(stage: "booked" | "in_transit" | "delivered") {
  if (stage === "delivered") return "delivered";
  if (stage === "in_transit") return "in_transit";
  return "confirmed";
}

async function latestShopifyFulfillmentId(shop: string, token: string, sourceOrderId: string) {
  const listRes = await shopifyRequest(
    shop,
    token,
    `/orders/${encodeURIComponent(sourceOrderId)}/fulfillments.json`
  );
  if (!listRes.ok) return null;
  const json = (await listRes.json()) as { fulfillments?: Array<{ id?: number | string }> };
  const latest = [...(json.fulfillments ?? [])]
    .map((row) => Number(row.id))
    .filter((id) => Number.isFinite(id) && id > 0)
    .sort((a, b) => b - a)[0];
  return latest ?? null;
}

async function loadShopifyOrderLink(
  supabase: SupabaseClient,
  input: { organizationId: string; orderId: string }
) {
  const { data: order } = await supabase
    .from("orders")
    .select("id, source, source_order_id")
    .eq("id", input.orderId)
    .eq("organization_id", input.organizationId)
    .maybeSingle();
  if ((order?.source || "").toUpperCase() !== "SHOPIFY") return null;
  let sourceOrderId = order?.source_order_id ? String(order.source_order_id).trim() : "";
  if (!sourceOrderId) {
    const { data: ref } = await supabase
      .from("external_order_references")
      .select("source_order_id")
      .eq("organization_id", input.organizationId)
      .eq("order_id", input.orderId)
      .eq("source", "SHOPIFY")
      .maybeSingle();
    sourceOrderId = ref?.source_order_id ? String(ref.source_order_id).trim() : "";
  }
  if (!sourceOrderId) return null;
  return { orderId: order!.id as string, sourceOrderId };
}

export async function postShopifyFulfillmentEvent(
  supabase: SupabaseClient,
  input: { organizationId: string; orderId: string; stage: "booked" | "in_transit" | "delivered" }
) {
  const link = await loadShopifyOrderLink(supabase, input);
  if (!link) return { skipped: true, reason: "not_shopify" };
  const connection = await loadShopifyConnection(supabase, input.organizationId);
  const shop = connection?.shop_domain;
  const token = await resolveShopifyAdminToken(connection);
  if (!shop || !token) return { skipped: true, reason: "shopify_not_connected" };
  const fulfillmentId = await latestShopifyFulfillmentId(shop, token, link.sourceOrderId);
  if (!fulfillmentId) return { skipped: true, reason: "no_fulfillment" };
  const status = shopifyFulfillmentEventStatus(input.stage);
  const response = await shopifyRequest(
    shop,
    token,
    `/orders/${encodeURIComponent(link.sourceOrderId)}/fulfillments/${fulfillmentId}/events.json`,
    {
      method: "POST",
      body: JSON.stringify({ event: { status } }),
    }
  );
  if (!response.ok) {
    const body = await response.text();
    if (response.status === 422 && /already|duplicate|invalid/i.test(body)) {
      await tagShopifyOrderStage(shop, token, link.sourceOrderId, input.stage).catch(() => null);
      return { skipped: true, reason: "event_already_set", status };
    }
    return { skipped: true, reason: `fulfillment_event_${response.status}`, status };
  }
  await tagShopifyOrderStage(shop, token, link.sourceOrderId, input.stage).catch(() => null);
  return { skipped: false, status };
}

export async function syncShopifyOrderStage(
  supabase: SupabaseClient,
  input: {
    organizationId: string;
    orderId: string;
    shipmentId?: string | null;
    stage: "processing" | "booked" | "in_transit" | "delivered";
  }
) {
  try {
    if (input.stage === "processing") {
      return await markShopifyOrderProcessing(supabase, {
        organizationId: input.organizationId,
        orderId: input.orderId,
      });
    }
    if (input.stage === "booked") {
      if (!input.shipmentId) return { skipped: true, reason: "no_shipment" };
      return await fulfillShopifyShipment(supabase, {
        organizationId: input.organizationId,
        shipmentId: input.shipmentId,
      });
    }
    if (input.shipmentId) {
      await fulfillShopifyShipment(supabase, {
        organizationId: input.organizationId,
        shipmentId: input.shipmentId,
      }).catch(() => null);
    }
    return await postShopifyFulfillmentEvent(supabase, {
      organizationId: input.organizationId,
      orderId: input.orderId,
      stage: input.stage,
    });
  } catch (error) {
    logError("shopify.stage_sync_failed", {
      orderId: input.orderId,
      stage: input.stage,
      message: error instanceof Error ? error.message : "shopify_stage_failed",
    });
    return { skipped: true, reason: "shopify_stage_failed" };
  }
}

export async function fulfillShopifyShipment(
  supabase: SupabaseClient,
  input: { organizationId: string; shipmentId: string }
): Promise<ShopifyFulfillmentResult> {
  const { data: shipment, error } = await supabase
    .from("shipments")
    .select("id, barcode, tracking_number, order_id, orders(id, source, source_order_id, fulfillment_status)")
    .eq("id", input.shipmentId)
    .eq("organization_id", input.organizationId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!shipment) return { skipped: true, reason: "shipment_missing" };

  type ShopifyLinkedOrder = {
    id: string;
    source?: string | null;
    source_order_id?: string | null;
    fulfillment_status?: string | null;
  };
  const order = asRecord(shipment.orders as ShopifyLinkedOrder | ShopifyLinkedOrder[] | null);
  if (!order?.id) return { skipped: true, reason: "no_order" };
  if ((order.source || "").toUpperCase() !== "SHOPIFY") {
    return { skipped: true, reason: "not_shopify" };
  }

  const tracking = String(shipment.barcode || shipment.tracking_number || "").trim();
  if (!tracking) return { skipped: true, reason: "no_barcode" };

  let sourceOrderId = order.source_order_id ? String(order.source_order_id).trim() : "";
  if (!sourceOrderId) {
    const { data: ref } = await supabase
      .from("external_order_references")
      .select("source_order_id")
      .eq("organization_id", input.organizationId)
      .eq("order_id", order.id)
      .eq("source", "SHOPIFY")
      .maybeSingle();
    sourceOrderId = ref?.source_order_id ? String(ref.source_order_id).trim() : "";
  }
  if (!sourceOrderId) return { skipped: true, reason: "no_shopify_order_id" };

  const connection = await loadShopifyConnection(supabase, input.organizationId);
  const shop = connection?.shop_domain;
  const token = await resolveShopifyAdminToken(connection);
  if (!shop || !token) return { skipped: true, reason: "shopify_not_connected" };

  const trackingInfo = shopifyTrackingInfo(tracking);
  if (!trackingInfo) return { skipped: true, reason: "no_barcode" };

  const context = await loadShopifyOrderFulfillmentContext(shop, token, sourceOrderId);
  if (!context.fulfillmentOrders.length && "reason" in context && context.reason) {
    if (String(context.reason).includes("404")) {
      return { skipped: true, reason: "shopify_order_missing" };
    }
    throw Object.assign(new Error(`Shopify fulfillment orders failed (${context.reason}).`), {
      code: "PROVIDER_ERROR",
    });
  }

  const payload = shopifyFulfillmentPayload({
    fulfillmentOrders: context.fulfillmentOrders,
    trackingNumber: tracking,
  });
  if (!payload.fulfillment.trackingInfo) return { skipped: true, reason: "no_barcode" };

  async function finishShopifyFulfillment(updated: boolean, reason?: string) {
    await markOrderFulfilled(supabase, order.id);
    await tagShopifyOrderStage(shop, token, sourceOrderId, "booked").catch(() => null);
    return updated
      ? { skipped: false, fulfilled: true }
      : { skipped: true, reason: reason ?? "already_fulfilled_remote", fulfilled: true };
  }

  if (!payload.fulfillment.lineItemsByFulfillmentOrder.length) {
    const updated = await updateExistingShopifyTracking(shop, token, sourceOrderId, tracking);
    return finishShopifyFulfillment(updated, "no_open_fulfillment_orders");
  }

  const createResult = await shopifyGraphql<{
    fulfillmentCreate?: {
      fulfillment?: {
        id?: string | null;
        trackingInfo?: Array<{ number?: string | null; url?: string | null; company?: string | null }>;
      } | null;
      userErrors?: Array<{ message?: string }>;
    };
  }>(shop, token, SHOPIFY_FULFILLMENT_CREATE, { fulfillment: payload.fulfillment });
  const created = createResult.json.data?.fulfillmentCreate;
  const userErrors = created?.userErrors ?? [];
  const userErrorMessage = userErrors.map((error) => error.message ?? "").join(" ");

  if (createResult.ok && created?.fulfillment?.id && !userErrors.length) {
    await markOrderFulfilled(supabase, order.id);
    await tagShopifyOrderStage(shop, token, sourceOrderId, "booked").catch(() => null);
    return { skipped: false, fulfilled: true };
  }

  if (userErrors.length && userErrors.every((error) => isAlreadyFulfilledShopifyMessage(error.message ?? ""))) {
    const updated = await updateExistingShopifyTracking(shop, token, sourceOrderId, tracking);
    return finishShopifyFulfillment(updated, "already_fulfilled_remote");
  }

  if (!createResult.ok || userErrors.length) {
    const restBody = restShopifyFulfillmentBody(payload);
    if (restBody.fulfillment.line_items_by_fulfillment_order.length && restBody.fulfillment.tracking_info) {
      const createRes = await shopifyRequest(shop, token, "/fulfillments.json", {
        method: "POST",
        body: JSON.stringify(restBody),
      });
      if (createRes.ok) {
        await markOrderFulfilled(supabase, order.id);
        await tagShopifyOrderStage(shop, token, sourceOrderId, "booked").catch(() => null);
        return { skipped: false, fulfilled: true };
      }
      const body = await createRes.text();
      if (createRes.status === 422 && isAlreadyFulfilledShopifyMessage(body)) {
        const updated = await updateExistingShopifyTracking(shop, token, sourceOrderId, tracking);
        return finishShopifyFulfillment(updated, "already_fulfilled_remote");
      }
    }
    const message =
      userErrorMessage ||
      createResult.json.errors?.[0]?.message ||
      "Shopify fulfillmentCreate failed.";
    throw Object.assign(new Error(message), { code: "PROVIDER_ERROR" });
  }

  throw Object.assign(new Error("Shopify fulfillmentCreate returned no fulfillment."), {
    code: "PROVIDER_ERROR",
  });
}

export async function registerShopifyOrderWebhooks(shop: string, token: string) {
  const address = shopifyWebhookUrl();
  if (!address.startsWith("https://") || address.includes("localhost")) {
    return { registered: 0, skipped: true as const };
  }
  const existingRes = await shopifyRequest(shop, token, "/webhooks.json");
  const existingJson = existingRes.ok
    ? ((await existingRes.json()) as { webhooks?: Array<{ topic?: string; address?: string }> })
    : { webhooks: [] };
  const have = new Set(
    (existingJson.webhooks ?? [])
      .filter((hook) => hook.address === address)
      .map((hook) => hook.topic)
  );
  let registered = 0;
  for (const topic of ORDER_WEBHOOK_TOPICS) {
    if (have.has(topic)) continue;
    const response = await shopifyRequest(shop, token, "/webhooks.json", {
      method: "POST",
      body: JSON.stringify({ webhook: { topic, address, format: "json" } }),
    });
    if (response.ok) registered += 1;
  }
  return { registered, skipped: false as const };
}

async function insertAddress(
  supabase: SupabaseClient,
  organizationId: string,
  customerId: string,
  address: Record<string, string | null> | null | undefined
) {
  const { data, error } = await supabase
    .from("addresses")
    .insert({
      organization_id: organizationId,
      customer_id: customerId,
      kind: "shipping",
      name: address?.name || shopifyCustomerName({ shipping_address: address }),
      phone: shopifyPhone(address?.phone),
      line1: address?.address1 || "Address pending",
      line2: address?.address2 || null,
      city: address?.city || "NA",
      state: address?.province || "NA",
      pincode: shopifyPincode(address?.zip),
      country: address?.country_code || "IN",
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message || "Could not save Shopify address.");
  return data.id as string;
}

export async function upsertShopifyOrder(
  supabase: SupabaseClient,
  input: {
    organizationId: string;
    userId?: string;
    shopDomain: string;
    remote: ShopifyRemoteOrder;
    createShipment?: boolean;
    enqueueBooking?: boolean;
  }
) {
  const sourceId = String(input.remote.id || "");
  if (!sourceId) return { imported: false, updated: false, skipped: true, orderId: null as string | null };

  const { data: existing } = await supabase
    .from("external_order_references")
    .select("order_id")
    .eq("organization_id", input.organizationId)
    .eq("source", "SHOPIFY")
    .eq("source_order_id", sourceId)
    .maybeSingle();

  const fulfillmentStatus = mapShopifyFulfillmentStatus(
    input.remote.fulfillment_status,
    input.remote.cancelled_at
  );
  const paymentStatus = mapShopifyPaymentStatus(
    input.remote.financial_status,
    input.remote.payment_gateway_names ?? input.remote.gateway
  );
  const { data: existingOrder } = existing?.order_id
    ? await supabase.from("orders").select("status").eq("id", existing.order_id).maybeSingle()
    : { data: null };
  let orderStatus = nextShopifyOrderStatus({
    cancelledAt: input.remote.cancelled_at,
    fulfillmentStatus,
    currentStatus: existingOrder?.status,
  });
  if (shopifyRemoteSignalsProcessing(input.remote) && orderStatus === "READY") {
    orderStatus = "PROCESSING";
  }
  const collect = mapShopifyCollectable(input.remote, paymentStatus);
  const totals = {
    currency: input.remote.currency || "INR",
    subtotal: Number(input.remote.subtotal_price ?? 0),
    discount: Number(input.remote.total_discounts ?? 0),
    shipping_amount: Number(input.remote.total_shipping_price_set?.shop_money?.amount ?? 0),
    tax_amount: Number(input.remote.total_tax ?? 0),
    total_amount: Number(input.remote.total_price ?? 0),
    payment_status: collect.paymentStatus,
    amount_paid: collect.amountPaid,
    cod_amount: collect.codAmount,
    fulfillment_status: fulfillmentStatus,
    status: orderStatus,
  };
  const lineItems = (input.remote.line_items ?? []).filter((item) => Number(item.quantity ?? 0) > 0);

  if (existing?.order_id) {
    await supabase.from("orders").update(totals).eq("id", existing.order_id);
    await refreshShopifyLineItems(supabase, {
      organizationId: input.organizationId,
      orderId: existing.order_id as string,
      orderStatus: existingOrder?.status,
      lineItems,
    });
    if (shopifyRemoteSignalsProcessing(input.remote)) {
      await notifyShopifyProcessingWati(supabase, input.organizationId, existing.order_id as string);
    }
    return { imported: false, updated: true, skipped: false, orderId: existing.order_id as string };
  }

  if (!isUnfulfilledShopifyOrder(input.remote)) {
    return { imported: false, updated: false, skipped: true, orderId: null as string | null };
  }

  const shipping = input.remote.shipping_address;
  const { data: customer, error: customerError } = await supabase
    .from("customers")
    .insert({
      organization_id: input.organizationId,
      name: shopifyCustomerName(input.remote),
      phone: shopifyPhone(shipping?.phone || input.remote.customer?.phone),
      email: input.remote.email || input.remote.customer?.email || null,
    })
    .select("id")
    .single();
  if (customerError || !customer) {
    throw new Error(customerError?.message || "Could not save Shopify customer.");
  }

  const shippingId = await insertAddress(supabase, input.organizationId, customer.id, shipping);
  const billingId = input.remote.billing_address
    ? await insertAddress(supabase, input.organizationId, customer.id, input.remote.billing_address)
    : shippingId;
  const fallbackTotal = lineItems.reduce(
    (sum, item) => sum + Number(item.price ?? 0) * Number(item.quantity ?? 1),
    0
  );

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .insert({
      organization_id: input.organizationId,
      source: "SHOPIFY",
      source_order_id: sourceId,
      order_number: shopifyOrderNumber(input.remote, sourceId),
      customer_id: customer.id,
      shipping_address_id: shippingId,
      billing_address_id: billingId,
      ...totals,
      subtotal: totals.subtotal || fallbackTotal,
      total_amount: totals.total_amount || fallbackTotal,
    })
    .select("id")
    .single();

  if (orderError?.code === "23505") {
    const { data: byNumber } = await supabase
      .from("orders")
      .select("id")
      .eq("organization_id", input.organizationId)
      .eq("order_number", shopifyOrderNumber(input.remote, sourceId))
      .maybeSingle();
      if (byNumber?.id) {
      await supabase.from("orders").update(totals).eq("id", byNumber.id);
      await supabase.from("external_order_references").upsert(
        {
          organization_id: input.organizationId,
          order_id: byNumber.id,
          source: "SHOPIFY",
          source_order_id: sourceId,
          shop_domain: normalizeShopDomain(input.shopDomain),
        },
        { onConflict: "organization_id,source,source_order_id" }
      );
      const { data: duplicateOrder } = await supabase
        .from("orders")
        .select("status")
        .eq("id", byNumber.id)
        .maybeSingle();
      await refreshShopifyLineItems(supabase, {
        organizationId: input.organizationId,
        orderId: byNumber.id as string,
        orderStatus: duplicateOrder?.status,
        lineItems,
      });
      return { imported: false, updated: true, skipped: false, orderId: byNumber.id as string };
    }
  }

  if (orderError || !order) {
    throw new Error(orderError?.message || "Could not save Shopify order.");
  }

  if (lineItems.length) {
    const { error: itemsError } = await supabase
      .from("order_line_items")
      .insert(shopifyLineItemRows(input.organizationId, order.id, lineItems));
    if (itemsError) throw new Error(itemsError.message);
  }

  const { error: refError } = await supabase.from("external_order_references").insert({
    organization_id: input.organizationId,
    order_id: order.id,
    source: "SHOPIFY",
    source_order_id: sourceId,
    shop_domain: normalizeShopDomain(input.shopDomain),
  });
  if (refError && refError.code !== "23505") throw new Error(refError.message);

  await supabase.from("audit_logs").insert({
    organization_id: input.organizationId,
    actor_id: input.userId || null,
    action: "order.imported",
    entity_type: "order",
    entity_id: order.id,
    after: { source: "SHOPIFY", sourceOrderId: sourceId },
  });
  await supabase.from("notifications").insert({
    organization_id: input.organizationId,
    type: "shopify.order_imported",
    title: "New Shopify order",
    body: `${shopifyOrderNumber(input.remote, sourceId)} · ${shopifyCustomerName(input.remote)}`,
    entity_type: "order",
    entity_id: order.id,
  });
  try {
    const { enqueueWatiNotify } = await import("@/modules/wati/send");
    await enqueueWatiNotify(supabase, input.organizationId, "order_confirmation", { orderId: order.id });
  } catch {
    // WhatsApp confirmation is optional; the Shopify import should still succeed.
  }
  try {
    const { enqueueVachatNotify } = await import("@/modules/vachat/send");
    await enqueueVachatNotify(supabase, input.organizationId, "order_confirmation", { orderId: order.id });
  } catch {
    // Vachat confirmation is optional; the Shopify import should still succeed.
  }
  try {
    const { scheduleMerchantKnowledgeSync } = await import("@/modules/vachat/knowledge");
    scheduleMerchantKnowledgeSync(supabase, input.organizationId);
  } catch {
    // VaChat knowledge is optional; the Shopify import should still succeed.
  }

  const workspace = await loadWorkspaceParcelDefaults(supabase, input.organizationId);
  const parcelExtras = shopifyResolvedShipmentDims(lineItems, workspace);
  if (input.createShipment) {
    try {
      const { createShipmentsForOrders } = await import("@/modules/shipments/service");
      await createShipmentsForOrders(
        supabase,
        {
          userId: input.userId ?? "",
          email: null,
          fullName: null,
          organizationId: input.organizationId,
          organizationName: "",
          role: "OWNER",
          permissions: [],
        },
        [order.id],
        { enqueueBooking: input.enqueueBooking !== false, runBookingNow: false, ...parcelExtras }
      );
    } catch {
      // Order import should still succeed if shipment automation fails.
    }
  } else {
    await applyShopifyParcelToShipment(supabase, {
      organizationId: input.organizationId,
      orderId: order.id as string,
      orderStatus,
      userId: input.userId,
      lineItems,
      createIfMissing: true,
      enqueueBooking: false,
    });
  }

  return { imported: true, updated: false, skipped: false, orderId: order.id as string };
}

async function shopifyOrderAutomation(supabase: SupabaseClient, organizationId: string) {
  try {
    const automation = await getAutomationSettings(supabase, organizationId);
    return {
      autoShopifySync: Boolean(automation.autoShopifySync),
      createShipment: Boolean(automation.autoShipmentCreation),
      enqueueBooking: Boolean(automation.autoBooking),
    };
  } catch {
    return {
      autoShopifySync: AUTOMATION_DEFAULTS.auto_shopify_sync,
      createShipment: AUTOMATION_DEFAULTS.auto_shipment_creation,
      enqueueBooking: AUTOMATION_DEFAULTS.auto_booking,
    };
  }
}

export async function importShopifyProgressReported(
  supabase: SupabaseClient,
  input: { organizationId: string; payload: unknown }
) {
  const parsed = parseShopifyProgressReported(input.payload);
  if (!parsed.inProgress || !parsed.sourceOrderId) {
    return { updated: false, skipped: true, orderId: null as string | null };
  }

  const { data: ref } = await supabase
    .from("external_order_references")
    .select("order_id")
    .eq("organization_id", input.organizationId)
    .eq("source", "SHOPIFY")
    .eq("source_order_id", parsed.sourceOrderId)
    .maybeSingle();
  if (!ref?.order_id) return { updated: false, skipped: true, orderId: null as string | null };

  const { data: order } = await supabase
    .from("orders")
    .select("id, status")
    .eq("id", ref.order_id)
    .eq("organization_id", input.organizationId)
    .maybeSingle();
  if (!order) return { updated: false, skipped: true, orderId: null as string | null };

  const current = (order.status ?? "").toUpperCase();
  if (["BOOKED", "SHIPPED", "IN_TRANSIT", "DELIVERED", "CANCELLED"].includes(current)) {
    return { updated: false, skipped: true, orderId: order.id as string };
  }

  if (current !== "PROCESSING") {
    await supabase.from("orders").update({ status: "PROCESSING" }).eq("id", order.id);
  }
  await notifyShopifyProcessingWati(supabase, input.organizationId, order.id as string);

  return { updated: current !== "PROCESSING", skipped: false, orderId: order.id as string };
}

export async function importShopifyWebhookOrder(
  supabase: SupabaseClient,
  input: { organizationId: string; shopDomain: string; topic: string; remote: ShopifyRemoteOrder }
) {
  if (!input.topic.startsWith("orders/")) {
    return { imported: false, updated: false, skipped: true, orderId: null as string | null };
  }
  const automation = await shopifyOrderAutomation(supabase, input.organizationId);
  if (!automation.autoShopifySync) {
    return { imported: false, updated: false, skipped: true, orderId: null as string | null };
  }
  let remote = input.remote;
  try {
    const connection = await loadShopifyConnection(supabase, input.organizationId);
    if (connection?.shop_domain || connection?.encrypted_access_token) {
      const token = await resolveShopifyAdminToken(connection);
      const shop = connection.shop_domain || input.shopDomain;
      if (token && shop) {
        const [enriched] = await withShopifyProductShippingData(shop, token, [remote]);
        if (enriched) remote = enriched;
      }
    }
  } catch {
    // Keep the webhook import even if product weight/size cannot be loaded.
  }
  return upsertShopifyOrder(supabase, {
    organizationId: input.organizationId,
    shopDomain: input.shopDomain,
    remote,
    createShipment: automation.createShipment,
    enqueueBooking: automation.enqueueBooking,
  });
}

function nextPageInfo(linkHeader: string | null) {
  const next = (linkHeader ?? "").match(/<[^>]+page_info=([^&>]+)[^>]*>; rel="next"/);
  return next?.[1] ? decodeURIComponent(next[1]) : null;
}

export async function fetchUnfulfilledShopifyOrders(shop: string, token: string, pageInfo?: string | null) {
  const url = new URL(`https://${normalizeShopDomain(shop)}/admin/api/${SHOPIFY_API_VERSION}/orders.json`);
  url.searchParams.set("limit", "50");
  if (pageInfo) {
    url.searchParams.set("page_info", pageInfo);
  } else {
    url.searchParams.set("status", "open");
    url.searchParams.set("fulfillment_status", "unshipped");
  }
  const response = await shopifyRequest(shop, token, url.toString());
  if (!response.ok) {
    throw shopifyHttpError(`Shopify orders fetch failed (${response.status}).`, response.status);
  }
  const json = (await response.json()) as { orders?: ShopifyRemoteOrder[] };
  return {
    orders: await withShopifyProductShippingData(shop, token, json.orders ?? []),
    nextPage: nextPageInfo(response.headers.get("link")),
  };
}

async function fetchShopifyProductsByIds(shop: string, token: string, productIds: string[]) {
  const products = new Map<string, ShopifyProduct>();
  for (let index = 0; index < productIds.length; index += 50) {
    const chunk = productIds.slice(index, index + 50);
    const path = `/products.json?ids=${encodeURIComponent(chunk.join(","))}&fields=id,image,images,variants`;
    try {
      const response = await shopifyRequest(shop, token, path);
      if (!response.ok) continue;
      const json = (await response.json()) as { products?: ShopifyProduct[] };
      for (const product of json.products ?? []) {
        if (product.id != null) products.set(String(product.id), product);
      }
    } catch {
      // Keep the order import even if product data cannot be loaded.
    }
  }
  return products;
}

export function parseShopifyVariantShippingNode(node: Record<string, unknown> | null | undefined): ShopifyVariantShipping {
  const dims = dimsFromMetafields(metafieldMapFromVariantNode(node));
  return {
    grams: null,
    weight: null,
    lengthCm: dims?.lengthCm ?? null,
    widthCm: dims?.widthCm ?? null,
    heightCm: dims?.heightCm ?? null,
  };
}

async function fetchShopifyVariantShipping(shop: string, token: string, variantIds: string[]) {
  const byGid = new Map<string, ShopifyVariantShipping>();
  const gids = variantIds.map((id) => shopifyVariantGid(id)).filter((id): id is string => Boolean(id));
  for (let index = 0; index < gids.length; index += 50) {
    const chunk = gids.slice(index, index + 50);
    try {
      const result = await shopifyGraphql<{
        nodes?: Array<Record<string, unknown> | null>;
      }>(shop, token, SHOPIFY_VARIANT_SHIPPING_QUERY, { ids: chunk });
      if (!result.ok) {
        logError("shopify.variant_shipping.graphql", {
          message: result.json.errors?.[0]?.message || `HTTP ${result.ok ? "ok" : "failed"}`,
        });
        continue;
      }
      for (const node of result.json.data?.nodes ?? []) {
        if (!node?.id) continue;
        byGid.set(String(node.id), parseShopifyVariantShippingNode(node));
      }
    } catch {
      // Keep the order import even if variant dimensions cannot be loaded.
    }
  }
  return byGid;
}

export async function withShopifyProductShippingData(shop: string, token: string, orders: ShopifyRemoteOrder[]) {
  const productIds = new Set<string>();
  const variantIds = new Set<string>();
  for (const order of orders) {
    for (const item of order.line_items ?? []) {
      if (item.product_id != null) productIds.add(String(item.product_id));
      if (item.variant_id != null) variantIds.add(String(item.variant_id));
    }
  }

  const products =
    productIds.size > 0 ? await fetchShopifyProductsByIds(shop, token, [...productIds]) : new Map<string, ShopifyProduct>();
  const shipping =
    variantIds.size > 0
      ? await fetchShopifyVariantShipping(shop, token, [...variantIds])
      : new Map<string, ShopifyVariantShipping>();

  return orders.map((order) => ({
    ...order,
    line_items: (order.line_items ?? []).map((item) => {
      const product = item.product_id != null ? products.get(String(item.product_id)) : undefined;
      const gid = shopifyVariantGid(item.variant_id);
      return applyShopifyProductShippingToLineItem(item, product, gid ? shipping.get(gid) ?? null : null);
    }),
  }));
}

async function fetchShopifyProductImageCatalog(shop: string, token: string, maxPages = 20) {
  const products: ShopifyProduct[] = [];
  let pageInfo: string | null = null;
  for (let page = 0; page < maxPages; page += 1) {
    const url = new URL(`https://${normalizeShopDomain(shop)}/admin/api/${SHOPIFY_API_VERSION}/products.json`);
    url.searchParams.set("limit", "250");
    url.searchParams.set("fields", "id,title,image,images,variants");
    if (pageInfo) {
      url.searchParams.set("page_info", pageInfo);
    } else {
      url.searchParams.set("status", "active,draft,archived");
    }
    try {
      let response = await shopifyRequest(shop, token, url.toString());
      if (!response.ok && !pageInfo) {
        const fallback = new URL(`https://${normalizeShopDomain(shop)}/admin/api/${SHOPIFY_API_VERSION}/products.json`);
        fallback.searchParams.set("limit", "250");
        fallback.searchParams.set("fields", "id,title,image,images,variants");
        response = await shopifyRequest(shop, token, fallback.toString());
      }
      if (!response.ok) break;
      const json = (await response.json()) as { products?: ShopifyProduct[] };
      products.push(...(json.products ?? []));
      pageInfo = nextPageInfo(response.headers.get("link"));
      if (!pageInfo) break;
    } catch {
      break;
    }
  }
  return indexShopifyProductsForLineItemImages(products);
}

export async function backfillMissingShopifyLineItemImages(
  supabase: SupabaseClient,
  organizationId: string,
  options?: { maxRounds?: number }
) {
  if (shopifyImageBackfillInFlight.has(organizationId)) return { updated: 0 };
  shopifyImageBackfillInFlight.add(organizationId);
  try {
    const db = hasAdminClient() ? createAdminClient() : supabase;
    const connection = await loadShopifyConnection(db, organizationId);
    if (!connection?.shop_domain) return { updated: 0 };
    const token = await resolveShopifyAdminToken(connection);
    if (!token) {
      logError("shopify.line-item-images.no-token", {
        organizationId,
        hasAccessToken: Boolean(connection.encrypted_access_token),
      });
      return { updated: 0 };
    }

    const catalog = await fetchShopifyProductImageCatalog(connection.shop_domain, token);
    if (catalog.byTitle.size === 0 && catalog.bySku.size === 0) {
      logError("shopify.line-item-images.catalog-empty", { organizationId });
      return { updated: 0 };
    }

    const maxRounds = Math.max(1, options?.maxRounds ?? 1);
    let updated = 0;
    for (let round = 0; round < maxRounds; round += 1) {
      const missingJoin = await db
        .from("order_line_items")
        .select("id, title, sku, order_id, orders!inner(source)")
        .eq("organization_id", organizationId)
        .eq("orders.source", "SHOPIFY")
        .is("image_url", null)
        .order("created_at", { ascending: false })
        .limit(500);
      const missing = missingJoin.error
        ? await db
            .from("order_line_items")
            .select("id, title, sku, order_id")
            .eq("organization_id", organizationId)
            .is("image_url", null)
            .order("created_at", { ascending: false })
            .limit(500)
        : missingJoin;
      if (missing.error) {
        logError("shopify.line-item-images.backfill", {
          organizationId,
          message: missing.error.message,
        });
        break;
      }
      const rows = Array.isArray(missing.data) ? missing.data : [];
      if (!rows.length) break;

      const patches = rows
        .map((row) => {
          const src = shopifyCatalogImageForLineItem(row.title, row.sku, catalog);
          return src ? { id: row.id as string, src } : null;
        })
        .filter((row): row is { id: string; src: string } => Boolean(row));
      if (!patches.length) break;

      for (let index = 0; index < patches.length; index += 25) {
        const chunk = patches.slice(index, index + 25);
        const results = await Promise.all(
          chunk.map((row) =>
            db
              .from("order_line_items")
              .update({ image_url: row.src })
              .eq("id", row.id)
              .eq("organization_id", organizationId)
          )
        );
        updated += results.filter((result) => !result.error).length;
      }
    }
    return { updated };
  } finally {
    shopifyImageBackfillInFlight.delete(organizationId);
  }
}

export async function syncUnfulfilledShopifyOrders(
  supabase: SupabaseClient,
  input: { organizationId: string; userId?: string; maxPages?: number; pageInfo?: string | null }
): Promise<ShopifySyncResult> {
  const connection = await loadShopifyConnection(supabase, input.organizationId);
  if (!shopifyReadyToSync(connection)) {
    return { imported: 0, updated: 0, skipped: 0, hasMore: false, connected: false, nextPageInfo: null };
  }
  const token = await resolveShopifyAdminToken(connection);
  if (!token || !connection?.shop_domain) {
    if (connection?.id) {
      await supabase
        .from("shopify_connections")
        .update({ last_error: "Could not authenticate with Shopify. Check Client ID and secret." })
        .eq("id", connection.id);
    }
    return { imported: 0, updated: 0, skipped: 0, hasMore: false, connected: false, nextPageInfo: null };
  }

  await markShopifyConnected(supabase, connection);
  try {
    await registerShopifyOrderWebhooks(connection.shop_domain, token);
  } catch {
    // Webhooks still import when registration is blocked; background sync covers the rest.
  }

  const automation = await shopifyOrderAutomation(supabase, input.organizationId);

  const result: ShopifySyncResult = {
    imported: 0,
    updated: 0,
    skipped: 0,
    hasMore: false,
    connected: true,
    nextPageInfo: null,
  };
  let pageInfo: string | null = input.pageInfo ?? null;
  const maxPages = input.maxPages ?? 20;
  for (let page = 0; page < maxPages; page += 1) {
    try {
      const batch = await fetchUnfulfilledShopifyOrders(connection.shop_domain, token, pageInfo);
      for (const remote of batch.orders) {
        const upserted = await upsertShopifyOrder(supabase, {
          organizationId: input.organizationId,
          userId: input.userId,
          shopDomain: connection.shop_domain,
          remote,
          createShipment: automation.createShipment,
          enqueueBooking: automation.enqueueBooking,
        });
        if (upserted.imported) result.imported += 1;
        else if (upserted.updated) result.updated += 1;
        else result.skipped += 1;
      }
      pageInfo = batch.nextPage;
      result.nextPageInfo = pageInfo;
      if (!pageInfo) break;
      if (page === maxPages - 1) result.hasMore = true;
    } catch (error) {
      const httpError = error as ReturnType<typeof shopifyHttpError>;
      httpError.shopifyPageInfo = pageInfo;
      httpError.imported = result.imported;
      httpError.updated = result.updated;
      httpError.skipped = result.skipped;
      throw httpError;
    }
  }

  if (connection.id) {
    await supabase
      .from("shopify_connections")
      .update({ last_sync_at: new Date().toISOString(), last_error: null })
      .eq("id", connection.id);
  }
  try {
    await backfillMissingShopifyLineItemImages(supabase, input.organizationId, { maxRounds: 8 });
  } catch (error) {
    logError("shopify.line-item-images.backfill", {
      organizationId: input.organizationId,
      message: error instanceof Error ? error.message : "unknown",
    });
  }
  return result;
}
