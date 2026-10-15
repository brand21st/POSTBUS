import type { SupabaseClient } from "@supabase/supabase-js";
import { logInfo } from "@/lib/logger";
import { mapIndiaPostEventToShipmentUpdate, planTrackingUpdate, type TrackingWhatsAppEvent } from "@/modules/india-post/event-mapper";

export const TRACKING_POLL_STATUSES = [
  "BOOKED",
  "LABEL_READY",
  "MANIFEST_READY",
  "IN_TRANSIT",
  "OUT_FOR_DELIVERY",
  "NDR",
  "RTO",
] as const;

export type ShipmentTrackingSnapshot = {
  id: string;
  organizationId: string;
  orderId: string | null;
  status: string;
  operationalStatus: string | null;
  lastEventAt: string | null;
  ndrAttemptCount: number;
  rtoInitiatedAt: string | null;
};

export type ApplyTrackingResult = {
  inserted: boolean;
  duplicate: boolean;
  statusUpdated: boolean;
  orderStatus: "IN_TRANSIT" | "DELIVERED" | null;
  shipmentStatus: string | null;
  operationalStatus: string | null;
  snapshot: ShipmentTrackingSnapshot;
  whatsappEvents: TrackingWhatsAppEvent[];
};

export type BulkTrackingArticle = {
  booking_details?: { article_number?: string; delivery_confirmed_on?: string | null };
  tracking_details?: Array<{
    event?: string;
    office?: string;
    officeid?: string;
    date?: string;
    time?: string;
    event_code?: string;
    remarks?: string;
    rts?: boolean;
  }>;
  del_status?: { del_status?: string };
};

export type TrackingIngestSource = "bulk" | "webhook" | "public";

type TrackingEventInput = {
  eventCode: string;
  eventDescription: string | null;
  officeName: string | null;
  officeId: string | null;
  occurredAt: string;
  raw: Record<string, unknown>;
  nonDeliveryReason: string | null;
  rts?: boolean | null;
  mapText?: string | null;
};

export function trackingEventRaw(raw: Record<string, unknown>, source: TrackingIngestSource) {
  const meta =
    raw._meta && typeof raw._meta === "object" && !Array.isArray(raw._meta)
      ? (raw._meta as Record<string, unknown>)
      : {};
  return { ...raw, _meta: { ...meta, source } };
}

export function snapshotFromShipmentRow(
  row: {
    id: string;
    organization_id?: string | null;
    order_id?: string | null;
    status?: string | null;
    operational_status?: string | null;
    last_event_at?: string | null;
    ndr_attempt_count?: number | null;
    rto_initiated_at?: string | null;
  },
  organizationId?: string
): ShipmentTrackingSnapshot {
  return {
    id: row.id,
    organizationId: organizationId || row.organization_id || "",
    orderId: row.order_id ?? null,
    status: row.status || "BOOKED",
    operationalStatus: row.operational_status ?? null,
    lastEventAt: row.last_event_at ?? null,
    ndrAttemptCount: row.ndr_attempt_count ?? 0,
    rtoInitiatedAt: row.rto_initiated_at ?? null,
  };
}

export function bulkEventOccurredAt(event: { date?: string; time?: string }) {
  const date = String(event.date ?? "").trim();
  const time = String(event.time ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}T/.test(date)) {
    const parsed = new Date(date);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  if (date && time && !date.includes("T")) {
    const clock = /^\d{2}:\d{2}(:\d{2})?$/.test(time) ? (time.length === 5 ? `${time}:00` : time) : time;
    const parsed = new Date(`${date}T${clock}`);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  if (date) {
    const parsed = new Date(date);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return null;
}

export function isTrackingPollStatus(status: string) {
  return (TRACKING_POLL_STATUSES as readonly string[]).includes(status);
}

export function matchingBulkTrackingArticle(articles: BulkTrackingArticle[] | undefined, barcode: string) {
  const wanted = String(barcode ?? "").trim().toUpperCase();
  if (!wanted || !articles?.length) return null;
  const matched =
    articles.find((item) => {
      const number = String(
        item.booking_details?.article_number ?? (item as { article_number?: string }).article_number ?? ""
      )
        .trim()
        .toUpperCase();
      return Boolean(number) && number === wanted;
    }) ?? null;
  if (matched) return matched;
  if (articles.length !== 1) return null;
  const only = articles[0];
  const labeled = String(
    only?.booking_details?.article_number ?? (only as { article_number?: string } | undefined)?.article_number ?? ""
  ).trim();
  if (labeled) return null;
  return (only?.tracking_details?.length ?? 0) > 0 ? only ?? null : null;
}

function bulkEventDescription(event: { event?: string; remarks?: string }) {
  const text = String(event.event ?? "").trim();
  const remarks = String(event.remarks ?? "").trim();
  if (text && remarks) return `${text} — ${remarks}`;
  return text || remarks || null;
}

function latestArticleTimestamp(article: BulkTrackingArticle, fallback: string | null) {
  const times = (article.tracking_details ?? [])
    .map((event) => bulkEventOccurredAt(event))
    .filter((value): value is string => Boolean(value));
  const confirmed = article.booking_details?.delivery_confirmed_on;
  if (confirmed) {
    const parsed = new Date(confirmed);
    if (!Number.isNaN(parsed.getTime())) times.push(parsed.toISOString());
  }
  times.sort();
  return times.at(-1) ?? fallback;
}

function isReturnOperational(value: string | null) {
  return value === "RTO" || value === "RTO_IN_TRANSIT" || value === "RTO_DELIVERED";
}

export async function applyIndiaPostTracking(
  supabase: SupabaseClient,
  snapshot: ShipmentTrackingSnapshot,
  event: TrackingEventInput
): Promise<ApplyTrackingResult> {
  const mapped = mapIndiaPostEventToShipmentUpdate({
    eventCode: event.eventCode,
    eventDescription: event.mapText ?? event.eventDescription,
    nonDeliveryReason: event.nonDeliveryReason,
    rts: event.rts,
  });
  const storedDescription = event.eventDescription;
  const { error: eventError } = await supabase.from("tracking_events").insert({
    organization_id: snapshot.organizationId,
    shipment_id: snapshot.id,
    event_code: mapped.eventCode,
    event_description: storedDescription,
    office_name: event.officeName,
    office_id: event.officeId,
    occurred_at: event.occurredAt,
    raw: event.raw,
    classification: mapped.classification,
  });
  if (eventError && eventError.code !== "23505") {
    throw Object.assign(new Error(eventError.message), { code: "TEMPORARY_PROVIDER_FAILURE" });
  }

  const duplicate = eventError?.code === "23505";
  if (duplicate) {
    logInfo("india_post.tracking.duplicate_event", {
      organizationId: snapshot.organizationId,
      shipmentId: snapshot.id,
      eventCode: mapped.eventCode,
    });
  }
  const plan = planTrackingUpdate({
    currentStatus: snapshot.status,
    currentOperational: snapshot.operationalStatus,
    returnStarted: Boolean(snapshot.rtoInitiatedAt) || isReturnOperational(snapshot.operationalStatus),
    lastEventAt: snapshot.lastEventAt,
    eventAt: event.occurredAt,
    mapped,
  });

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { last_tracked_at: now };
  if (plan.updateLastScan) {
    patch.last_event_code = mapped.eventCode;
    patch.last_event_description = storedDescription;
    patch.last_scan_office = event.officeName;
    patch.last_event_at = event.occurredAt;
  }
  if (plan.applyStatus && plan.shipmentStatus && plan.operationalStatus) {
    patch.status = plan.shipmentStatus;
    patch.operational_status = plan.operationalStatus;
    if (plan.operationalStatus === "NDR" && !duplicate) {
      patch.ndr_reason = mapped.ndrReason;
      patch.ndr_last_attempt_at = event.occurredAt;
      patch.ndr_attempt_count = snapshot.ndrAttemptCount + 1;
    }
    if (isReturnOperational(plan.operationalStatus)) {
      patch.rto_reason = mapped.rtoReason;
      if (!snapshot.rtoInitiatedAt) patch.rto_initiated_at = event.occurredAt;
    }
    if (plan.operationalStatus === "DELIVERED") {
      patch.delivered_at = event.occurredAt;
    }
  }

  const { error: updateError } = await supabase
    .from("shipments")
    .update(patch)
    .eq("id", snapshot.id)
    .eq("organization_id", snapshot.organizationId);
  if (updateError) {
    throw Object.assign(new Error(updateError.message), { code: "TEMPORARY_PROVIDER_FAILURE" });
  }

  if (plan.applyStatus && plan.orderStatus && snapshot.orderId) {
    const { error: orderError } = await supabase
      .from("orders")
      .update({ status: plan.orderStatus })
      .eq("id", snapshot.orderId)
      .eq("organization_id", snapshot.organizationId);
    if (orderError) {
      throw Object.assign(new Error(orderError.message), { code: "TEMPORARY_PROVIDER_FAILURE" });
    }
  }

  const next: ShipmentTrackingSnapshot = {
    ...snapshot,
    status: plan.applyStatus && plan.shipmentStatus ? plan.shipmentStatus : snapshot.status,
    operationalStatus:
      plan.applyStatus && plan.operationalStatus ? plan.operationalStatus : snapshot.operationalStatus,
    lastEventAt: plan.updateLastScan ? event.occurredAt : snapshot.lastEventAt,
    ndrAttemptCount:
      plan.applyStatus && plan.operationalStatus === "NDR" && !duplicate
        ? snapshot.ndrAttemptCount + 1
        : snapshot.ndrAttemptCount,
    rtoInitiatedAt:
      plan.applyStatus && isReturnOperational(plan.operationalStatus) && !snapshot.rtoInitiatedAt
        ? event.occurredAt
        : snapshot.rtoInitiatedAt,
  };

  return {
    inserted: !duplicate,
    duplicate,
    statusUpdated: Boolean(plan.applyStatus),
    orderStatus: plan.applyStatus ? plan.orderStatus : null,
    shipmentStatus: next.status,
    operationalStatus: next.operationalStatus,
    snapshot: next,
    whatsappEvents: plan.whatsappEvents,
  };
}

export async function ingestBulkTrackingArticle(
  supabase: SupabaseClient,
  input: {
    organizationId: string;
    shipment: ShipmentTrackingSnapshot;
    article: BulkTrackingArticle;
    source?: TrackingIngestSource;
  }
) {
  const details = [...(input.article.tracking_details ?? [])].sort((left, right) => {
    const leftAt = bulkEventOccurredAt(left) ?? "";
    const rightAt = bulkEventOccurredAt(right) ?? "";
    const time = leftAt.localeCompare(rightAt);
    if (time !== 0) return time;
    return String(left.event_code ?? left.event ?? "").localeCompare(String(right.event_code ?? right.event ?? ""));
  });
  let snapshot = input.shipment;
  let orderStatus: "IN_TRANSIT" | "DELIVERED" | null = null;
  const whatsappEvents: TrackingWhatsAppEvent[] = [];

  for (const event of details) {
    const occurredAt = bulkEventOccurredAt(event);
    if (!occurredAt) {
      logInfo("india_post.tracking.missing_event_time", {
        organizationId: input.organizationId,
        shipmentId: snapshot.id,
        event: event.event ?? event.event_code ?? null,
      });
      continue;
    }
    const result = await applyIndiaPostTracking(supabase, snapshot, {
      eventCode: event.event_code || event.event || "EVENT",
      eventDescription: bulkEventDescription(event),
      officeName: event.office ?? null,
      officeId: event.officeid ? String(event.officeid) : null,
      occurredAt,
      raw: trackingEventRaw(event as Record<string, unknown>, input.source ?? "bulk"),
      nonDeliveryReason: null,
      rts: event.rts === true ? true : event.rts === false ? false : null,
      mapText: event.event ?? event.event_code ?? null,
    });
    snapshot = result.snapshot;
    if (result.orderStatus) orderStatus = result.orderStatus;
    for (const notify of result.whatsappEvents) {
      if (!whatsappEvents.includes(notify)) whatsappEvents.push(notify);
    }
  }

  const deliveredFlag = input.article.del_status?.del_status?.toLowerCase() === "delivered";
  const returnish = isReturnOperational(snapshot.operationalStatus) || snapshot.status === "RTO";
  const deliveredAt = latestArticleTimestamp(input.article, snapshot.lastEventAt);
  if (
    deliveredFlag &&
    deliveredAt &&
    !returnish &&
    snapshot.operationalStatus !== "DELIVERED" &&
    snapshot.status !== "DELIVERED"
  ) {
    const result = await applyIndiaPostTracking(supabase, snapshot, {
      eventCode: "ITEM_DELIVERED",
      eventDescription: "Delivered",
      officeName: null,
      officeId: null,
      occurredAt: deliveredAt,
      raw: trackingEventRaw({ del_status: input.article.del_status ?? null }, input.source ?? "bulk"),
      nonDeliveryReason: null,
    });
    snapshot = result.snapshot;
    if (result.orderStatus) orderStatus = result.orderStatus;
    for (const notify of result.whatsappEvents) {
      if (!whatsappEvents.includes(notify)) whatsappEvents.push(notify);
    }
  } else if (!details.length) {
    await supabase
      .from("shipments")
      .update({ last_tracked_at: new Date().toISOString() })
      .eq("id", snapshot.id)
      .eq("organization_id", input.organizationId);
  }

  return { snapshot, orderStatus, whatsappEvents };
}
