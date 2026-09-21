import type { ShipmentStatus } from "@/types/domain";
import type { ParsedIndiaPostWebhook } from "@/modules/india-post/webhook-parser";

export type IndiaPostShipmentUpdate = {
  eventCode: string;
  eventDescription: string | null;
  shipmentStatus: ShipmentStatus | null;
  shouldUpdateStatus: boolean;
};

const STATUS_RANK: Record<ShipmentStatus, number> = {
  DRAFT: 10,
  VALIDATING: 20,
  QUEUED: 30,
  BOOKING: 40,
  BOOKED: 50,
  LABEL_PENDING: 55,
  LABEL_READY: 60,
  MANIFEST_PENDING: 65,
  MANIFEST_READY: 70,
  IN_TRANSIT: 80,
  OUT_FOR_DELIVERY: 90,
  FAILED: 95,
  CANCELLED: 100,
  RTO: 100,
  DELIVERED: 110,
};

function eventKey(event: { eventCode?: string | null; eventDescription?: string | null }) {
  return `${event.eventCode ?? ""} ${event.eventDescription ?? ""}`.toLowerCase().replace(/[\s-]+/g, "_");
}

export function mapIndiaPostEventToShipmentUpdate(
  event: Pick<ParsedIndiaPostWebhook, "eventCode" | "eventDescription">
): IndiaPostShipmentUpdate {
  const eventCode = event.eventCode || "EVENT";
  const key = eventKey(event);
  const delivered = key.includes("delivered") || key.includes("item_delivered");
  const inTransit =
    key.includes("bag_close") ||
    key.includes("dispatch") ||
    key.includes("in_transit") ||
    key.includes("item_received") ||
    key.includes("out_for_delivery") ||
    key.includes("ofd");

  return {
    eventCode,
    eventDescription: event.eventDescription,
    shipmentStatus: delivered ? "DELIVERED" : inTransit ? "IN_TRANSIT" : null,
    shouldUpdateStatus: delivered || inTransit,
  };
}

export function canAdvanceShipmentStatus(current: string, next: ShipmentStatus) {
  const currentRank = STATUS_RANK[current as ShipmentStatus] ?? 0;
  const nextRank = STATUS_RANK[next];
  return nextRank >= currentRank;
}
