import type { OperationalStatus, ShipmentStatus } from "@/types/domain";

export type IndiaPostShipmentUpdate = {
  eventCode: string;
  eventDescription: string | null;
  shipmentStatus: ShipmentStatus | null;
  operationalStatus: OperationalStatus | null;
  classification: OperationalStatus | null;
  shouldUpdateStatus: boolean;
  ndrReason: string | null;
  rtoReason: string | null;
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
  NDR: 92,
  FAILED: 95,
  CANCELLED: 100,
  RTO: 100,
  DELIVERED: 110,
};

const BOOKING_PHASE = new Set<string>([
  "DRAFT",
  "VALIDATING",
  "QUEUED",
  "BOOKING",
  "BOOKED",
  "LABEL_PENDING",
  "LABEL_READY",
  "MANIFEST_PENDING",
  "MANIFEST_READY",
]);

const RETURN_OPERATIONAL = new Set<OperationalStatus>(["RTO", "RTO_IN_TRANSIT", "RTO_DELIVERED"]);

const ALREADY_MOVING = new Set(["IN_TRANSIT", "OUT_FOR_DELIVERY", "NDR", "RTO", "DELIVERED"]);

export type TrackingPlan = {
  updateLastScan: boolean;
  applyStatus: boolean;
  shipmentStatus: ShipmentStatus | null;
  operationalStatus: OperationalStatus | null;
  orderStatus: "IN_TRANSIT" | "DELIVERED" | null;
};

function eventKey(event: { eventCode?: string | null; eventDescription?: string | null }) {
  return `${event.eventCode ?? ""} ${event.eventDescription ?? ""}`.toLowerCase().replace(/[\s-]+/g, "_");
}

function hasPhrase(key: string, phrase: string) {
  return key.includes(phrase);
}

function hasToken(key: string, token: string) {
  return new RegExp(`(^|_)${token}($|_)`).test(key);
}

function classifyEvent(key: string, nonDeliveryReason: string | null): OperationalStatus | null {
  if (
    hasPhrase(key, "rto_delivered") ||
    hasPhrase(key, "delivered_to_sender") ||
    hasPhrase(key, "delivered_to_origin") ||
    hasPhrase(key, "return_delivered")
  ) {
    return "RTO_DELIVERED";
  }

  if (
    hasPhrase(key, "rto_in_transit") ||
    hasPhrase(key, "return_dispatched") ||
    hasPhrase(key, "return_in_transit") ||
    hasPhrase(key, "redirected_to_sender")
  ) {
    return "RTO_IN_TRANSIT";
  }

  if (
    hasToken(key, "rto") ||
    hasPhrase(key, "return_to_sender") ||
    hasPhrase(key, "returned_to_sender") ||
    hasPhrase(key, "return_to_origin") ||
    hasPhrase(key, "item_returned")
  ) {
    return "RTO";
  }

  if (
    nonDeliveryReason ||
    hasPhrase(key, "non_delivery") ||
    hasPhrase(key, "undelivered") ||
    hasPhrase(key, "delivery_attempted") ||
    hasPhrase(key, "delivery_attempt") ||
    hasPhrase(key, "not_delivered") ||
    hasPhrase(key, "addressee")
  ) {
    return "NDR";
  }

  if (hasPhrase(key, "out_for_delivery") || hasToken(key, "ofd")) {
    return "OUT_FOR_DELIVERY";
  }

  if (hasPhrase(key, "delivered") || hasPhrase(key, "item_delivered")) {
    return "DELIVERED";
  }

  if (hasPhrase(key, "bag_close") || hasPhrase(key, "dispatch")) {
    return "DISPATCHED";
  }

  if (hasPhrase(key, "in_transit") || hasPhrase(key, "item_received")) {
    return "IN_TRANSIT";
  }

  return null;
}

export function shipmentStatusForOperational(operational: OperationalStatus): ShipmentStatus {
  if (operational === "RTO" || operational === "RTO_IN_TRANSIT" || operational === "RTO_DELIVERED") {
    return "RTO";
  }
  if (operational === "DISPATCHED" || operational === "IN_TRANSIT" || operational === "BOOKED") {
    return "IN_TRANSIT";
  }
  return operational;
}

export function mapIndiaPostEventToShipmentUpdate(event: {
  eventCode?: string | null;
  eventDescription?: string | null;
  nonDeliveryReason?: string | null;
}): IndiaPostShipmentUpdate {
  const eventCode = event.eventCode || "EVENT";
  const eventDescription = event.eventDescription ?? null;
  const ndrReason = event.nonDeliveryReason?.trim() || null;
  const classification = classifyEvent(eventKey(event), ndrReason);
  const shipmentStatus = classification ? shipmentStatusForOperational(classification) : null;
  const rtoReason =
    classification === "RTO" || classification === "RTO_IN_TRANSIT" || classification === "RTO_DELIVERED"
      ? eventDescription || eventCode
      : null;

  return {
    eventCode,
    eventDescription,
    shipmentStatus,
    operationalStatus: classification,
    classification,
    shouldUpdateStatus: Boolean(classification),
    ndrReason: classification === "NDR" ? ndrReason || eventDescription || eventCode : null,
    rtoReason,
  };
}

export function canAdvanceShipmentStatus(current: string, next: ShipmentStatus) {
  const currentRank = STATUS_RANK[current as ShipmentStatus] ?? 0;
  const nextRank = STATUS_RANK[next];
  return nextRank >= currentRank;
}

function eventIsOlder(eventAt: string, lastEventAt: string | null) {
  if (!lastEventAt) return false;
  const next = Date.parse(eventAt);
  const previous = Date.parse(lastEventAt);
  if (Number.isNaN(next) || Number.isNaN(previous)) return false;
  return next < previous;
}

export function planTrackingUpdate(input: {
  currentStatus: string;
  currentOperational: string | null;
  returnStarted: boolean;
  lastEventAt: string | null;
  eventAt: string;
  mapped: IndiaPostShipmentUpdate;
}): TrackingPlan {
  const none: TrackingPlan = {
    updateLastScan: false,
    applyStatus: false,
    shipmentStatus: null,
    operationalStatus: null,
    orderStatus: null,
  };
  if (input.currentStatus === "CANCELLED") return none;

  const older = eventIsOlder(input.eventAt, input.lastEventAt);
  if (older || !input.mapped.classification || !input.mapped.operationalStatus || !input.mapped.shipmentStatus) {
    return { ...none, updateLastScan: !older };
  }

  let operational = input.mapped.operationalStatus;
  const returnStarted =
    input.returnStarted ||
    input.currentStatus === "RTO" ||
    RETURN_OPERATIONAL.has(input.currentOperational as OperationalStatus);

  if (returnStarted && operational === "DELIVERED") {
    operational = "RTO_DELIVERED";
  }

  if (input.currentStatus === "DELIVERED" && !RETURN_OPERATIONAL.has(operational)) {
    return { ...none, updateLastScan: true };
  }

  if (returnStarted && !RETURN_OPERATIONAL.has(operational)) {
    return { ...none, updateLastScan: true };
  }

  const shipmentStatus = shipmentStatusForOperational(operational);
  if (BOOKING_PHASE.has(input.currentStatus) && !canAdvanceShipmentStatus(input.currentStatus, shipmentStatus)) {
    return { ...none, updateLastScan: true };
  }

  let orderStatus: "IN_TRANSIT" | "DELIVERED" | null = null;
  if (operational === "DELIVERED" && input.currentStatus !== "DELIVERED") {
    orderStatus = "DELIVERED";
  } else if (
    (operational === "IN_TRANSIT" || operational === "DISPATCHED" || operational === "OUT_FOR_DELIVERY") &&
    !ALREADY_MOVING.has(input.currentStatus)
  ) {
    orderStatus = "IN_TRANSIT";
  }

  return {
    updateLastScan: true,
    applyStatus: true,
    shipmentStatus,
    operationalStatus: operational,
    orderStatus,
  };
}
