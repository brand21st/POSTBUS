/**
 * Bulk Booking queue states. The database enforces the same matrix
 * (public.booking_queue_transition_allowed, migrations 20261101180000 and 20261101190000);
 * a test compares the two.
 *
 * These are queue states, not shipment statuses. BOOKED mirrors shipments.booked_at, which only a
 * CEPT-confirmed persist sets. Importing, approving, reserving a barcode, batching or sending a
 * request never makes an item BOOKED.
 */
export const BOOKING_QUEUE_STATES = [
  "PENDING_VALIDATION",
  "INVALID",
  "WAITING_APPROVAL",
  "READY_FOR_BOOKING",
  "BATCHED",
  "SUBMITTING",
  "BOOKED",
  "FAILED",
  "RECOVERY_REQUIRED",
  "EXCLUDED",
  "CANCELLED",
] as const;

export type BookingQueueState = (typeof BOOKING_QUEUE_STATES)[number];

const TRANSITIONS: Record<BookingQueueState, readonly BookingQueueState[]> = {
  PENDING_VALIDATION: ["INVALID", "WAITING_APPROVAL", "READY_FOR_BOOKING", "BOOKED", "EXCLUDED", "CANCELLED"],
  // BOOKED here is a system mirror of a booking made from the Orders page (migration 20261101190000).
  INVALID: ["PENDING_VALIDATION", "BOOKED", "EXCLUDED", "CANCELLED"],
  WAITING_APPROVAL: ["PENDING_VALIDATION", "INVALID", "READY_FOR_BOOKING", "BOOKED", "EXCLUDED", "CANCELLED"],
  READY_FOR_BOOKING: ["PENDING_VALIDATION", "INVALID", "WAITING_APPROVAL", "BATCHED", "BOOKED", "EXCLUDED", "CANCELLED"],
  BATCHED: ["READY_FOR_BOOKING", "SUBMITTING", "BOOKED", "FAILED", "RECOVERY_REQUIRED"],
  SUBMITTING: ["BOOKED", "FAILED", "RECOVERY_REQUIRED"],
  BOOKED: [],
  FAILED: ["PENDING_VALIDATION", "INVALID", "BOOKED", "EXCLUDED", "CANCELLED"],
  RECOVERY_REQUIRED: ["BOOKED", "FAILED"],
  EXCLUDED: ["PENDING_VALIDATION", "CANCELLED"],
  CANCELLED: [],
};

/** States a signed-in member may set. Batching, submission and outcomes are system-only. */
export const MEMBER_SETTABLE_STATES: ReadonlySet<BookingQueueState> = new Set([
  "PENDING_VALIDATION",
  "INVALID",
  "WAITING_APPROVAL",
  "READY_FOR_BOOKING",
  "EXCLUDED",
  "CANCELLED",
]);

/** States that hold the shipment's single live queue slot (see booking_queue_items_one_active_uidx). */
export const ACTIVE_QUEUE_STATES: ReadonlySet<BookingQueueState> = new Set(
  BOOKING_QUEUE_STATES.filter((state) => state !== "BOOKED" && state !== "CANCELLED" && state !== "EXCLUDED")
);

/** After a request may have reached India Post: never return to an editable or submittable state. */
export const POST_SUBMIT_STATES: ReadonlySet<BookingQueueState> = new Set(["SUBMITTING", "RECOVERY_REQUIRED", "BOOKED"]);

export function isBookingQueueState(value: unknown): value is BookingQueueState {
  return typeof value === "string" && (BOOKING_QUEUE_STATES as readonly string[]).includes(value);
}

export function canTransitionQueueItem(from: BookingQueueState, to: BookingQueueState) {
  return TRANSITIONS[from].includes(to);
}

export function memberMayTransitionQueueItem(from: BookingQueueState, to: BookingQueueState) {
  return canTransitionQueueItem(from, to) && MEMBER_SETTABLE_STATES.has(from) && MEMBER_SETTABLE_STATES.has(to);
}

/** Dashboard summary buckets. Every state belongs to exactly one bucket. */
export const QUEUE_SUMMARY_BUCKETS = {
  waitingApproval: ["PENDING_VALIDATION", "WAITING_APPROVAL"],
  invalid: ["INVALID"],
  ready: ["READY_FOR_BOOKING"],
  processing: ["BATCHED", "SUBMITTING"],
  booked: ["BOOKED"],
  failed: ["FAILED"],
  recovery: ["RECOVERY_REQUIRED"],
  excluded: ["EXCLUDED", "CANCELLED"],
} as const satisfies Record<string, readonly BookingQueueState[]>;

export type QueueSummaryBucket = keyof typeof QUEUE_SUMMARY_BUCKETS;
