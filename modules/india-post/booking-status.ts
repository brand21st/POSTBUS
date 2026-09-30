export const INDIA_POST_ACCEPTED_STATUSES = new Set([
  "BOOKED",
  "LABEL_PENDING",
  "LABEL_READY",
  "MANIFEST_PENDING",
  "MANIFEST_READY",
  "IN_TRANSIT",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
  "NDR",
  "RTO",
]);

export const INDIA_POST_IN_FLIGHT_STATUSES = new Set(["VALIDATING", "QUEUED", "BOOKING", "LABEL_PENDING"]);

export function indiaPostStatusOf(value?: string | null) {
  return String(value ?? "").toUpperCase();
}

export function isIndiaPostAcceptedStatus(value?: string | null) {
  return INDIA_POST_ACCEPTED_STATUSES.has(indiaPostStatusOf(value));
}

export function isIndiaPostBookingInFlight(value?: string | null) {
  return INDIA_POST_IN_FLIGHT_STATUSES.has(indiaPostStatusOf(value));
}
