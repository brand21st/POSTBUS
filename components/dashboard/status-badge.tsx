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
  "GENERATED",
  "PUBLISHED",
  "PRINTED",
]);

const WARNING = new Set([
  "PENDING",
  "PROCESSING",
  "BOOKING",
  "BOOKED",
  "QUEUED",
  "PARTIAL",
  "COD",
  "IN_TRANSIT",
  "OUT_FOR_DELIVERY",
  "CONFIGURATION_REQUIRED",
  "UAT",
  "DRAFT",
  "WAITING",
  "PRINTING",
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

const BRAND = new Set(["SHIPPED", "IMPORTED", "SHOPIFY"]);

/** Soft full-row tint for order status in tables. BOOKED is light yellow. */
export function orderStatusRowClass(status?: string | null) {
  switch ((status ?? "").toUpperCase()) {
    case "IMPORTED":
      return "bg-sky-50 hover:bg-sky-100/80";
    case "READY":
      return "bg-emerald-50 hover:bg-emerald-100/80";
    case "PROCESSING":
      return "bg-orange-50 hover:bg-orange-100/80";
    case "BOOKED":
      return "bg-amber-100 hover:bg-amber-200/70";
    case "SHIPPED":
    case "IN_TRANSIT":
      return "bg-indigo-50 hover:bg-indigo-100/80";
    case "DELIVERED":
      return "bg-zinc-200 text-zinc-700 hover:bg-zinc-300/80";
    case "FAILED":
      return "bg-red-50 hover:bg-red-100/80";
    case "CANCELLED":
      return "bg-zinc-100 hover:bg-zinc-200/70";
    default:
      return undefined;
  }
}

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

  return (
    <Badge
      variant={variant}
      className={
        key === "BOOKED"
          ? "border-amber-200 bg-amber-200/80 font-semibold text-amber-900"
          : undefined
      }
    >
      {key === "WAITING" ? "Waiting to print" : key === "PRINTED" ? "Printed" : titleCase(value)}
    </Badge>
  );
}
