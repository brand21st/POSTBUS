export const MEMBER_ROLES = [
  "OWNER",
  "ADMIN",
  "MANAGER",
  "OPERATOR",
  "VIEWER",
] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

export const ORDER_SOURCES = ["SHOPIFY", "MANUAL", "API", "WOOCOMMERCE"] as const;
export type OrderSource = (typeof ORDER_SOURCES)[number];

export const PAYMENT_STATUSES = [
  "PENDING",
  "PAID",
  "PARTIAL",
  "COD",
  "REFUNDED",
  "FAILED",
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const FULFILLMENT_STATUSES = [
  "UNFULFILLED",
  "PARTIAL",
  "FULFILLED",
  "CANCELLED",
] as const;
export type FulfillmentStatus = (typeof FULFILLMENT_STATUSES)[number];

export const ORDER_STATUSES = [
  "IMPORTED",
  "READY",
  "PROCESSING",
  "BOOKED",
  "SHIPPED",
  "DELIVERED",
  "FAILED",
  "CANCELLED",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const SHIPMENT_STATUSES = [
  "DRAFT",
  "VALIDATING",
  "QUEUED",
  "BOOKING",
  "BOOKED",
  "LABEL_PENDING",
  "LABEL_READY",
  "MANIFEST_PENDING",
  "MANIFEST_READY",
  "IN_TRANSIT",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
  "FAILED",
  "CANCELLED",
  "RTO",
] as const;
export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number];

export const JOB_STATUSES = [
  "PENDING",
  "QUEUED",
  "RUNNING",
  "RETRYING",
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const INTEGRATION_STATUSES = [
  "NOT_CONNECTED",
  "PENDING",
  "CONNECTED",
  "ERROR",
  "DISCONNECTED",
] as const;
export type IntegrationStatus = (typeof INTEGRATION_STATUSES)[number];

export const PROVIDER_ENVIRONMENTS = ["UAT", "PRODUCTION"] as const;
export type ProviderEnvironment = (typeof PROVIDER_ENVIRONMENTS)[number];

// India Post issues one contract, and usually one barcode series, per product.
// `code` is the CEPT `article_type`; only codes confirmed against the API are listed.
export const INDIA_POST_SERVICES = [
  {
    code: "SP_INLAND_PARCEL",
    label: "Speed Post parcel",
    description: "SP Inland Parcel",
  },
  {
    code: "SP_INLAND_DOC",
    label: "Speed Post document",
    description: "SP Inland Doc",
  },
  {
    code: "BUSINESS_PARCEL",
    label: "Business Parcel",
    description: "Business Parcel",
  },
] as const;

export type IndiaPostServiceCode = (typeof INDIA_POST_SERVICES)[number]["code"];

export const DEFAULT_INDIA_POST_SERVICE: IndiaPostServiceCode = "SP_INLAND_PARCEL";

export function indiaPostServiceLabel(code?: string | null) {
  if (!code) return "—";
  return INDIA_POST_SERVICES.find((service) => service.code === code)?.label ?? code;
}

export const BILLING_PLAN_CODES = [
  "STARTER",
  "GROWTH",
  "PRO",
  "BUSINESS",
  "ENTERPRISE",
] as const;
export type BillingPlanCode = (typeof BILLING_PLAN_CODES)[number];

export const WEBHOOK_EVENTS = [
  "order.created",
  "order.updated",
  "shipment.created",
  "shipment.booked",
  "shipment.failed",
  "label.generated",
  "manifest.generated",
  "tracking.updated",
  "shipment.delivered",
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export const JOB_TYPES = [
  "shopify-sync",
  "shipment-booking",
  "label-generation",
  "manifest-generation",
  "tracking-sync",
  "webhook-processing",
  "india-post-events",
  "notifications",
  "cleanup",
  "reports",
  "shopify-fulfillment",
  "wati-notify",
] as const;
export type JobType = (typeof JOB_TYPES)[number];

export type Permission =
  | "org.manage"
  | "org.billing"
  | "members.manage"
  | "orders.read"
  | "orders.write"
  | "shipments.read"
  | "shipments.write"
  | "labels.read"
  | "labels.write"
  | "manifests.read"
  | "manifests.write"
  | "tracking.read"
  | "tracking.pages"
  | "automation.manage"
  | "integrations.manage"
  | "api_keys.manage"
  | "webhooks.manage"
  | "audit.read"
  | "settings.manage";
