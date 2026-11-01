/**
 * Bulk Booking queue rollout gate. Off unless the workspace is listed in BOOKING_QUEUE_ORGS
 * (comma-separated organization ids) or the variable is "*". Ops-controlled on purpose:
 * merchants cannot switch it on themselves during the canary.
 */
export function bookingQueueEnabledFor(organizationId: string, raw = process.env.BOOKING_QUEUE_ORGS) {
  const value = (raw ?? "").trim();
  if (!value || !organizationId) return false;
  if (value === "*") return true;
  return value
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
    .includes(organizationId.trim().toLowerCase());
}

/**
 * Automatic booking (AUTOMATIC mode) has its own, narrower gate: BOOKING_QUEUE_AUTOMATION_ORGS,
 * same format. It also needs the queue itself to be on.
 */
export function bookingQueueAutomationEnabledFor(
  organizationId: string,
  raw = process.env.BOOKING_QUEUE_AUTOMATION_ORGS
) {
  // An unset variable must mean "off": pass "" so the queue allowlist is never used as a fallback.
  return bookingQueueEnabledFor(organizationId) && bookingQueueEnabledFor(organizationId, raw ?? "");
}
