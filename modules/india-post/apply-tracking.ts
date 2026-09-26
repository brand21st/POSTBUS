import type { SupabaseClient } from "@supabase/supabase-js";
import { mapIndiaPostEventToShipmentUpdate, planTrackingUpdate } from "@/modules/india-post/event-mapper";

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
};

export type BulkTrackingArticle = {
  booking_details?: { article_number?: string };
  tracking_details?: Array<{
    event?: string;
    office?: string;
    date?: string;
    time?: string;
    event_code?: string;
  }>;
  del_status?: { del_status?: string };
};

type TrackingEventInput = {
  eventCode: string;
  eventDescription: string | null;
  officeName: string | null;
  officeId: string | null;
  occurredAt: string;
  raw: Record<string, unknown>;
  nonDeliveryReason: string | null;
};

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
  if (event.date && event.time) {
    const combined = `${event.date}T${event.time}`;
    const parsed = new Date(combined);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  if (event.date) {
    const parsed = new Date(event.date);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return new Date().toISOString();
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
    eventDescription: event.eventDescription,
    nonDeliveryReason: event.nonDeliveryReason,
  });
  const { error: eventError } = await supabase.from("tracking_events").insert({
    organization_id: snapshot.organizationId,
    shipment_id: snapshot.id,
    event_code: mapped.eventCode,
    event_description: mapped.eventDescription,
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
    patch.last_event_description = mapped.eventDescription;
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
  };
}

export async function ingestBulkTrackingArticle(
  supabase: SupabaseClient,
  input: {
    organizationId: string;
    shipment: ShipmentTrackingSnapshot;
    article: BulkTrackingArticle;
  }
) {
  const details = [...(input.article.tracking_details ?? [])].sort((left, right) => {
    return bulkEventOccurredAt(left).localeCompare(bulkEventOccurredAt(right));
  });
  let snapshot = input.shipment;
  let orderStatus: "IN_TRANSIT" | "DELIVERED" | null = null;

  for (const event of details) {
    const result = await applyIndiaPostTracking(supabase, snapshot, {
      eventCode: event.event_code || event.event || "EVENT",
      eventDescription: event.event ?? null,
      officeName: event.office ?? null,
      officeId: null,
      occurredAt: bulkEventOccurredAt(event),
      raw: event as Record<string, unknown>,
      nonDeliveryReason: null,
    });
    snapshot = result.snapshot;
    if (result.orderStatus) orderStatus = result.orderStatus;
  }

  const deliveredFlag = input.article.del_status?.del_status?.toLowerCase() === "delivered";
  const returnish = isReturnOperational(snapshot.operationalStatus) || snapshot.status === "RTO";
  if (deliveredFlag && !returnish && snapshot.operationalStatus !== "DELIVERED" && snapshot.status !== "DELIVERED") {
    const result = await applyIndiaPostTracking(supabase, snapshot, {
      eventCode: "ITEM_DELIVERED",
      eventDescription: "Delivered",
      officeName: null,
      officeId: null,
      occurredAt: new Date().toISOString(),
      raw: { del_status: input.article.del_status ?? null },
      nonDeliveryReason: null,
    });
    snapshot = result.snapshot;
    if (result.orderStatus) orderStatus = result.orderStatus;
  } else if (!details.length) {
    await supabase
      .from("shipments")
      .update({ last_tracked_at: new Date().toISOString() })
      .eq("id", snapshot.id)
      .eq("organization_id", input.organizationId);
  }

  return { snapshot, orderStatus };
}
