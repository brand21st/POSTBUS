export const MEMBER_ROLES = [
  "OWNER",
  "ADMIN",
  "MANAGER",
  "OPERATOR",
  "VIEWER",
] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

export const ORDER_SOURCES = ["SHOPIFY", "MANUAL", "API", "WOOCOMMERCE", "WHATSAPP"] as const;
export type OrderSource = (typeof ORDER_SOURCES)[number];

export const ORDER_SOURCE_LABELS: Record<OrderSource, string> = {
  SHOPIFY: "Shopify",
  MANUAL: "Manual",
  API: "API",
  WOOCOMMERCE: "WooCommerce",
  WHATSAPP: "WhatsApp Order",
};

export const CUSTOMER_ORDER_LINK_STATUSES = [
  "CREATED",
  "OPENED",
  "SUBMITTED",
  "CONFIRMED",
  "EXPIRED",
  "DISABLED",
  "ACTIVE",
] as const;
export type CustomerOrderLinkStatus = (typeof CUSTOMER_ORDER_LINK_STATUSES)[number];

export const CUSTOMER_ORDER_LINK_STATUS_LABELS: Record<CustomerOrderLinkStatus, string> = {
  CREATED: "Waiting",
  OPENED: "Opened",
  SUBMITTED: "Submitted",
  CONFIRMED: "Confirmed",
  EXPIRED: "Expired",
  DISABLED: "Disabled",
  ACTIVE: "Active",
};

export const PAYMENT_STATUSES = [
  "PENDING",
  "PAID",
  "PARTIAL",
  "COD",
  "REFUNDED",
  "FAILED",
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  PENDING: "Not paid yet",
  PAID: "Paid - full payment",
  PARTIAL: "Partial — collect rest on delivery",
  COD: "Cash on delivery",
  REFUNDED: "Refunded",
  FAILED: "Failed",
};

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
  "IN_TRANSIT",
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
  "RECOVERY_REQUIRED",
  "BOOKED",
  "LABEL_PENDING",
  "LABEL_READY",
  "MANIFEST_PENDING",
  "MANIFEST_READY",
  "IN_TRANSIT",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
  "NDR",
  "FAILED",
  "CANCELLED",
  "RTO",
] as const;
export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number];

export const OPERATIONAL_STATUSES = [
  "BOOKED",
  "DISPATCHED",
  "IN_TRANSIT",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
  "NDR",
  "RTO",
  "RTO_IN_TRANSIT",
  "RTO_DELIVERED",
] as const;
export type OperationalStatus = (typeof OPERATIONAL_STATUSES)[number];

export const NDR_BUCKETS = [
  "DELIVERED",
  "OUT_FOR_DELIVERY",
  "DELIVERED_TODAY",
  "NDR",
  "RTO",
  "RTO_IN_TRANSIT",
  "RTO_DELIVERED",
] as const;
export type NdrBucket = (typeof NDR_BUCKETS)[number];

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
export const DEFAULT_PROVIDER_ENVIRONMENT: ProviderEnvironment = "PRODUCTION";

// India Post issues one contract, and usually one barcode series, per product.
// `code` is the CEPT `article_type`; only bookable parcel codes are listed.
export const INDIA_POST_SERVICES = [
  {
    code: "SP_INLAND_PARCEL",
    label: "Speed Post Parcel Domestic",
    description: "SP Inland Parcel",
  },
  {
    code: "BUSINESS_PARCEL",
    label: "Business Parcel",
    description: "India Post Parcel Contractual (CX)",
  },
] as const;

export type IndiaPostServiceCode = (typeof INDIA_POST_SERVICES)[number]["code"];

export const DEFAULT_INDIA_POST_SERVICE: IndiaPostServiceCode = "SP_INLAND_PARCEL";

/** Labels for codes that may still appear on older shipments. */
const LEGACY_INDIA_POST_SERVICE_LABELS: Record<string, string> = {
  SP_INLAND_DOC: "Speed Post document",
};

export function indiaPostServiceLabel(code?: string | null) {
  if (!code) return "—";
  return (
    INDIA_POST_SERVICES.find((service) => service.code === code)?.label ??
    LEGACY_INDIA_POST_SERVICE_LABELS[code] ??
    code
  );
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
  "vachat-notify",
  "invoice-generation",
  "support-ingest",
] as const;
export type JobType = (typeof JOB_TYPES)[number];

export const INVENTORY_MOVEMENT_REASONS = [
  "OPENING",
  "ADJUSTMENT",
  "ORDER_RESERVE",
  "ORDER_COMMIT",
  "ORDER_RELEASE",
  "RTO_RETURN",
] as const;
export type InventoryMovementReason = (typeof INVENTORY_MOVEMENT_REASONS)[number];

export type Permission =
  | "org.manage"
  | "org.billing"
  | "members.manage"
  | "orders.read"
  | "orders.write"
  | "products.read"
  | "products.write"
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
  | "settings.manage"
  | "support.read"
  | "support.reply"
  | "support.assign"
  | "support.manage"
  | "support.settings";

export const SUPPORT_TICKET_STATUSES = [
  "open",
  "in_progress",
  "pending_customer",
  "pending_merchant",
  "resolved",
  "closed",
  "reopened",
] as const;
export type SupportTicketStatus = (typeof SUPPORT_TICKET_STATUSES)[number];

export const SUPPORT_TICKET_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type SupportTicketPriority = (typeof SUPPORT_TICKET_PRIORITIES)[number];

export const SUPPORT_TICKET_CATEGORIES = [
  "order_cancellation",
  "product_return",
  "product_exchange",
  "refund_request",
  "delivery_issue",
  "damaged_product",
  "wrong_product",
  "missing_product",
  "general_inquiry",
  "other",
] as const;
export type SupportTicketCategory = (typeof SUPPORT_TICKET_CATEGORIES)[number];

export const SUPPORT_WORKFLOW_KINDS = ["cancellation", "return", "exchange"] as const;
export type SupportWorkflowKind = (typeof SUPPORT_WORKFLOW_KINDS)[number];

export const CANCELLATION_WORKFLOW_STATUSES = [
  "requested",
  "under_review",
  "approved",
  "rejected",
  "needs_info",
  "completed",
  "cancelled",
] as const;
export type CancellationWorkflowStatus = (typeof CANCELLATION_WORKFLOW_STATUSES)[number];

export const RETURN_WORKFLOW_STATUSES = [
  "requested",
  "under_review",
  "approved",
  "rejected",
  "needs_info",
  "awaiting_return_shipment",
  "return_in_transit",
  "return_received",
  "inspection",
  "refund_decision",
  "exchange_decision",
  "completed",
  "cancelled",
  "expired",
  "failed",
] as const;
export type ReturnWorkflowStatus = (typeof RETURN_WORKFLOW_STATUSES)[number];

export const EXCHANGE_WORKFLOW_STATUSES = [
  "requested",
  "under_review",
  "approved",
  "rejected",
  "needs_info",
  "awaiting_return",
  "replacement_ready",
  "replacement_booked",
  "completed",
  "cancelled",
  "failed",
] as const;
export type ExchangeWorkflowStatus = (typeof EXCHANGE_WORKFLOW_STATUSES)[number];

export const SUPPORT_TICKET_STATUS_LABELS: Record<SupportTicketStatus, string> = {
  open: "Open",
  in_progress: "In Progress",
  pending_customer: "Pending Customer",
  pending_merchant: "Pending Merchant",
  resolved: "Resolved",
  closed: "Closed",
  reopened: "Reopened",
};

export const SUPPORT_TICKET_PRIORITY_LABELS: Record<SupportTicketPriority, string> = {
  low: "Low",
  normal: "Normal",
  high: "High",
  urgent: "Urgent",
};

export const SUPPORT_TICKET_CATEGORY_LABELS: Record<SupportTicketCategory, string> = {
  order_cancellation: "Order Cancellation",
  product_return: "Product Return",
  product_exchange: "Product Exchange",
  refund_request: "Refund Request",
  delivery_issue: "Delivery Issue",
  damaged_product: "Damaged Product",
  wrong_product: "Wrong Product",
  missing_product: "Missing Product",
  general_inquiry: "General Inquiry",
  other: "Other",
};
