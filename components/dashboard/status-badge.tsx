import { ShopifyLogo } from "@/components/brand/shopify-logo";
import { WhatsAppLogo } from "@/components/brand/whatsapp-logo";
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
  "SUBMITTED",
  "CONFIRMED",
  "HANDED_OVER",
]);

const WARNING = new Set([
  "BOOKING",
  "BOOKED",
  "LABEL_PENDING",
  "QUEUED",
  "INCOMPLETE",
  "IN_TRANSIT",
  "OUT_FOR_DELIVERY",
  "NDR",
  "RTO_IN_TRANSIT",
  "CONFIGURATION_REQUIRED",
  "UAT",
  "DRAFT",
  "WAITING",
  "PRINTING",
  "NEEDS_REVIEW",
  "HOLD",
  "CREATED",
  "OPENED",
  "UNFULFILLED",
  "PARTIAL",
]);

const ERROR = new Set([
  "FAILED",
  "CANCELLED",
  "ERROR",
  "RTO",
  "RTO_DELIVERED",
  "DISCONNECTED",
  "REVOKED",
  "UNPAID",
  "PENDING",
  "DISABLED",
  "SUSPENDED",
  "BLOCKED",
  "EXPIRED",
]);

const BRAND = new Set(["SHIPPED", "IMPORTED", "SHOPIFY", "WHATSAPP", "CLOSED"]);

/** Order status READY is shown as Unfulfilled until packing/booking starts. */
export function orderStatusBadgeValue(status?: string | null) {
  const key = (status ?? "").toUpperCase();
  if (key === "READY") return "UNFULFILLED";
  return status;
}

/** Soft full-row tint for order status in tables. Unfulfilled is yellow; BOOKED is amber. */
export function orderStatusRowClass(status?: string | null) {
  switch ((status ?? "").toUpperCase()) {
    case "IMPORTED":
      return "bg-sky-50/40 hover:bg-sky-50";
    case "READY":
      return "bg-yellow-50/80 hover:bg-yellow-50";
    case "PROCESSING":
      return "bg-orange-50/50 hover:bg-orange-50";
    case "BOOKED":
      return "bg-amber-50 hover:bg-amber-100/70";
    case "SHIPPED":
    case "IN_TRANSIT":
      return "bg-indigo-50/40 hover:bg-indigo-50";
    case "DELIVERED":
      return "bg-zinc-50 text-zinc-700 hover:bg-zinc-100";
    case "FAILED":
      return "bg-red-50/50 hover:bg-red-50";
    case "CANCELLED":
      return "bg-zinc-50 hover:bg-zinc-100";
    default:
      return undefined;
  }
}

export function StatusBadge({ value }: { value?: string | null }) {
  if (!value) return <Badge>—</Badge>;
  const key = value.toUpperCase();

  if (key === "SHOPIFY") {
    return <ShopifyLogo />;
  }
  if (key === "WHATSAPP") {
    return <WhatsAppLogo />;
  }
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
        key === "UNFULFILLED"
          ? "border-transparent bg-yellow-100 font-medium text-black dark:bg-yellow-100 dark:text-black"
          : key === "BOOKED"
          ? "border-amber-200 bg-amber-200/80 font-semibold text-black dark:text-black"
          : key === "IN_TRANSIT"
            ? "text-black dark:text-black"
            : undefined
      }
    >
      {key === "WAITING"
        ? "Waiting for Print Agent"
        : key === "PRINTING"
          ? "Sending to Print Agent"
        : key === "PRINTED"
          ? "Sent to Windows printer"
          : key === "NEEDS_REVIEW"
            ? "Needs verification"
          : key === "LABEL_PENDING"
            ? "Generating label"
            : titleCase(value)}
    </Badge>
  );
}
