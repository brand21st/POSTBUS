import { format, isValid, parseISO } from "date-fns";
import { classifyCustomerEvent } from "@/modules/tracking-pages/customer-track-view";
import { indiaPostServiceLabel } from "@/types/domain";
import type { PublicTrackingEvent, ShipmentRecord, TrackingEvent } from "@/types/api";

export const ROUTING_STAGES = [
  "BOOKED",
  "DISPATCHED",
  "IN_TRANSIT",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
] as const;

export type RoutingStage = (typeof ROUTING_STAGES)[number];

const STAGE_LABELS: Record<RoutingStage, string> = {
  BOOKED: "Booked",
  DISPATCHED: "Dispatched",
  IN_TRANSIT: "In Transit",
  OUT_FOR_DELIVERY: "Out for Delivery",
  DELIVERED: "Delivered",
};

export type RoutingStep = {
  id: string;
  title: string;
  office: string | null;
  occurredAt: string | null;
  dateLabel: string;
  timeLabel: string;
  latest: boolean;
};

export type RoutingStageView = {
  stage: RoutingStage;
  label: string;
  completed: boolean;
  current: boolean;
};

export type IndiaPostRoutingView = {
  articleNumber: string;
  articleType: string;
  bookedOffice: string | null;
  bookedOn: string | null;
  originPincode: string | null;
  destinationOffice: string | null;
  destinationPincode: string | null;
  currentEvent: string | null;
  progressPercent: number;
  stages: RoutingStageView[];
  steps: RoutingStep[];
};

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function asPublicTrackingEvent(event: TrackingEvent): PublicTrackingEvent {
  return {
    id: event.id,
    eventCode: event.eventCode ?? event.event_code,
    eventDescription: event.eventDescription ?? event.event_description,
    officeName: event.officeName ?? event.office_name,
    occurredAt: event.occurredAt ?? event.occurred_at,
  };
}

function parseWhen(value: string | null | undefined) {
  if (!value) return null;
  const date = parseISO(value);
  return isValid(date) ? date : null;
}

function formatRoutingDate(value: string | null | undefined) {
  const date = parseWhen(value);
  return date ? format(date, "dd/MM/yyyy") : "—";
}

function formatRoutingTime(value: string | null | undefined) {
  const date = parseWhen(value);
  return date ? format(date, "HH:mm:ss") : "";
}

function formatBookedOn(value: string | null | undefined) {
  const date = parseWhen(value);
  return date ? format(date, "dd/MM/yyyy, HH:mm:ss") : null;
}

function dashboardStage(event: PublicTrackingEvent): RoutingStage | null {
  const { stage, status } = classifyCustomerEvent(event);
  if (stage === "ACCEPTED" || stage === "BOOKED") return "BOOKED";
  if (stage && (ROUTING_STAGES as readonly string[]).includes(stage)) return stage;
  if (status === "BOOKED" || status === "ACCEPTED") return "BOOKED";
  return null;
}

function chronologicalEvents(events: TrackingEvent[]) {
  return [...events]
    .map(asPublicTrackingEvent)
    .sort((left, right) => {
      const a = Date.parse(left.occurredAt ?? "") || 0;
      const b = Date.parse(right.occurredAt ?? "") || 0;
      return a - b;
    });
}

function furthestStage(...stages: Array<RoutingStage | null | undefined>): RoutingStage {
  let max = -1;
  let result: RoutingStage = "BOOKED";
  for (const stage of stages) {
    if (!stage) continue;
    const index = ROUTING_STAGES.indexOf(stage);
    if (index > max) {
      max = index;
      result = stage;
    }
  }
  return result;
}

function stageFromStatus(status: string | null | undefined): RoutingStage | null {
  const key = (status ?? "").toUpperCase();
  if (key === "ACCEPTED" || key === "BOOKED") return "BOOKED";
  if (key === "SHIPPED") return "IN_TRANSIT";
  if ((ROUTING_STAGES as readonly string[]).includes(key)) return key as RoutingStage;
  return null;
}

function lastScanAsEvent(
  shipment: Pick<
    ShipmentRecord,
    | "lastEventCode"
    | "last_event_code"
    | "lastEventDescription"
    | "last_event_description"
    | "lastScanOffice"
    | "last_scan_office"
    | "lastEventAt"
    | "last_event_at"
  >
): TrackingEvent | null {
  const eventCode = text(shipment.lastEventCode) ?? text(shipment.last_event_code);
  const eventDescription = text(shipment.lastEventDescription) ?? text(shipment.last_event_description);
  if (!eventCode && !eventDescription) return null;
  return {
    id: "last-scan",
    eventCode,
    eventDescription,
    officeName: text(shipment.lastScanOffice) ?? text(shipment.last_scan_office),
    occurredAt: text(shipment.lastEventAt) ?? text(shipment.last_event_at),
  };
}

export function buildIndiaPostRoutingView(
  shipment: Pick<
    ShipmentRecord,
    | "barcode"
    | "trackingNumber"
    | "tracking_number"
    | "serviceCode"
    | "service_code"
    | "bookedAt"
    | "booked_at"
    | "originCity"
    | "shippingCity"
    | "shippingPincode"
    | "operationalStatus"
    | "operational_status"
    | "status"
    | "lastEventCode"
    | "last_event_code"
    | "lastEventDescription"
    | "last_event_description"
    | "lastScanOffice"
    | "last_scan_office"
    | "lastEventAt"
    | "last_event_at"
  >,
  events: TrackingEvent[]
): IndiaPostRoutingView {
  const fallback = lastScanAsEvent(shipment);
  const ordered = chronologicalEvents(events.length > 0 ? events : fallback ? [fallback] : []);
  const occurred = new Map<RoutingStage, string | null>();
  for (const event of ordered) {
    const stage = dashboardStage(event);
    if (!stage || occurred.has(stage)) continue;
    occurred.set(stage, event.occurredAt ?? null);
  }
  const eventStages = ROUTING_STAGES.filter((stage) => occurred.has(stage));
  const status = text(shipment.operationalStatus) ?? text(shipment.operational_status) ?? text(shipment.status);
  const bookedAt = text(shipment.bookedAt) ?? text(shipment.booked_at) ?? ordered[0]?.occurredAt ?? null;
  const current = furthestStage(
    stageFromStatus(status),
    eventStages.at(-1),
    bookedAt ? "BOOKED" : null
  );
  const currentIndex = ROUTING_STAGES.indexOf(current);
  const latest = ordered.at(-1) ?? null;
  const first = ordered[0] ?? null;
  const delivered = current === "DELIVERED";

  return {
    articleNumber: text(shipment.trackingNumber) ?? text(shipment.tracking_number) ?? text(shipment.barcode) ?? "—",
    articleType:
      text(shipment.serviceCode) ?? text(shipment.service_code) ?? indiaPostServiceLabel(shipment.serviceCode ?? shipment.service_code),
    bookedOffice: text(first?.officeName) ?? text(shipment.originCity),
    bookedOn: formatBookedOn(bookedAt),
    originPincode: null,
    destinationOffice: text(shipment.shippingCity),
    destinationPincode: text(shipment.shippingPincode),
    currentEvent: text(latest?.eventDescription) ?? text(latest?.eventCode),
    progressPercent: delivered ? 100 : Math.max(0, (currentIndex / (ROUTING_STAGES.length - 1)) * 100),
    stages: ROUTING_STAGES.map((stage, index) => ({
      stage,
      label: STAGE_LABELS[stage],
      completed: index < currentIndex || delivered,
      current: !delivered && stage === current,
    })),
    steps: ordered.map((event, index) => ({
      id: event.id ?? `${event.eventCode}-${event.occurredAt}-${index}`,
      title: text(event.eventDescription) ?? text(event.eventCode) ?? "Scan event",
      office: text(event.officeName),
      occurredAt: event.occurredAt ?? null,
      dateLabel: formatRoutingDate(event.occurredAt),
      timeLabel: formatRoutingTime(event.occurredAt),
      latest: index === ordered.length - 1,
    })),
  };
}
