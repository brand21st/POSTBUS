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

/** Tracking lookup can stamp FAILED after CEPT already accepted the article. */
export function indiaPostDisplayShipmentStatus(row: {
  status?: string | null;
  operational_status?: string | null;
  operationalStatus?: string | null;
  booked_at?: string | null;
  bookedAt?: string | null;
}) {
  const operational = row.operationalStatus ?? row.operational_status ?? null;
  if (operational === "RTO_IN_TRANSIT" || operational === "RTO_DELIVERED") return operational;
  const booked = Boolean(row.bookedAt ?? row.booked_at);
  if (booked && indiaPostStatusOf(row.status) === "FAILED") return "BOOKED";
  return row.status ?? null;
}

export function indiaPostVisibleShipmentError(row: {
  last_error?: string | null;
  lastError?: string | null;
  booked_at?: string | null;
  bookedAt?: string | null;
}) {
  const message = String(row.lastError ?? row.last_error ?? "").trim();
  if (!message) return null;
  const booked = Boolean(row.bookedAt ?? row.booked_at);
  if (booked && /tracking lookup failed/i.test(message)) return null;
  return message;
}
