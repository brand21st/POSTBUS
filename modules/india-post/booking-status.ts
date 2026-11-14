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

/** Booking request is still being sent. Unknown outcomes and label generation are not this. */
export const INDIA_POST_ACTIVE_BOOKING_STATUSES = new Set([
  "VALIDATING",
  "QUEUED",
  "BOOKING",
]);

/** Direct Book past this age is no longer "in progress" — the row can be retried. */
export const DIRECT_BOOK_STUCK_MS = 2 * 60 * 1000;

export const INDIA_POST_IN_FLIGHT_STATUSES = new Set([
  ...INDIA_POST_ACTIVE_BOOKING_STATUSES,
  "LABEL_PENDING",
]);

export function indiaPostStatusOf(value?: string | null) {
  return String(value ?? "").toUpperCase();
}

export function isIndiaPostAcceptedStatus(value?: string | null) {
  return INDIA_POST_ACCEPTED_STATUSES.has(indiaPostStatusOf(value));
}

export function isIndiaPostBookingActive(value?: string | null) {
  return INDIA_POST_ACTIVE_BOOKING_STATUSES.has(indiaPostStatusOf(value));
}

/** True while a click's booking is still young enough to wait on. A missing timestamp stays live. */
export function bookingAttemptIsLive(
  shipment?: {
    status?: string | null;
    updatedAt?: string | null;
    updated_at?: string | null;
  } | null,
  now = Date.now()
) {
  if (!isIndiaPostBookingActive(shipment?.status)) return false;
  const stamp = shipment?.updatedAt ?? shipment?.updated_at;
  const ms = stamp ? Date.parse(stamp) : Number.NaN;
  if (!Number.isFinite(ms)) return true;
  return now - ms < DIRECT_BOOK_STUCK_MS;
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
