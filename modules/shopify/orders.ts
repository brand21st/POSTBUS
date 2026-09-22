import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptSecret } from "@/lib/security/crypto";
import { AUTOMATION_DEFAULTS, getAutomationSettings } from "@/modules/automation/service";
import {
  normalizeShopDomain,
  resolveShopifyAppCredentials,
  shopifyWebhookUrl,
  type ShopifyCredentialRow,
} from "@/modules/shopify/oauth";
import { indiaPostPublicTrackingUrl } from "@/modules/india-post/barcode";
import { customerTrackingLink } from "@/modules/tracking-pages/host";
import { getTrackingPage } from "@/modules/tracking-pages/service";
import { logError } from "@/lib/logger";
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
  shipping_address?: Record<string, string | null> | null;
  billing_address?: Record<string, string | null> | null;
  customer?: { first_name?: string | null; last_name?: string | null; email?: string | null; phone?: string | null } | null;
  payment_gateway_names?: string[] | null;
  gateway?: string | null;
  line_items?: Array<{
    title?: string;
    sku?: string | null;
    quantity?: number;
    price?: string | number;
    grams?: number;
  }>;
};

export type ShopifySyncResult = {
  imported: number;
  updated: number;
  skipped: number;
  hasMore: boolean;
  connected: boolean;
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

export function shopifyOrderGid(id: number | string) {
  const raw = String(id);
  return raw.startsWith("gid://") ? raw : `gid://shopify/Order/${raw}`;
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
  const response = await fetch(url, {
    ...init,
    headers: {
      "X-Shopify-Access-Token": token,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  return response;
}

async function shopifyGraphql<T>(
  shop: string,
  token: string,
  query: string,
  variables: Record<string, unknown>
) {
  const response = await fetch(
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
  const response = await fetch(`https://${normalizeShopDomain(shop)}/admin/oauth/access_token`, {
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

export const INDIA_POST_CARRIER = "India Post";

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

export function shopifyTrackingInfo(articleId: string, trackingUrl?: string | null) {
  return {
    company: INDIA_POST_CARRIER,
    number: articleId,
    url: trackingUrl?.trim() || indiaPostPublicTrackingUrl(articleId),
  };
}

export function shopifyFulfillmentPayload(input: {
  fulfillmentOrders: ShopifyFulfillmentOrder[];
  trackingNumber: string;
  trackingUrl?: string | null;
  notifyCustomer?: boolean;
}) {
  const lineItemsByFulfillmentOrder = input.fulfillmentOrders
    .filter((order) => {
      const status = (order.status || "open").toLowerCase();
      return status === "open" || status === "in_progress";
    })
    .map((order) => ({ fulfillment_order_id: Number(order.id) }))
    .filter((row) => Number.isFinite(row.fulfillment_order_id) && row.fulfillment_order_id > 0);

  return {
    fulfillment: {
      line_items_by_fulfillment_order: lineItemsByFulfillmentOrder,
      tracking_info: shopifyTrackingInfo(input.trackingNumber, input.trackingUrl),
      notify_customer: input.notifyCustomer !== false,
    },
  };
}

async function updateExistingShopifyTracking(
  shop: string,
  token: string,
  sourceOrderId: string,
  articleId: string,
  trackingUrl?: string | null
) {
  const listRes = await shopifyRequest(
    shop,
    token,
    `/orders/${encodeURIComponent(sourceOrderId)}/fulfillments.json`
  );
  if (!listRes.ok) return false;
  const json = (await listRes.json()) as { fulfillments?: Array<{ id?: number | string }> };
  const latest = [...(json.fulfillments ?? [])]
    .map((row) => Number(row.id))
    .filter((id) => Number.isFinite(id) && id > 0)
    .sort((a, b) => b - a)[0];
  if (!latest) return false;
  const updateRes = await shopifyRequest(shop, token, `/fulfillments/${latest}/update_tracking.json`, {
    method: "POST",
    body: JSON.stringify({
      fulfillment: {
        notify_customer: true,
        tracking_info: shopifyTrackingInfo(articleId, trackingUrl),
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

  const trackingPage = await getTrackingPage(supabase, input.organizationId).catch(() => null);
  const trackingUrl =
    trackingPage?.status === "PUBLISHED"
      ? customerTrackingLink(trackingPage.publicUrl, tracking)
      : null;

  const connection = await loadShopifyConnection(supabase, input.organizationId);
  const shop = connection?.shop_domain;
  const token = await resolveShopifyAdminToken(connection);
  if (!shop || !token) return { skipped: true, reason: "shopify_not_connected" };

  const fulfillmentOrdersRes = await shopifyRequest(
    shop,
    token,
    `/orders/${encodeURIComponent(sourceOrderId)}/fulfillment_orders.json`
  );
  if (fulfillmentOrdersRes.status === 404) {
    return { skipped: true, reason: "shopify_order_missing" };
  }
  if (!fulfillmentOrdersRes.ok) {
    throw Object.assign(
      new Error(`Shopify fulfillment orders failed (${fulfillmentOrdersRes.status}).`),
      { code: "PROVIDER_ERROR" }
    );
  }

  const fulfillmentOrdersJson = (await fulfillmentOrdersRes.json()) as {
    fulfillment_orders?: ShopifyFulfillmentOrder[];
  };
  const payload = shopifyFulfillmentPayload({
    fulfillmentOrders: fulfillmentOrdersJson.fulfillment_orders ?? [],
    trackingNumber: tracking,
    trackingUrl,
  });

  if (!payload.fulfillment.line_items_by_fulfillment_order.length) {
    const updated = await updateExistingShopifyTracking(shop, token, sourceOrderId, tracking, trackingUrl);
    await markOrderFulfilled(supabase, order.id);
    await tagShopifyOrderStage(shop, token, sourceOrderId, "booked").catch(() => null);
    return updated
      ? { skipped: false, fulfilled: true }
      : { skipped: true, reason: "no_open_fulfillment_orders", fulfilled: true };
  }

  const createRes = await shopifyRequest(shop, token, "/fulfillments.json", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  if (!createRes.ok) {
    const body = await createRes.text();
    if (createRes.status === 422 && /already fulfilled|closed|no remaining/i.test(body)) {
      const updated = await updateExistingShopifyTracking(shop, token, sourceOrderId, tracking, trackingUrl);
      await markOrderFulfilled(supabase, order.id);
      await tagShopifyOrderStage(shop, token, sourceOrderId, "booked").catch(() => null);
      return updated
        ? { skipped: false, fulfilled: true }
        : { skipped: true, reason: "already_fulfilled_remote", fulfilled: true };
    }
    throw Object.assign(new Error(`Shopify fulfillment failed (${createRes.status}).`), {
      code: "PROVIDER_ERROR",
    });
  }

  await markOrderFulfilled(supabase, order.id);
  await tagShopifyOrderStage(shop, token, sourceOrderId, "booked").catch(() => null);
  return { skipped: false, fulfilled: true };
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
  const orderStatus = nextShopifyOrderStatus({
    cancelledAt: input.remote.cancelled_at,
    fulfillmentStatus,
    currentStatus: existingOrder?.status,
  });
  const totals = {
    currency: input.remote.currency || "INR",
    subtotal: Number(input.remote.subtotal_price ?? 0),
    discount: Number(input.remote.total_discounts ?? 0),
    shipping_amount: Number(input.remote.total_shipping_price_set?.shop_money?.amount ?? 0),
    tax_amount: Number(input.remote.total_tax ?? 0),
    total_amount: Number(input.remote.total_price ?? 0),
    payment_status: paymentStatus,
    fulfillment_status: fulfillmentStatus,
    status: orderStatus,
  };

  if (existing?.order_id) {
    await supabase.from("orders").update(totals).eq("id", existing.order_id);
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
  const lineItems = (input.remote.line_items ?? []).filter((item) => Number(item.quantity ?? 0) > 0);
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
      return { imported: false, updated: true, skipped: false, orderId: byNumber.id as string };
    }
  }

  if (orderError || !order) {
    throw new Error(orderError?.message || "Could not save Shopify order.");
  }

  if (lineItems.length) {
    const { error: itemsError } = await supabase.from("order_line_items").insert(
      lineItems.map((item) => ({
        organization_id: input.organizationId,
        order_id: order.id,
        title: String(item.title ?? "Item"),
        sku: item.sku ? String(item.sku) : null,
        quantity: Number(item.quantity ?? 1),
        unit_price: Number(item.price ?? 0),
        weight_grams: Number(item.grams ?? 0) || null,
      }))
    );
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
        { enqueueBooking: input.enqueueBooking !== false }
      );
    } catch {
      // Order import should still succeed if shipment automation fails.
    }
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
  const alreadyAdvanced = ["PROCESSING", "BOOKED", "SHIPPED", "IN_TRANSIT", "DELIVERED", "CANCELLED"].includes(
    current
  );
  if (alreadyAdvanced) {
    return { updated: false, skipped: true, orderId: order.id as string };
  }

  await supabase.from("orders").update({ status: "PROCESSING" }).eq("id", order.id);
  try {
    const { enqueueWatiNotify } = await import("@/modules/wati/send");
    await enqueueWatiNotify(supabase, input.organizationId, "processing", { orderId: order.id });
  } catch {
    // WhatsApp is optional; Shopify progress should still persist.
  }

  return { updated: true, skipped: false, orderId: order.id as string };
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
  return upsertShopifyOrder(supabase, {
    organizationId: input.organizationId,
    shopDomain: input.shopDomain,
    remote: input.remote,
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
    throw new Error(`Shopify orders fetch failed (${response.status}).`);
  }
  const json = (await response.json()) as { orders?: ShopifyRemoteOrder[] };
  return {
    orders: json.orders ?? [],
    nextPage: nextPageInfo(response.headers.get("link")),
  };
}

export async function syncUnfulfilledShopifyOrders(
  supabase: SupabaseClient,
  input: { organizationId: string; userId?: string; maxPages?: number }
): Promise<ShopifySyncResult> {
  const connection = await loadShopifyConnection(supabase, input.organizationId);
  if (!shopifyReadyToSync(connection)) {
    return { imported: 0, updated: 0, skipped: 0, hasMore: false, connected: false };
  }
  const token = await resolveShopifyAdminToken(connection);
  if (!token || !connection?.shop_domain) {
    if (connection?.id) {
      await supabase
        .from("shopify_connections")
        .update({ last_error: "Could not authenticate with Shopify. Check Client ID and secret." })
        .eq("id", connection.id);
    }
    return { imported: 0, updated: 0, skipped: 0, hasMore: false, connected: false };
  }

  await markShopifyConnected(supabase, connection);
  try {
    await registerShopifyOrderWebhooks(connection.shop_domain, token);
  } catch {
    // Polling on /dashboard/orders still imports when webhook registration is blocked.
  }

  const automation = await shopifyOrderAutomation(supabase, input.organizationId);

  const result: ShopifySyncResult = {
    imported: 0,
    updated: 0,
    skipped: 0,
    hasMore: false,
    connected: true,
  };
  let pageInfo: string | null = null;
  const maxPages = input.maxPages ?? 20;
  for (let page = 0; page < maxPages; page += 1) {
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
    if (!pageInfo) break;
    if (page === maxPages - 1) result.hasMore = true;
  }

  if (connection.id) {
    await supabase
      .from("shopify_connections")
      .update({ last_sync_at: new Date().toISOString(), last_error: null })
      .eq("id", connection.id);
  }
  return result;
}
