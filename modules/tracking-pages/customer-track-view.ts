import { format, isValid, parseISO } from "date-fns";
import { formatCurrency, formatWeightGrams, titleCase } from "@/lib/format";
import { mapIndiaPostEventToShipmentUpdate, matchOfficialArticleFlow } from "@/modules/india-post/event-mapper";
import type { PublicTrackResult, PublicTrackedShipment, PublicTrackingEvent, TrackingAvailability } from "@/types/api";

export const PROGRESS_STAGES = [
  "BOOKED",
  "ACCEPTED",
  "DISPATCHED",
  "IN_TRANSIT",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
] as const;

export type ProgressStage = (typeof PROGRESS_STAGES)[number];

export type TrackStatusTone = "success" | "primary" | "attention" | "neutral" | "error" | "warning";

export type CustomerTrackEvent = {
  status: string;
  title: string;
  description: string;
  location: string | null;
  timestamp: string | null;
  completed: boolean;
  latest: boolean;
  originalEvent: string | null;
};

export type CustomerProgressStep = {
  stage: ProgressStage;
  label: string;
  completed: boolean;
  current: boolean;
  timestamp: string | null;
};

export type CustomerPlace = {
  city: string;
  state: string | null;
};

export type CustomerTrackView = {
  articleNumber: string;
  statusKey: string;
  statusLabel: string;
  statusTone: TrackStatusTone;
  statusSupport: string;
  serviceLabel: string | null;
  lastUpdatedAt: string | null;
  expectedDeliveryAt: string | null;
  origin: CustomerPlace | null;
  destination: CustomerPlace | null;
  bookedAt: string | null;
  weightGrams: number | null;
  paymentMode: string | null;
  codAmount: number | null;
  details: { label: string; value: string }[];
  events: CustomerTrackEvent[];
  progress: CustomerProgressStep[];
  nextStepLabel: string | null;
  journeyNotice: string | null;
  trackingAvailability: TrackingAvailability | null;
  exception: {
    latestTitle: string;
    location: string | null;
    timestamp: string | null;
    explanation: string;
  } | null;
};

const STAGE_LABELS: Record<ProgressStage, string> = {
  BOOKED: "Booked",
  ACCEPTED: "Accepted",
  DISPATCHED: "Dispatched",
  IN_TRANSIT: "In Transit",
  OUT_FOR_DELIVERY: "Out for Delivery",
  DELIVERED: "Delivered",
};

const STATUS_SUPPORT: Record<string, string> = {
  DELIVERED: "Your shipment has been delivered.",
  OUT_FOR_DELIVERY: "Your shipment is out for delivery today.",
  IN_TRANSIT: "Your shipment is currently on its way.",
  DISPATCHED: "Your shipment has been dispatched to the next location.",
  ACCEPTED: "India Post has accepted your shipment.",
  BOOKED: "Your shipment has been booked with India Post.",
  NDR: "A delivery attempt could not be completed.",
  RTO: "Your shipment is being returned to the origin.",
  RTO_IN_TRANSIT: "Your shipment is returning to the origin.",
  RTO_DELIVERED: "Your shipment has been returned to the origin.",
  FAILED: "This shipment could not be completed.",
  CANCELLED: "This shipment was cancelled.",
};

function eventKey(event: { eventCode?: string | null; eventDescription?: string | null }) {
  return `${event.eventCode ?? ""} ${event.eventDescription ?? ""}`.toLowerCase().replace(/[\s-]+/g, "_");
}

function hasPhrase(key: string, phrase: string) {
  return key.includes(phrase);
}

export function formatTrackDateTime(value: string | null | undefined) {
  if (!value) return null;
  const date = parseISO(value);
  if (!isValid(date)) return null;
  return format(date, "dd MMM yyyy, h:mm a");
}

export function formatTrackDate(value: string | null | undefined) {
  if (!value) return null;
  const date = parseISO(value);
  if (!isValid(date)) return null;
  return format(date, "dd MMM yyyy");
}

export function formatTrackTime(value: string | null | undefined) {
  if (!value) return null;
  const date = parseISO(value);
  if (!isValid(date)) return null;
  return format(date, "h:mm a");
}

const INDIA_POST_TIME_ZONE = "Asia/Kolkata";

export function formatTrackDateIndia(value: string | null | undefined) {
  if (!value) return null;
  const date = parseISO(value);
  if (!isValid(date)) return null;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: INDIA_POST_TIME_ZONE,
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

export function formatTrackTimeIndia(value: string | null | undefined) {
  if (!value) return null;
  const date = parseISO(value);
  if (!isValid(date)) return null;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: INDIA_POST_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

export function journeyNoticeFor(availability: TrackingAvailability | null | undefined, eventCount: number) {
  if (availability === "TRACKING_DATA_STALE" && eventCount > 0) {
    return "Showing the latest tracking updates available in PostBus. New updates are temporarily unavailable.";
  }
  if (availability === "TRACKING_TEMPORARILY_UNAVAILABLE") {
    return "We couldn't refresh the latest India Post tracking updates right now. Please try again shortly.";
  }
  if (availability === "TRACKING_PROVIDER_UNAUTHORIZED") {
    return "Live tracking updates are temporarily unavailable. Please try again later or contact support.";
  }
  if (eventCount === 0) {
    return "Tracking updates are not available yet. Please check again later.";
  }
  return null;
}

function place(city?: string | null, state?: string | null): CustomerPlace | null {
  const nextCity = city?.trim();
  if (!nextCity) return null;
  return { city: nextCity, state: state?.trim() || null };
}

function formatPlace(value: CustomerPlace | null) {
  if (!value) return null;
  return value.state ? `${value.city}, ${value.state}` : value.city;
}

function uiStageFromKey(key: string): ProgressStage | null {
  if (hasPhrase(key, "out_for_delivery") || key.includes("_ofd_") || key.endsWith("_ofd") || key.startsWith("ofd_")) {
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
  if (
    hasPhrase(key, "accepted") ||
    hasPhrase(key, "received_at") ||
    hasPhrase(key, "item_accepted") ||
    hasPhrase(key, "booking_office")
  ) {
    return "ACCEPTED";
  }
  if (hasPhrase(key, "booked") || hasPhrase(key, "booking")) {
    return "BOOKED";
  }
  return null;
}

function originalEventName(event: PublicTrackingEvent) {
  const description = event.eventDescription?.trim();
  if (!description) return event.eventCode?.trim() || null;
  const official = matchOfficialArticleFlow({ eventCode: event.eventCode, eventDescription: description });
  if (!official) return description;
  const split = description.split("—")[0]?.trim();
  return split || description;
}

export function classifyCustomerEvent(event: PublicTrackingEvent): {
  stage: ProgressStage | null;
  status: string;
} {
  const mapped = mapIndiaPostEventToShipmentUpdate({
    eventCode: event.eventCode,
    eventDescription: event.eventDescription,
  });
  if (mapped.articleFlow === "ON_HOLD" || mapped.articleFlow === "REDIRECTED") {
    return { stage: null, status: mapped.displayLabel || mapped.articleFlow };
  }
  if (mapped.articleFlow === "DESTINATION_REACHED" || mapped.articleFlow === "ITEM_RECEIVED" || mapped.articleFlow === "BAG_RECEIVED") {
    return { stage: "IN_TRANSIT", status: "IN_TRANSIT" };
  }
  if (mapped.articleFlow === "BAGGED" || mapped.articleFlow === "DISPATCHED") {
    return { stage: "DISPATCHED", status: "DISPATCHED" };
  }
  if (
    mapped.articleFlow === "BOOKED" ||
    mapped.articleFlow === "PICKUP_REQUESTED" ||
    mapped.articleFlow === "PICKUP_ASSIGNED" ||
    mapped.articleFlow === "PICKED_UP" ||
    mapped.articleFlow === "INDUCTED"
  ) {
    return { stage: "BOOKED", status: "BOOKED" };
  }
  if (mapped.articleFlow === "PICKUP_CANCELLED") {
    return { stage: null, status: "PICKUP_CANCELLED" };
  }
  const operational = mapped.operationalStatus;
  if (operational === "OUT_FOR_DELIVERY") return { stage: "OUT_FOR_DELIVERY", status: "OUT_FOR_DELIVERY" };
  if (operational === "DELIVERED") return { stage: "DELIVERED", status: "DELIVERED" };
  if (operational === "DISPATCHED") return { stage: "DISPATCHED", status: "DISPATCHED" };
  if (operational === "IN_TRANSIT") return { stage: "IN_TRANSIT", status: "IN_TRANSIT" };
  if (operational === "BOOKED") return { stage: "BOOKED", status: "BOOKED" };
  if (operational === "NDR") return { stage: null, status: "NDR" };
  if (operational === "RTO" || operational === "RTO_IN_TRANSIT" || operational === "RTO_DELIVERED") {
    return { stage: null, status: operational };
  }

  const key = eventKey(event);
  const stage = uiStageFromKey(key);
  if (stage) return { stage, status: stage };
  return { stage: null, status: event.eventCode?.trim() || "UPDATE" };
}

function eventTitle(event: PublicTrackingEvent, status: string, stage: ProgressStage | null) {
  const flow = matchOfficialArticleFlow(event);
  if (flow?.display) return flow.display;
  const description = event.eventDescription?.trim();
  if (description && description.toUpperCase() !== event.eventCode?.toUpperCase()) {
    return titleCase(description.split("—")[0]?.trim().replace(/_/g, " ") || description);
  }
  if (stage) return STAGE_LABELS[stage];
  return titleCase(status.replace(/_/g, " "));
}

function eventDescription(event: PublicTrackingEvent, status: string) {
  const original = originalEventName(event);
  const flow = matchOfficialArticleFlow(event);
  if (flow && original) return `India Post Event: ${original}`;
  if (status === "NDR") return "Delivery could not be completed on this attempt.";
  if (status.startsWith("RTO")) return "The shipment is being returned to the origin.";
  const description = event.eventDescription?.trim();
  if (description) return description.endsWith(".") ? description : `${description}.`;
  return "Shipment update recorded.";
}

const STAGE_RANK: Record<ProgressStage, number> = {
  BOOKED: 1,
  ACCEPTED: 2,
  DISPATCHED: 3,
  IN_TRANSIT: 4,
  OUT_FOR_DELIVERY: 5,
  DELIVERED: 6,
};

function strongestEventStage(events: PublicTrackingEvent[]) {
  let best: ProgressStage | null = null;
  for (const event of events) {
    const stage = classifyCustomerEvent(event).stage;
    if (!stage) continue;
    if (!best || STAGE_RANK[stage] > STAGE_RANK[best]) best = stage;
  }
  return best;
}

function shipmentStatusKey(shipment: PublicTrackedShipment) {
  const operational = (shipment.operationalStatus ?? "").toUpperCase();
  if (operational) return operational;
  const status = (shipment.status ?? "").toUpperCase();
  if (status === "SHIPPED" || status === "MANIFEST_READY" || status === "LABEL_READY") {
    const stage = strongestEventStage(shipment.events ?? []);
    if (!stage || stage === "BOOKED" || stage === "ACCEPTED") return "BOOKED";
    if (stage === "DISPATCHED" || stage === "IN_TRANSIT") return "IN_TRANSIT";
    return stage;
  }
  if (status) return status;
  return "BOOKED";
}

export function statusToneFor(statusKey: string): TrackStatusTone {
  const key = statusKey.toUpperCase();
  if (key === "DELIVERED") return "success";
  if (key === "OUT_FOR_DELIVERY") return "attention";
  if (key === "FAILED" || key === "CANCELLED" || key === "NDR") return "error";
  if (key.startsWith("RTO")) return "warning";
  if (key === "BOOKED" || key === "ACCEPTED") return "neutral";
  if (key === "IN_TRANSIT" || key === "DISPATCHED" || key === "SHIPPED") return "primary";
  return "primary";
}

function currentProgressStage(statusKey: string, eventStages: ProgressStage[]): ProgressStage | null {
  if ((PROGRESS_STAGES as readonly string[]).includes(statusKey)) return statusKey as ProgressStage;
  if (statusKey === "NDR" || statusKey.startsWith("RTO") || statusKey === "FAILED") {
    return eventStages.at(-1) ?? null;
  }
  return eventStages.at(-1) ?? "BOOKED";
}

function buildProgress(events: PublicTrackingEvent[], statusKey: string): CustomerProgressStep[] {
  const occurred = new Map<ProgressStage, string | null>();
  const chronological = [...events].reverse();
  for (const event of chronological) {
    const { stage } = classifyCustomerEvent(event);
    if (!stage || occurred.has(stage)) continue;
    occurred.set(stage, event.occurredAt ?? null);
  }
  const eventStages = PROGRESS_STAGES.filter((stage) => occurred.has(stage));
  const current = currentProgressStage(statusKey, eventStages);
  const currentIndex = current ? PROGRESS_STAGES.indexOf(current) : -1;

  return PROGRESS_STAGES.filter((stage) => {
    const index = PROGRESS_STAGES.indexOf(stage);
    if (occurred.has(stage)) return true;
    if (current && stage === current) return true;
    return currentIndex >= 0 && index > currentIndex;
  }).map((stage) => {
    const index = PROGRESS_STAGES.indexOf(stage);
    const completed = Boolean(occurred.has(stage) && currentIndex >= 0 && index < currentIndex);
    return {
      stage,
      label: STAGE_LABELS[stage],
      completed: completed || (stage === current && statusKey === "DELIVERED"),
      current: stage === current,
      timestamp: occurred.get(stage) ?? null,
    };
  });
}

function exceptionFor(
  statusKey: string,
  events: CustomerTrackEvent[]
): CustomerTrackView["exception"] {
  const exceptional =
    statusKey === "NDR" ||
    statusKey === "FAILED" ||
    statusKey === "CANCELLED" ||
    statusKey.startsWith("RTO");
  if (!exceptional) return null;
  const latest = events[0];
  return {
    latestTitle: latest?.title ?? titleCase(statusKey),
    location: latest?.location ?? null,
    timestamp: latest?.timestamp ?? null,
    explanation:
      latest?.description ??
      (statusKey.startsWith("RTO")
        ? "Your shipment is taking a return path to the origin."
        : "Your shipment is taking longer than expected."),
  };
}

export function toCustomerTrackView(result: PublicTrackResult): CustomerTrackView | null {
  const shipment = result.shipment;
  if (!result.found || !shipment) return null;

  const articleNumber = shipment.barcode || shipment.trackingNumber || "";
  const mappedEvents = shipment.events.map((event, index) => {
    const classified = classifyCustomerEvent(event);
    return {
      status: classified.status,
      title: eventTitle(event, classified.status, classified.stage),
      description: eventDescription(event, classified.status),
      location: event.officeName?.trim() || null,
      timestamp: event.occurredAt ?? null,
      completed: true,
      latest: index === 0,
      originalEvent: matchOfficialArticleFlow(event) ? originalEventName(event) : null,
    } satisfies CustomerTrackEvent;
  });

  const statusKey = shipmentStatusKey(shipment);
  const origin = place(shipment.originCity, shipment.originState);
  const destination = place(shipment.destinationCity, shipment.destinationState);
  const lastUpdatedAt = shipment.lastUpdatedAt ?? mappedEvents[0]?.timestamp ?? null;
  const progress = buildProgress(shipment.events, statusKey);
  const current = progress.find((step) => step.current);
  const next = current ? progress[progress.indexOf(current) + 1] : null;

  const details: { label: string; value: string }[] = [];
  if (articleNumber) details.push({ label: "Article Number", value: articleNumber });
  if (shipment.serviceLabel) details.push({ label: "Service", value: shipment.serviceLabel });
  const originLabel = formatPlace(origin);
  if (originLabel) details.push({ label: "Origin", value: originLabel });
  const destinationLabel = formatPlace(destination);
  if (destinationLabel) details.push({ label: "Destination", value: destinationLabel });
  const booked = formatTrackDateIndia(shipment.bookedAt);
  if (booked) details.push({ label: "Booked in PostBus", value: booked });
  const indiaPostBooked = shipment.events.find((event) =>
    /item[\s_]*booked/i.test(`${event.eventDescription ?? ""} ${event.eventCode ?? ""}`)
  );
  const indiaPostBookedOn = formatTrackDateIndia(indiaPostBooked?.occurredAt);
  if (indiaPostBookedOn) details.push({ label: "India Post Booked On", value: indiaPostBookedOn });
  if (shipment.weightGrams && shipment.weightGrams > 0) {
    details.push({ label: "Weight", value: formatWeightGrams(shipment.weightGrams) });
  }
  if (shipment.paymentMode) details.push({ label: "Payment", value: shipment.paymentMode });
  if (shipment.codAmount) {
    details.push({ label: "COD Amount", value: formatCurrency(shipment.codAmount) });
  }
  const lastUpdated = formatTrackDateIndia(lastUpdatedAt);
  const lastUpdatedTime = formatTrackTimeIndia(lastUpdatedAt);
  if (lastUpdated) {
    details.push({
      label: "Last Updated",
      value: lastUpdatedTime ? `${lastUpdated}, ${lastUpdatedTime} IST` : lastUpdated,
    });
  }
  const journeyNotice = journeyNoticeFor(result.trackingAvailability, mappedEvents.length);

  return {
    articleNumber,
    statusKey,
    statusLabel:
      (shipment.events[0] ? matchOfficialArticleFlow(shipment.events[0])?.display : null) ||
      titleCase(statusKey.replace(/_/g, " ")),
    statusTone: statusToneFor(statusKey),
    statusSupport:
      journeyNotice ??
      (result.liveTracking === "cached" && result.liveMessage
        ? result.liveMessage
        : (STATUS_SUPPORT[statusKey] ?? "Latest carrier update is shown below.")),
    serviceLabel: shipment.serviceLabel ?? null,
    lastUpdatedAt,
    expectedDeliveryAt: null,
    origin,
    destination,
    bookedAt: shipment.bookedAt ?? null,
    weightGrams: shipment.weightGrams ?? null,
    paymentMode: shipment.paymentMode ?? null,
    codAmount: shipment.codAmount ?? null,
    details,
    events: mappedEvents,
    progress,
    nextStepLabel: next?.label ?? (statusKey === "DELIVERED" ? null : "Awaiting the next carrier update"),
    journeyNotice,
    trackingAvailability: result.trackingAvailability ?? null,
    exception: exceptionFor(statusKey, mappedEvents),
  };
}
