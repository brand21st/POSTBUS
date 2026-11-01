import { whatsappShipmentBlocked } from "@/lib/dashboard/records";
import { isAuthoritativeIndiaPostBooking } from "@/modules/india-post/booking-idempotency";
import { isIndiaPostAcceptedStatus } from "@/modules/india-post/booking-status";

export const QUEUE_SOURCES = ["SHOPIFY", "WOOCOMMERCE", "MANUAL", "API", "WHATSAPP", "EXCEL"] as const;
export type QueueSource = (typeof QUEUE_SOURCES)[number];

export type QueueShipmentSnapshot = {
  id: string;
  status?: string | null;
  booked_at?: string | null;
  barcode?: string | null;
  tracking_number?: string | null;
};

export type QueueOrderSnapshot = {
  id: string;
  order_number?: string | null;
  source?: string | null;
  status?: string | null;
  payment_status?: string | null;
  shipments?: QueueShipmentSnapshot[] | null;
};

export type EnrollmentDecision =
  | { ok: true; shipmentId: string | null; warnings: string[] }
  | { ok: false; code: EnrollmentBlock; reason: string };

export type EnrollmentBlock = "ORDER_CANCELLED" | "ALREADY_BOOKED" | "BOOKING_IN_PROGRESS" | "WHATSAPP_NOT_READY";

/** The shipment already handed to the direct booking pipeline (Orders page Book, retry, auto-booking). */
const DIRECT_PIPELINE_STATUSES = new Set(["QUEUED", "BOOKING", "RECOVERY_REQUIRED"]);
/** Settled payments that automatic enrollment may book without a person confirming. */
const AUTO_SETTLED_PAYMENTS = new Set(["PAID", "COD"]);

export function queueSourceOf(source?: string | null): QueueSource {
  const value = String(source ?? "").toUpperCase();
  return (QUEUE_SOURCES as readonly string[]).includes(value) ? (value as QueueSource) : "MANUAL";
}

/** The order's live shipment: not cancelled, preferring one that has not failed. */
export function liveShipmentOf(order: QueueOrderSnapshot) {
  const live = (order.shipments ?? []).filter((row) => String(row.status ?? "").toUpperCase() !== "CANCELLED");
  return live.find((row) => String(row.status ?? "").toUpperCase() !== "FAILED") ?? live[0] ?? null;
}

/**
 * Whether an order may enter the Bulk Booking queue. This never books anything; full article
 * validation runs after enrollment and puts the item in INVALID or WAITING_APPROVAL.
 */
export function queueEnrollmentDecision(order: QueueOrderSnapshot): EnrollmentDecision {
  const label = order.order_number || "This order";
  if (String(order.status ?? "").toUpperCase() === "CANCELLED") {
    return { ok: false, code: "ORDER_CANCELLED", reason: `${label} is cancelled.` };
  }
  if (whatsappShipmentBlocked({ source: order.source, status: order.status, payment_status: order.payment_status })) {
    return { ok: false, code: "WHATSAPP_NOT_READY", reason: `${label} cannot be queued until the WhatsApp order is READY.` };
  }
  const shipment = liveShipmentOf(order);
  if (shipment && (isAuthoritativeIndiaPostBooking(shipment) || isIndiaPostAcceptedStatus(shipment.status))) {
    return { ok: false, code: "ALREADY_BOOKED", reason: `${label} is already booked with India Post.` };
  }
  if (shipment && DIRECT_PIPELINE_STATUSES.has(String(shipment.status ?? "").toUpperCase())) {
    return {
      ok: false,
      code: "BOOKING_IN_PROGRESS",
      reason: `${label} is already being booked from the Orders page. Its result will appear in History.`,
    };
  }
  const warnings: string[] = [];
  if (String(order.payment_status ?? "").toUpperCase() === "PARTIAL") {
    warnings.push("Partially paid. Confirm the amount to collect before booking.");
  }
  return { ok: true, shipmentId: shipment?.id ?? null, warnings };
}

/**
 * Automatic enrollment (Phase 4) is stricter than manual: only settled Prepaid or COD orders from
 * a source the workspace switched on. Partial and pending payments always need a person.
 */
export function autoEnrollmentAllowed(order: QueueOrderSnapshot, enabledSources: readonly string[]) {
  if (!enabledSources.includes(queueSourceOf(order.source))) return false;
  if (!AUTO_SETTLED_PAYMENTS.has(String(order.payment_status ?? "").toUpperCase())) return false;
  return queueEnrollmentDecision(order).ok;
}
