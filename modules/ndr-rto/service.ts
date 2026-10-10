import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { orIlike } from "@/lib/api/filters";
import type { TenantContext } from "@/lib/api/context";
import {
  ingestBulkTrackingArticle,
  matchingBulkTrackingArticle,
  snapshotFromShipmentRow,
  type BulkTrackingArticle,
} from "@/modules/india-post/apply-tracking";
import { enqueueTrackingStageSideEffects } from "@/modules/india-post/tracking-effects";
import { applyBulkTrackingOutcomes } from "@/modules/india-post/tracking-ingest-page";
import {
  isTrackingP0CanaryAwb,
  isTrackingP0CanaryOrganization,
  trackingP0CanaryActive,
  trackingP0CanarySideEffectsEnabled,
} from "@/modules/india-post/tracking-p0-canary";
import type { TrackShipmentResult } from "@/modules/india-post/tracking-bulk";
import type { NdrListQuery } from "@/modules/ndr-rto/schema";
import { NDR_VISIBLE_SYNC_MAX } from "@/modules/ndr-rto/schema";
import type { NdrSummary } from "@/types/api";

export const NDR_LIST_STATUSES = [
  "BOOKED",
  "LABEL_PENDING",
  "LABEL_READY",
  "MANIFEST_PENDING",
  "MANIFEST_READY",
  "IN_TRANSIT",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
  "FAILED",
  "NDR",
  "RTO",
] as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function istDayBounds(now = new Date()) {
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const start = new Date(`${day}T00:00:00+05:30`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { day, start: start.toISOString(), end: end.toISOString() };
}

function istInstant(day: string, endOfDay = false) {
  return new Date(`${day}T${endOfDay ? "23:59:59.999" : "00:00:00"}+05:30`).toISOString();
}

function emptyPage(query: NdrListQuery) {
  return { items: [], page: query.page, pageSize: query.pageSize, total: 0 };
}

function tracked(supabase: SupabaseClient, organizationId: string) {
  return supabase
    .from("shipments")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .not("barcode", "is", null)
    .in("status", [...NDR_LIST_STATUSES]);
}

async function countOperational(
  supabase: SupabaseClient,
  organizationId: string,
  operationalStatus: string,
  deliveredToday = false
) {
  let query = tracked(supabase, organizationId).eq("operational_status", operationalStatus);
  if (deliveredToday) {
    const bounds = istDayBounds();
    query = query.gte("delivered_at", bounds.start).lt("delivered_at", bounds.end);
  }
  const { count, error } = await query;
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  return count ?? 0;
}

async function countUnclassifiedTracked(supabase: SupabaseClient, organizationId: string) {
  const { count, error } = await tracked(supabase, organizationId).is("operational_status", null);
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  return count ?? 0;
}

export async function getNdrSummary(supabase: SupabaseClient, ctx: TenantContext): Promise<NdrSummary> {
  const [delivered, outForDelivery, deliveredToday, ndr, rto, rtoInTransit, rtoDelivered, unclassifiedTracked] =
    await Promise.all([
      countOperational(supabase, ctx.organizationId, "DELIVERED"),
      countOperational(supabase, ctx.organizationId, "OUT_FOR_DELIVERY"),
      countOperational(supabase, ctx.organizationId, "DELIVERED", true),
      countOperational(supabase, ctx.organizationId, "NDR"),
      countOperational(supabase, ctx.organizationId, "RTO"),
      countOperational(supabase, ctx.organizationId, "RTO_IN_TRANSIT"),
      countOperational(supabase, ctx.organizationId, "RTO_DELIVERED"),
      countUnclassifiedTracked(supabase, ctx.organizationId),
    ]);
  return { delivered, outForDelivery, deliveredToday, ndr, rto, rtoInTransit, rtoDelivered, unclassifiedTracked };
}

async function matchingIds(
  supabase: SupabaseClient,
  table: "customers" | "orders" | "addresses",
  organizationId: string,
  filter: string | null
) {
  if (!filter) return [];
  const { data, error } = await supabase
    .from(table)
    .select("id")
    .eq("organization_id", organizationId)
    .or(filter)
    .limit(200);
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  return (data ?? []).map((row) => String(row.id));
}

function nestedOne<T extends Record<string, unknown>>(value: unknown): T | null {
  if (!value) return null;
  if (Array.isArray(value)) return (value[0] as T | undefined) ?? null;
  if (typeof value === "object") return value as T;
  return null;
}

type LatestTrackingEvent = {
  shipment_id: string;
  event_code: string | null;
  event_description: string | null;
  office_name: string | null;
  occurred_at: string | null;
  classification: string | null;
};

function stringField(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

async function latestTrackingByShipment(
  supabase: SupabaseClient,
  organizationId: string,
  shipmentIds: string[]
) {
  const latest = new Map<string, LatestTrackingEvent>();
  if (!shipmentIds.length) return latest;
  const { data, error } = await supabase
    .from("tracking_events")
    .select("shipment_id, event_code, event_description, office_name, occurred_at, classification")
    .eq("organization_id", organizationId)
    .in("shipment_id", shipmentIds)
    .order("occurred_at", { ascending: false });
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  for (const row of (data ?? []) as LatestTrackingEvent[]) {
    const id = String(row.shipment_id ?? "");
    if (!id || latest.has(id)) continue;
    latest.set(id, row);
  }
  return latest;
}

function withLatestTracking(
  row: ReturnType<typeof mapNdrRow>,
  event: LatestTrackingEvent | undefined
) {
  if (!event) return row;
  return {
    ...row,
    lastEventCode: stringField(row.lastEventCode) ?? stringField(event.event_code),
    last_event_code: stringField(row.lastEventCode) ?? stringField(event.event_code),
    lastEventDescription: stringField(row.lastEventDescription) ?? stringField(event.event_description),
    last_event_description: stringField(row.lastEventDescription) ?? stringField(event.event_description),
    lastScanOffice: stringField(row.lastScanOffice) ?? stringField(event.office_name),
    last_scan_office: stringField(row.lastScanOffice) ?? stringField(event.office_name),
    lastEventAt: stringField(row.lastEventAt) ?? stringField(event.occurred_at),
    last_event_at: stringField(row.lastEventAt) ?? stringField(event.occurred_at),
  };
}

function mapNdrRow(row: Record<string, unknown>) {
  const order = nestedOne<{
    order_number?: string;
    total_amount?: number | string;
    created_at?: string;
    source_order_id?: string | null;
  }>(row.orders);
  const customer = nestedOne<{ name?: string; phone?: string }>(row.customers);
  const address = nestedOne<{ city?: string; pincode?: string }>(row.addresses);
  const pickup = nestedOne<{ city?: string }>(row.pickup_locations);
  return {
    ...row,
    orderId: row.order_id,
    orderNumber: order?.order_number,
    order_number: order?.order_number,
    sourceOrderId: order?.source_order_id ?? null,
    orderTotal: order?.total_amount ?? null,
    orderCreatedAt: order?.created_at ?? null,
    customer,
    shippingCity: address?.city ?? null,
    shippingPincode: address?.pincode ?? null,
    originCity: pickup?.city ?? null,
    trackingNumber: row.tracking_number,
    operationalStatus: row.operational_status,
    lastEventCode: row.last_event_code,
    lastEventDescription: row.last_event_description,
    lastScanOffice: row.last_scan_office,
    lastEventAt: row.last_event_at,
    lastTrackedAt: row.last_tracked_at,
    ndrReason: row.ndr_reason,
    ndrAttemptCount: row.ndr_attempt_count,
    rtoReason: row.rto_reason,
    rtoInitiatedAt: row.rto_initiated_at,
    deliveredAt: row.delivered_at,
  };
}

export async function listNdrShipments(supabase: SupabaseClient, ctx: TenantContext, query: NdrListQuery) {
  const organizationId = ctx.organizationId;
  let customerIds: string[] | null = null;
  if (query.customer) {
    customerIds = await matchingIds(
      supabase,
      "customers",
      organizationId,
      orIlike(["name", "phone"], query.customer)
    );
    if (!customerIds.length) return emptyPage(query);
  }

  let pincodeAddressIds: string[] | null = null;
  if (query.pincode) {
    pincodeAddressIds = await matchingIds(
      supabase,
      "addresses",
      organizationId,
      orIlike(["pincode"], query.pincode)
    );
    if (!pincodeAddressIds.length) return emptyPage(query);
  }

  let orderIds: string[] | null = null;
  if (query.orderId && !UUID_RE.test(query.orderId)) {
    orderIds = await matchingIds(
      supabase,
      "orders",
      organizationId,
      orIlike(["order_number", "source_order_id"], query.orderId)
    );
    if (!orderIds.length) return emptyPage(query);
  }

  const from = (query.page - 1) * query.pageSize;
  const to = from + query.pageSize - 1;
  let builder = supabase
    .from("shipments")
    .select(
      "*, orders(order_number, total_amount, created_at, source_order_id), customers(name, phone), addresses!shipping_address_id(city, pincode), pickup_locations(city)",
      { count: "exact" }
    )
    .eq("organization_id", organizationId)
    .not("barcode", "is", null)
    .in("status", [...NDR_LIST_STATUSES])
    .order("last_event_at", { ascending: false, nullsFirst: false })
    .range(from, to);

  if (query.bucket === "DELIVERED_TODAY") {
    const bounds = istDayBounds();
    builder = builder
      .eq("operational_status", "DELIVERED")
      .gte("delivered_at", bounds.start)
      .lt("delivered_at", bounds.end);
  } else if (query.bucket) {
    builder = builder.eq("operational_status", query.bucket);
  }
  if (query.status) builder = builder.eq("status", query.status);
  if (query.event) {
    const eventFilter = orIlike(["last_event_code", "last_event_description"], query.event);
    if (eventFilter) builder = builder.or(eventFilter);
  }
  if (customerIds) builder = builder.in("customer_id", customerIds);
  if (pincodeAddressIds) builder = builder.in("shipping_address_id", pincodeAddressIds);
  if (query.orderId && UUID_RE.test(query.orderId)) builder = builder.eq("order_id", query.orderId);
  if (orderIds) builder = builder.in("order_id", orderIds);
  if (query.trackingId) {
    const tracking = orIlike(["barcode", "tracking_number"], query.trackingId);
    if (tracking) builder = builder.or(tracking);
  }
  if (query.from) builder = builder.gte("last_event_at", istInstant(query.from));
  if (query.to) builder = builder.lte("last_event_at", istInstant(query.to, true));
  if (query.q) {
    const parts = [orIlike(["barcode", "tracking_number"], query.q)].filter(Boolean) as string[];
    const [matchedCustomers, matchedOrders] = await Promise.all([
      matchingIds(supabase, "customers", organizationId, orIlike(["name", "phone"], query.q)),
      matchingIds(supabase, "orders", organizationId, orIlike(["order_number", "source_order_id"], query.q)),
    ]);
    if (matchedCustomers.length) parts.push(matchedCustomers.map((id) => `customer_id.eq.${id}`).join(","));
    if (matchedOrders.length) parts.push(matchedOrders.map((id) => `order_id.eq.${id}`).join(","));
    if (UUID_RE.test(query.q)) parts.push(`id.eq.${query.q}`);
    if (!parts.length) return emptyPage(query);
    builder = builder.or(parts.join(","));
  }

  const { data, error, count } = await builder;
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  const mapped = (data ?? []).map((row) => mapNdrRow(row as Record<string, unknown>));
  const latest = await latestTrackingByShipment(
    supabase,
    organizationId,
    mapped.map((row) => String(row.id))
  );
  return {
    items: mapped.map((row) => withLatestTracking(row, latest.get(String(row.id)))),
    page: query.page,
    pageSize: query.pageSize,
    total: count ?? 0,
  };
}

export async function syncNdrShipment(supabase: SupabaseClient, ctx: TenantContext, shipmentId: string) {
  const { data, error } = await supabase
    .from("shipments")
    .select(
      "id, barcode, status, order_id, operational_status, last_event_at, ndr_attempt_count, rto_initiated_at, organization_id"
    )
    .eq("organization_id", ctx.organizationId)
    .eq("id", shipmentId)
    .maybeSingle();
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  if (!data) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Shipment not found.");
  if (!data.barcode) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "This shipment has no India Post tracking ID.");
  }

  const { data: connection, error: connectionError } = await supabase
    .from("india_post_connections")
    .select("*")
    .eq("organization_id", ctx.organizationId)
    .maybeSingle();
  if (connectionError) throw new AppError(ERROR_CODES.VALIDATION_ERROR, connectionError.message);

  if (!connection) {
    throw new AppError(ERROR_CODES.INTEGRATION_NOT_CONNECTED, "India Post is not connected.");
  }
  if (trackingP0CanaryActive() && isTrackingP0CanaryOrganization(ctx.organizationId) && !isTrackingP0CanaryAwb(ctx.organizationId, data.barcode)) {
    throw new AppError(
      ERROR_CODES.VALIDATION_ERROR,
      "This shipment is outside the tracking canary allowlist."
    );
  }

  const { ensurePersistedIndiaPostTrackingSession } = await import("@/modules/india-post/session");
  const provider = await ensurePersistedIndiaPostTrackingSession(supabase, connection);
  const useP0 = isTrackingP0CanaryAwb(ctx.organizationId, data.barcode);
  let payload: TrackShipmentResult | { data?: BulkTrackingArticle[] };
  try {
    payload = await provider.trackShipment([data.barcode], { isolateFailures: useP0 });
  } catch (caught) {
    if (caught instanceof AppError) throw caught;
    const message = caught instanceof Error ? caught.message : "Tracking lookup failed.";
    throw new AppError(ERROR_CODES.PROVIDER_ERROR, message);
  }

  if (useP0) {
    const applied = await applyBulkTrackingOutcomes(supabase, {
      organizationId: ctx.organizationId,
      shipments: [data],
      outcomes: "outcomes" in payload ? payload.outcomes ?? [] : [],
      articles: payload.data,
      skipSideEffects: !trackingP0CanarySideEffectsEnabled(),
    });
    if (applied.rejected && !applied.ingested && !applied.absent) {
      throw new AppError(ERROR_CODES.PROVIDER_ERROR, "India Post rejected tracking lookup for this shipment.");
    }
    const { data: next } = await supabase
      .from("shipments")
      .select("status, operational_status, last_tracked_at")
      .eq("id", data.id)
      .eq("organization_id", ctx.organizationId)
      .maybeSingle();
    return {
      shipmentId: data.id,
      lastTrackedAt: next?.last_tracked_at ?? null,
      status: next?.status ?? data.status,
      operationalStatus: next?.operational_status ?? data.operational_status,
    };
  }

  const article = matchingBulkTrackingArticle(payload.data, data.barcode);
  const trackedAt = new Date().toISOString();
  if (!article) {
    await supabase
      .from("shipments")
      .update({ last_tracked_at: trackedAt })
      .eq("id", data.id)
      .eq("organization_id", ctx.organizationId);
    return {
      shipmentId: data.id,
      lastTrackedAt: trackedAt,
      status: data.status,
      operationalStatus: data.operational_status,
    };
  }

  const ingested = await ingestBulkTrackingArticle(supabase, {
    organizationId: ctx.organizationId,
    shipment: snapshotFromShipmentRow(data, ctx.organizationId),
    article,
    source: "bulk",
  });
  if (ingested.whatsappEvents.length || ingested.orderStatus) {
    await enqueueTrackingStageSideEffects(supabase, {
      organizationId: ctx.organizationId,
      shipmentId: data.id,
      orderId: data.order_id,
      orderStatus: ingested.orderStatus,
      events: ingested.whatsappEvents,
    });
  }
  return {
    shipmentId: data.id,
    lastTrackedAt: trackedAt,
    status: ingested.snapshot.status,
    operationalStatus: ingested.snapshot.operationalStatus,
  };
}

type NdrSyncShipment = {
  id: string;
  barcode: string | null;
  status: string | null;
  order_id: string | null;
  operational_status: string | null;
  last_event_at: string | null;
  ndr_attempt_count: number | null;
  rto_initiated_at: string | null;
  organization_id: string;
};

async function applyTrackedShipment(
  supabase: SupabaseClient,
  ctx: TenantContext,
  data: NdrSyncShipment,
  article: BulkTrackingArticle | null,
  trackedAt: string
) {
  if (!article) {
    await supabase
      .from("shipments")
      .update({ last_tracked_at: trackedAt })
      .eq("id", data.id)
      .eq("organization_id", ctx.organizationId);
    return {
      shipmentId: data.id,
      barcode: data.barcode,
      lastTrackedAt: trackedAt,
      matched: false,
      status: data.status,
      operationalStatus: data.operational_status,
    };
  }

  const ingested = await ingestBulkTrackingArticle(supabase, {
    organizationId: ctx.organizationId,
    shipment: snapshotFromShipmentRow(data, ctx.organizationId),
    article,
    source: "bulk",
  });
  if (ingested.whatsappEvents.length || ingested.orderStatus) {
    await enqueueTrackingStageSideEffects(supabase, {
      organizationId: ctx.organizationId,
      shipmentId: data.id,
      orderId: data.order_id,
      orderStatus: ingested.orderStatus,
      events: ingested.whatsappEvents,
    });
  }
  return {
    shipmentId: data.id,
    barcode: data.barcode,
    lastTrackedAt: trackedAt,
    matched: true,
    status: ingested.snapshot.status,
    operationalStatus: ingested.snapshot.operationalStatus,
  };
}

export async function syncNdrVisibleShipments(
  supabase: SupabaseClient,
  ctx: TenantContext,
  shipmentIds: string[]
) {
  const ids = [...new Set(shipmentIds)].slice(0, NDR_VISIBLE_SYNC_MAX);
  const { data, error } = await supabase
    .from("shipments")
    .select(
      "id, barcode, status, order_id, operational_status, last_event_at, ndr_attempt_count, rto_initiated_at, organization_id"
    )
    .eq("organization_id", ctx.organizationId)
    .in("id", ids)
    .not("barcode", "is", null);
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);

  let shipments = ((data ?? []) as NdrSyncShipment[]).filter((row) => Boolean(row.barcode));
  if (
    trackingP0CanaryActive() &&
    isTrackingP0CanaryOrganization(ctx.organizationId)
  ) {
    shipments = shipments.filter((row) => isTrackingP0CanaryAwb(ctx.organizationId, String(row.barcode)));
  }
  if (!shipments.length) {
    throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "No India Post shipments found to track.");
  }

  const { data: connection, error: connectionError } = await supabase
    .from("india_post_connections")
    .select("*")
    .eq("organization_id", ctx.organizationId)
    .maybeSingle();
  if (connectionError) throw new AppError(ERROR_CODES.VALIDATION_ERROR, connectionError.message);
  if (!connection) {
    throw new AppError(ERROR_CODES.INTEGRATION_NOT_CONNECTED, "India Post is not connected.");
  }

  const { ensurePersistedIndiaPostTrackingSession } = await import("@/modules/india-post/session");
  const provider = await ensurePersistedIndiaPostTrackingSession(supabase, connection);
  const barcodes = shipments.map((row) => String(row.barcode));
  const isolateFailures = barcodes.some((barcode) => isTrackingP0CanaryAwb(ctx.organizationId, barcode));
  let payload: TrackShipmentResult | { data?: BulkTrackingArticle[] };
  try {
    payload = await provider.trackShipment(barcodes, { isolateFailures });
  } catch (caught) {
    if (caught instanceof AppError) throw caught;
    const message = caught instanceof Error ? caught.message : "Tracking lookup failed.";
    throw new AppError(ERROR_CODES.PROVIDER_ERROR, message);
  }

  const trackedAt = new Date().toISOString();
  const results = [];
  for (const shipment of shipments) {
    const useP0 = isTrackingP0CanaryAwb(ctx.organizationId, String(shipment.barcode));
    if (useP0) {
      const applied = await applyBulkTrackingOutcomes(supabase, {
        organizationId: ctx.organizationId,
        shipments: [shipment],
        outcomes: "outcomes" in payload ? payload.outcomes ?? [] : [],
        articles: payload.data,
        skipSideEffects: !trackingP0CanarySideEffectsEnabled(),
      });
      results.push({
        shipmentId: shipment.id,
        barcode: shipment.barcode,
        lastTrackedAt: trackedAt,
        matched: Boolean(applied.ingested),
        status: shipment.status,
        operationalStatus: shipment.operational_status,
      });
      continue;
    }
    const article = matchingBulkTrackingArticle(payload.data, String(shipment.barcode));
    results.push(await applyTrackedShipment(supabase, ctx, shipment, article, trackedAt));
  }
  return {
    tracked: results.length,
    matched: results.filter((row) => row.matched).length,
    results,
  };
}
