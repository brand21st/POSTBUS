import type { OperationalStatus, ShipmentStatus } from "@/types/domain";

export type ArticleFlowCategory =
  | "PICKUP_REQUESTED"
  | "PICKUP_ASSIGNED"
  | "PICKUP_CANCELLED"
  | "PICKED_UP"
  | "INDUCTED"
  | "BOOKED"
  | "BAGGED"
  | "DISPATCHED"
  | "BAG_RECEIVED"
  | "ITEM_RECEIVED"
  | "DESTINATION_REACHED"
  | "OUT_FOR_DELIVERY"
  | "ON_HOLD"
  | "REDIRECTED"
  | "DELIVERED";

export type IndiaPostShipmentUpdate = {
  eventCode: string;
  eventDescription: string | null;
  shipmentStatus: ShipmentStatus | null;
  operationalStatus: OperationalStatus | null;
  classification: OperationalStatus | null;
  articleFlow: ArticleFlowCategory | null;
  displayLabel: string | null;
  shouldUpdateStatus: boolean;
  ndrReason: string | null;
  rtoReason: string | null;
  delayScan: boolean;
};

/**
 * Official article-flow phrases, longest first.
 * Operational values stay inside the existing shipment enum.
 * Pickup, booked, on hold, and redirected do not change that enum.
 */
const ARTICLE_FLOW: Array<{
  phrase: string;
  category: ArticleFlowCategory;
  operational: OperationalStatus | null;
  display: string;
}> = [
  { phrase: "item received at destination", category: "DESTINATION_REACHED", operational: "IN_TRANSIT", display: "Reached Destination" },
  { phrase: "item kept on hold", category: "ON_HOLD", operational: null, display: "On Hold" },
  { phrase: "item pickup cancelled", category: "PICKUP_CANCELLED", operational: null, display: "Pickup Cancelled" },
  { phrase: "pickup request raised", category: "PICKUP_REQUESTED", operational: null, display: "Pickup Requested" },
  { phrase: "pickup assigned", category: "PICKUP_ASSIGNED", operational: null, display: "Pickup Assigned" },
  { phrase: "item pickedup", category: "PICKED_UP", operational: null, display: "Picked Up" },
  { phrase: "item inducted", category: "INDUCTED", operational: null, display: "Inducted" },
  { phrase: "item delivered addressee", category: "DELIVERED", operational: "DELIVERED", display: "Delivered" },
  { phrase: "item redirected", category: "REDIRECTED", operational: null, display: "Redirected" },
  { phrase: "taken out for delivery", category: "OUT_FOR_DELIVERY", operational: "OUT_FOR_DELIVERY", display: "Out for Delivery" },
  { phrase: "item dispatched", category: "DISPATCHED", operational: "DISPATCHED", display: "In Transit" },
  { phrase: "item bagged", category: "BAGGED", operational: "DISPATCHED", display: "Processing" },
  { phrase: "bag received", category: "BAG_RECEIVED", operational: "IN_TRANSIT", display: "In Transit" },
  { phrase: "item received", category: "ITEM_RECEIVED", operational: "IN_TRANSIT", display: "In Transit" },
  { phrase: "item booked", category: "BOOKED", operational: null, display: "Booked" },
];

export function normalizeArticleFlowText(value: string | null | undefined) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[()]/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function matchOfficialArticleFlow(event: { eventCode?: string | null; eventDescription?: string | null }) {
  const candidates = [event.eventDescription, event.eventCode].map((value) => normalizeArticleFlowText(value)).filter(Boolean);
  for (const text of candidates) {
    for (const row of ARTICLE_FLOW) {
      if (text === row.phrase || text.startsWith(`${row.phrase} `)) return row;
    }
  }
  return null;
}

/** Current database identity. Office is intentionally absent until a reviewed migration. */
export function currentTrackingEventIdentity(input: {
  organizationId: string;
  shipmentId: string;
  eventCode: string;
  occurredAt: string;
}) {
  return [input.organizationId, input.shipmentId, input.eventCode, input.occurredAt].join("|");
}

/** Proposed identity. Not used for inserts. */
export function proposedTrackingEventIdentity(input: {
  organizationId: string;
  shipmentId: string;
  eventCode: string;
  occurredAt: string;
  officeId?: string | null;
  officeName?: string | null;
}) {
  return [
    input.organizationId,
    input.shipmentId,
    normalizeArticleFlowText(input.eventCode),
    input.occurredAt,
    normalizeArticleFlowText(input.officeId || input.officeName || ""),
  ].join("|");
}

const STATUS_RANK: Record<ShipmentStatus, number> = {
  DRAFT: 10,
  VALIDATING: 20,
  QUEUED: 30,
  BOOKING: 40,
  RECOVERY_REQUIRED: 45,
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
  "RECOVERY_REQUIRED",
  "BOOKED",
  "LABEL_PENDING",
  "LABEL_READY",
  "MANIFEST_PENDING",
  "MANIFEST_READY",
]);

const RETURN_OPERATIONAL = new Set<OperationalStatus>(["RTO", "RTO_IN_TRANSIT", "RTO_DELIVERED"]);

const ALREADY_MOVING = new Set(["IN_TRANSIT", "OUT_FOR_DELIVERY", "NDR", "RTO", "DELIVERED"]);

export type TrackingWhatsAppEvent = "in_transit" | "delivered" | "shipment_delayed";

export type TrackingPlan = {
  updateLastScan: boolean;
  applyStatus: boolean;
  shipmentStatus: ShipmentStatus | null;
  operationalStatus: OperationalStatus | null;
  orderStatus: "IN_TRANSIT" | "DELIVERED" | null;
  whatsappEvents: TrackingWhatsAppEvent[];
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

function isExplicitNdrPhrase(key: string) {
  return (
    hasPhrase(key, "non_delivery") ||
    hasPhrase(key, "undelivered") ||
    hasPhrase(key, "delivery_attempted") ||
    hasPhrase(key, "delivery_attempt") ||
    hasPhrase(key, "not_delivered")
  );
}

function classifyEvent(
  key: string,
  nonDeliveryReason: string | null,
  rts?: boolean
): OperationalStatus | null {
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
    rts === true ||
    hasToken(key, "rto") ||
    hasPhrase(key, "return_to_sender") ||
    hasPhrase(key, "returned_to_sender") ||
    hasPhrase(key, "return_to_origin") ||
    hasPhrase(key, "item_returned")
  ) {
    return "RTO";
  }

  if (nonDeliveryReason) {
    return "NDR";
  }

  if (hasPhrase(key, "item_delivered")) {
    return "DELIVERED";
  }

  if (isExplicitNdrPhrase(key)) {
    return "NDR";
  }

  if (hasPhrase(key, "out_for_delivery") || hasToken(key, "ofd")) {
    return "OUT_FOR_DELIVERY";
  }

  if (hasPhrase(key, "delivered") && !hasPhrase(key, "intimation")) {
    return "DELIVERED";
  }

  if (hasPhrase(key, "bag_close") || hasPhrase(key, "dispatch") || hasPhrase(key, "bagged")) {
    return "DISPATCHED";
  }

  if (hasPhrase(key, "in_transit") || hasPhrase(key, "item_received") || hasPhrase(key, "bag_received")) {
    return "IN_TRANSIT";
  }

  return null;
}

export function isIndiaPostDelayScan(key: string, classification: OperationalStatus | null) {
  if (
    classification === "DELIVERED" ||
    classification === "NDR" ||
    classification === "RTO" ||
    classification === "RTO_IN_TRANSIT" ||
    classification === "RTO_DELIVERED"
  ) {
    return false;
  }
  return (
    hasPhrase(key, "delay") ||
    hasPhrase(key, "delayed") ||
    hasPhrase(key, "held_up") ||
    hasPhrase(key, "detention")
  );
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
  rts?: boolean | null;
}): IndiaPostShipmentUpdate {
  const eventCode = event.eventCode || "EVENT";
  const eventDescription = event.eventDescription ?? null;
  const ndrReason = event.nonDeliveryReason?.trim() || null;
  const generic = classifyEvent(eventKey(event), ndrReason, event.rts === true);
  const flow = matchOfficialArticleFlow(event);
  const returnOrNdr = generic === "RTO" || generic === "RTO_IN_TRANSIT" || generic === "RTO_DELIVERED" || generic === "NDR";
  const useFlow = Boolean(flow) && !returnOrNdr;
  const classification = useFlow ? flow!.operational : generic;
  const key = eventKey(event);
  const delayScan = isIndiaPostDelayScan(key, classification);
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
    articleFlow: useFlow ? flow!.category : null,
    displayLabel: useFlow ? flow!.display : null,
    shouldUpdateStatus: Boolean(classification),
    ndrReason: classification === "NDR" ? ndrReason || eventDescription || eventCode : null,
    rtoReason,
    delayScan,
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

function noticesForScan(mapped: IndiaPostShipmentUpdate, operational: OperationalStatus | null) {
  if (mapped.articleFlow && !mapped.operationalStatus) return [];
  return whatsappEventsForScan(mapped, operational);
}

export function whatsappEventsForScan(
  mapped: Pick<IndiaPostShipmentUpdate, "delayScan">,
  operational: OperationalStatus | null
): TrackingWhatsAppEvent[] {
  if (operational === "DELIVERED") return ["delivered"];
  if (mapped.delayScan) return ["shipment_delayed"];
  return ["in_transit"];
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
    whatsappEvents: [],
  };
  if (input.currentStatus === "CANCELLED") return none;

  const older = eventIsOlder(input.eventAt, input.lastEventAt);
  if (older) {
    return {
      ...none,
      whatsappEvents: noticesForScan(input.mapped, input.mapped.operationalStatus),
    };
  }

  if (
    !input.mapped.classification ||
    !input.mapped.operationalStatus ||
    !input.mapped.shipmentStatus
  ) {
    return {
      ...none,
      updateLastScan: true,
      whatsappEvents: noticesForScan(input.mapped, null),
    };
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
    return { ...none, updateLastScan: true, whatsappEvents: whatsappEventsForScan(input.mapped, operational) };
  }

  if (returnStarted && !RETURN_OPERATIONAL.has(operational)) {
    return { ...none, updateLastScan: true, whatsappEvents: whatsappEventsForScan(input.mapped, operational) };
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
    whatsappEvents: whatsappEventsForScan(input.mapped, operational),
  };
}

export type ProjectionTrackingEvent = {
  eventCode?: string | null;
  eventDescription?: string | null;
  nonDeliveryReason?: string | null;
  rts?: boolean | null;
  occurredAt: string;
};

export type ShipmentProjection = {
  status: string;
  operationalStatus: string | null;
  lastEventAt: string | null;
  ndrAttemptCount: number;
  rtoInitiatedAt: string | null;
  ndrReason: string | null;
  rtoReason: string | null;
  deliveredAt: string | null;
  ambiguous: boolean;
};

function eventTieBreak(left: ProjectionTrackingEvent, right: ProjectionTrackingEvent) {
  const time = left.occurredAt.localeCompare(right.occurredAt);
  if (time !== 0) return time;
  return String(left.eventCode ?? "").localeCompare(String(right.eventCode ?? ""));
}

export function projectShipmentFromEvents(
  events: ProjectionTrackingEvent[],
  initial: ShipmentProjection
): ShipmentProjection {
  const ordered = [...events].sort(eventTieBreak);
  const current = { ...initial };
  const seen = new Set<string>();

  for (const event of ordered) {
    const mapped = mapIndiaPostEventToShipmentUpdate({
      eventCode: event.eventCode,
      eventDescription: event.eventDescription,
      nonDeliveryReason: event.nonDeliveryReason,
      rts: event.rts,
    });
    const plan = planTrackingUpdate({
      currentStatus: current.status,
      currentOperational: current.operationalStatus,
      returnStarted: Boolean(current.rtoInitiatedAt) || RETURN_OPERATIONAL.has(current.operationalStatus as OperationalStatus),
      lastEventAt: current.lastEventAt,
      eventAt: event.occurredAt,
      mapped,
    });
    const key = `${event.eventCode ?? ""}|${event.occurredAt}`;
    const duplicate = seen.has(key);
    seen.add(key);
    if (!mapped.classification) current.ambiguous = true;
    if (plan.updateLastScan) current.lastEventAt = event.occurredAt;
    if (!plan.applyStatus || !plan.shipmentStatus || !plan.operationalStatus) continue;
    current.status = plan.shipmentStatus;
    current.operationalStatus = plan.operationalStatus;
    if (plan.operationalStatus === "NDR" && !duplicate) {
      current.ndrAttemptCount += 1;
      current.ndrReason = mapped.ndrReason;
    }
    if (RETURN_OPERATIONAL.has(plan.operationalStatus)) {
      current.rtoReason = mapped.rtoReason;
      if (!current.rtoInitiatedAt) current.rtoInitiatedAt = event.occurredAt;
    }
    if (plan.operationalStatus === "DELIVERED") current.deliveredAt = event.occurredAt;
  }

  return current;
}
