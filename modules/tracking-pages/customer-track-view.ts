import { format, isValid, parseISO } from "date-fns";
import { formatCurrency, formatWeightGrams, titleCase } from "@/lib/format";
import { mapIndiaPostEventToShipmentUpdate } from "@/modules/india-post/event-mapper";
import type { PublicTrackResult, PublicTrackedShipment, PublicTrackingEvent } from "@/types/api";

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

const STAGE_DESCRIPTIONS: Record<ProgressStage, string> = {
  BOOKED: "Shipment booked successfully.",
  ACCEPTED: "India Post has accepted the shipment.",
  DISPATCHED: "Shipment dispatched to the next location.",
  IN_TRANSIT: "Shipment is moving through the network.",
  OUT_FOR_DELIVERY: "Shipment is out for delivery.",
  DELIVERED: "Shipment delivered successfully.",
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

export function classifyCustomerEvent(event: PublicTrackingEvent): {
  stage: ProgressStage | null;
  status: string;
} {
  const mapped = mapIndiaPostEventToShipmentUpdate({
    eventCode: event.eventCode,
    eventDescription: event.eventDescription,
  });
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
  const description = event.eventDescription?.trim();
  if (description && description.toUpperCase() !== event.eventCode?.toUpperCase()) {
    return titleCase(description.replace(/_/g, " "));
  }
  if (stage) return STAGE_LABELS[stage];
  return titleCase(status.replace(/_/g, " "));
}

function eventDescription(event: PublicTrackingEvent, status: string, stage: ProgressStage | null) {
  if (stage) return STAGE_DESCRIPTIONS[stage];
  if (status === "NDR") return "Delivery could not be completed on this attempt.";
  if (status.startsWith("RTO")) return "The shipment is being returned to the origin.";
  const description = event.eventDescription?.trim();
  if (description) return description.endsWith(".") ? description : `${description}.`;
  return "Shipment update recorded.";
}

function shipmentStatusKey(shipment: PublicTrackedShipment, latestStatus: string | null) {
  const operational = (shipment.operationalStatus ?? "").toUpperCase();
  if (operational) return operational;
  const status = (shipment.status ?? "").toUpperCase();
  if (status === "SHIPPED" || status === "MANIFEST_READY" || status === "LABEL_READY") return "IN_TRANSIT";
  if (status) return status;
  return latestStatus || "BOOKED";
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
      description: eventDescription(event, classified.status, classified.stage),
      location: event.officeName?.trim() || null,
      timestamp: event.occurredAt ?? null,
      completed: true,
      latest: index === 0,
    } satisfies CustomerTrackEvent;
  });

  const statusKey = shipmentStatusKey(shipment, mappedEvents[0]?.status ?? null);
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
  const booked = formatTrackDate(shipment.bookedAt);
  if (booked) details.push({ label: "Booked Date", value: booked });
  if (shipment.weightGrams && shipment.weightGrams > 0) {
    details.push({ label: "Weight", value: formatWeightGrams(shipment.weightGrams) });
  }
  if (shipment.paymentMode) details.push({ label: "Payment", value: shipment.paymentMode });
  if (shipment.codAmount) {
    details.push({ label: "COD Amount", value: formatCurrency(shipment.codAmount) });
  }
  const lastUpdated = formatTrackDateTime(lastUpdatedAt);
  if (lastUpdated) details.push({ label: "Last Updated", value: lastUpdated });

  return {
    articleNumber,
    statusKey,
    statusLabel: titleCase(statusKey.replace(/_/g, " ")),
    statusTone: statusToneFor(statusKey),
    statusSupport:
      result.liveTracking === "cached" && result.liveMessage
        ? result.liveMessage
        : (STATUS_SUPPORT[statusKey] ?? "Latest carrier update is shown below."),
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
    exception: exceptionFor(statusKey, mappedEvents),
  };
}
