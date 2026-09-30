import { DEFAULT_INDIA_POST_SERVICE } from "@/types/domain";

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
  allowedServices?: Array<string | null | undefined> | null;
}) {
  const allowed = [
    ...new Set((input.allowedServices ?? []).map((code) => parcelServiceCode(code)).filter(Boolean)),
  ] as ParcelServiceCode[];
  const only = allowed.length === 1 ? allowed[0] : null;
  const inAllowed = (code: ParcelServiceCode | null) =>
    Boolean(code && (allowed.length === 0 || allowed.includes(code)));

  const pinned = parcelServiceCode(input.orderService);
  if (pinned && inAllowed(pinned)) return pinned;
  if (only) return only;

  const override = parcelServiceCode(input.workspaceOverride);
  if (override && inAllowed(override)) return override;
  const fallback = parcelServiceCode(input.defaultService);
  if (fallback && inAllowed(fallback)) return fallback;
  return DEFAULT_INDIA_POST_SERVICE;
}

/** Booked and in-progress shipments keep the service already sent to India Post. */
export function shipmentServiceLocked(status?: string | null) {
  const value = (status ?? "").toUpperCase();
  if (!value || value === "CANCELLED") return false;
  return !OPEN_SHIPMENT_STATUSES.has(value);
}
