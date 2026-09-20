import type { ShipmentStatus } from "@/types/domain";
import type { ParsedIndiaPostWebhook } from "@/modules/india-post/webhook-parser";

export type IndiaPostShipmentUpdate = {
  eventCode: string;
  eventDescription: string | null;
  shipmentStatus: ShipmentStatus | null;
  shouldUpdateStatus: boolean;
};

/**
 * CEPT documented a sample event_code of BAG_CLOSE only.
 * Portal labels (Item Booked, Item Delivered, …) are not confirmed API codes.
 * Unconfirmed codes are stored on the timeline and must not change shipment.status.
 */
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

export function mapIndiaPostEventToShipmentUpdate(
  event: Pick<ParsedIndiaPostWebhook, "eventCode" | "eventDescription">
): IndiaPostShipmentUpdate {
  const eventCode = event.eventCode || "EVENT";
  return {
    eventCode,
    eventDescription: event.eventDescription,
    shipmentStatus: null,
    shouldUpdateStatus: false,
  };
}

export function canAdvanceShipmentStatus(current: string, next: ShipmentStatus) {
  const currentRank = STATUS_RANK[current as ShipmentStatus] ?? 0;
  const nextRank = STATUS_RANK[next];
  return nextRank >= currentRank;
}
