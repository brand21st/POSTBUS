import { Badge } from "@/components/ui/badge";
import { titleCase } from "@/lib/format";

const SUCCESS = new Set([
  "DELIVERED",
  "PAID",
  "FULFILLED",
  "CONNECTED",
  "ACTIVE",
  "READY",
  "LABEL_READY",
  "MANIFEST_READY",
  "SUCCEEDED",
  "PUBLISHED",
]);

const WARNING = new Set([
  "PENDING",
  "PROCESSING",
  "BOOKING",
  "QUEUED",
  "PARTIAL",
  "COD",
  "IN_TRANSIT",
  "OUT_FOR_DELIVERY",
  "CONFIGURATION_REQUIRED",
  "UAT",
  "DRAFT",
]);

const ERROR = new Set([
  "FAILED",
  "CANCELLED",
  "ERROR",
  "RTO",
  "DISCONNECTED",
  "REVOKED",
  "UNPAID",
  "DISABLED",
]);

const BRAND = new Set(["BOOKED", "SHIPPED", "READY", "IMPORTED", "SHOPIFY"]);

export function StatusBadge({ value }: { value?: string | null }) {
  if (!value) return <Badge>—</Badge>;
  const key = value.toUpperCase();
  const variant = SUCCESS.has(key)
    ? "success"
    : WARNING.has(key)
      ? "warning"
      : ERROR.has(key)
        ? "error"
        : BRAND.has(key)
          ? "brand"
          : "default";

  return <Badge variant={variant}>{titleCase(value)}</Badge>;
}
