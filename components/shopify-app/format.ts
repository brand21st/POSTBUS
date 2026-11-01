/** Pure display helpers for the embedded app (no React, so they are unit-testable). */

export type BadgeTone = "neutral" | "info" | "success" | "caution" | "warning" | "critical";

export const SERVICE_OPTIONS = [
  { code: "SP_INLAND_PARCEL", label: "Speed Post Parcel" },
  { code: "BUSINESS_PARCEL", label: "Business Parcel" },
] as const;

export function serviceLabel(code?: string | null) {
  return SERVICE_OPTIONS.find((option) => option.code === code)?.label ?? (code || "Not set");
}

const SHIPMENT_STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  DRAFT: { label: "Draft", tone: "neutral" },
  VALIDATING: { label: "Validating", tone: "info" },
  QUEUED: { label: "Queued", tone: "info" },
  BOOKING: { label: "Booking", tone: "info" },
  BOOKED: { label: "Booked", tone: "success" },
  LABEL_PENDING: { label: "Booked", tone: "success" },
  LABEL_READY: { label: "Label ready", tone: "success" },
  MANIFEST_PENDING: { label: "Label ready", tone: "success" },
  MANIFEST_READY: { label: "Manifested", tone: "success" },
  IN_TRANSIT: { label: "In transit", tone: "info" },
  OUT_FOR_DELIVERY: { label: "Out for delivery", tone: "info" },
  DELIVERED: { label: "Delivered", tone: "success" },
  FAILED: { label: "Booking failed", tone: "critical" },
  CANCELLED: { label: "Cancelled", tone: "neutral" },
  RTO: { label: "Returning (RTO)", tone: "warning" },
};

const ORDER_STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  IMPORTED: { label: "To book", tone: "caution" },
  READY: { label: "To book", tone: "caution" },
  PROCESSING: { label: "Processing", tone: "info" },
  BOOKED: { label: "Booked", tone: "success" },
  SHIPPED: { label: "Shipped", tone: "success" },
  IN_TRANSIT: { label: "In transit", tone: "info" },
  DELIVERED: { label: "Delivered", tone: "success" },
  FAILED: { label: "Needs attention", tone: "critical" },
  CANCELLED: { label: "Cancelled", tone: "neutral" },
};

function titleCase(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function shipmentStatusBadge(status?: string | null) {
  const key = String(status ?? "").toUpperCase();
  return SHIPMENT_STATUS[key] ?? { label: key ? titleCase(key) : "Not booked", tone: "neutral" as BadgeTone };
}

/** The order's badge follows its shipment once one exists, since that is what the merchant acts on. */
export function orderStatusBadge(order: { status?: string | null; shipment?: { status?: string | null } | null }) {
  if (order.shipment?.status && String(order.shipment.status).toUpperCase() !== "CANCELLED") {
    return shipmentStatusBadge(order.shipment.status);
  }
  const key = String(order.status ?? "").toUpperCase();
  return ORDER_STATUS[key] ?? { label: key ? titleCase(key) : "Unknown", tone: "neutral" as BadgeTone };
}

export function paymentBadge(paymentStatus?: string | null) {
  const key = String(paymentStatus ?? "").toUpperCase();
  if (key === "COD" || key === "PENDING") return { label: "COD", tone: "warning" as BadgeTone };
  if (key === "PAID") return { label: "Prepaid", tone: "success" as BadgeTone };
  if (key === "PARTIAL") return { label: "Partly paid", tone: "caution" as BadgeTone };
  if (key === "REFUNDED") return { label: "Refunded", tone: "neutral" as BadgeTone };
  return { label: key ? titleCase(key) : "Unknown", tone: "neutral" as BadgeTone };
}

/** Shipments that already reached India Post (or are on their way there) must not be booked again. */
export function isShipmentActive(status?: string | null) {
  const key = String(status ?? "").toUpperCase();
  return Boolean(key) && !["DRAFT", "FAILED", "CANCELLED"].includes(key);
}

/** States that change on their own while the merchant watches (worker still running). */
export function isShipmentInFlight(status?: string | null) {
  return ["QUEUED", "VALIDATING", "BOOKING", "LABEL_PENDING"].includes(String(status ?? "").toUpperCase());
}

export function formatMoney(amount: number | string | null | undefined, currency = "INR") {
  const value = Number(amount);
  if (!Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 2 }).format(value);
}

export function formatDate(iso?: string | null) {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(date);
}

export function formatWeight(grams?: number | null) {
  if (grams == null || !Number.isFinite(grams)) return "—";
  return grams >= 1000 ? `${(grams / 1000).toFixed(grams % 1000 === 0 ? 0 : 2)} kg` : `${Math.round(grams)} g`;
}

/** Parses a positive number from a text field; returns null for blank or invalid input. */
export function positiveNumber(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}
