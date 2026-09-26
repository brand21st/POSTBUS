import { DEFAULT_INDIA_POST_SERVICE, INDIA_POST_SERVICES } from "@/types/domain";

export const PARCEL_SERVICE_CODES = ["SP_INLAND_PARCEL", "BUSINESS_PARCEL"] as const;
export type ParcelServiceCode = (typeof PARCEL_SERVICE_CODES)[number];

const OPEN_SHIPMENT_STATUSES = new Set(["DRAFT", "QUEUED", "FAILED"]);

export function parcelServiceCode(value?: string | null): ParcelServiceCode | null {
  const code = (value ?? "").trim();
  return code === "SP_INLAND_PARCEL" || code === "BUSINESS_PARCEL" ? code : null;
}

/** Order pin, then the top-bar override, then the India Post default contract. */
export function resolveOrderBookingService(input: {
  orderService?: string | null;
  workspaceOverride?: string | null;
  defaultService?: string | null;
}) {
  const pinned = parcelServiceCode(input.orderService);
  if (pinned) return pinned;
  const override = parcelServiceCode(input.workspaceOverride);
  if (override) return override;
  const fallback = (input.defaultService ?? "").trim();
  if (INDIA_POST_SERVICES.some((service) => service.code === fallback)) return fallback;
  return DEFAULT_INDIA_POST_SERVICE;
}

/** Booked and in-progress shipments keep the service already sent to India Post. */
export function shipmentServiceLocked(status?: string | null) {
  const value = (status ?? "").toUpperCase();
  if (!value || value === "CANCELLED") return false;
  return !OPEN_SHIPMENT_STATUSES.has(value);
}
