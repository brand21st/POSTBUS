import { MERCHANT_API_SCOPES, MERCHANT_API_VERSION } from "@/modules/merchant-api/scopes";
import { MERCHANT_BULK_MAX_ROWS, MERCHANT_PAGE_MAX, MERCHANT_RATE_LIMITS } from "@/modules/merchant-api/rate-limit";

export const MERCHANT_PUBLIC_CAPABILITIES = [
  "orders.create",
  "orders.bulk",
  "orders.read",
  "orders.update_pre_booking",
  "shipments.book",
  "shipments.read",
  "tracking.read",
  "labels.read",
  "webhooks.read",
  "webhooks.manage",
] as const;

export function merchantPublicSchema() {
  return {
    api_version: MERCHANT_API_VERSION,
    authentication: {
      type: "http",
      scheme: "bearer",
      header: "Authorization",
      key_format: "pb_live_<lookup>_<secret>",
    },
    scopes: [...MERCHANT_API_SCOPES],
    limits: {
      bulk_max_rows: MERCHANT_BULK_MAX_ROWS,
      page_max: MERCHANT_PAGE_MAX,
      rate_limits: MERCHANT_RATE_LIMITS,
      idempotency_ttl_hours: 72,
    },
    resources: {
      order: {
        operations: ["create", "bulk", "list", "get", "patch"],
        fields: [
          { name: "id", type: "uuid", required: false, writable: false, read_only: true },
          { name: "order_number", type: "string", required: false, writable: false, read_only: true },
          { name: "external_order_id", type: "string", required: false, writable: true, max_length: 120 },
          { name: "source", type: "string", required: false, writable: false, allowed: ["API"], read_only: true },
          {
            name: "status",
            type: "string",
            required: false,
            writable: false,
            allowed: [
              "IMPORTED",
              "READY",
              "PROCESSING",
              "BOOKED",
              "SHIPPED",
              "IN_TRANSIT",
              "DELIVERED",
              "FAILED",
              "CANCELLED",
            ],
            read_only: true,
          },
          { name: "customer.name", type: "string", required: true, writable: true, min_length: 2 },
          { name: "customer.phone", type: "string", required: true, writable: true, rules: "10-digit Indian mobile" },
          { name: "customer.email", type: "string", required: false, writable: true },
          { name: "shipping_address.line1", type: "string", required: true, writable: true },
          { name: "shipping_address.city", type: "string", required: true, writable: true },
          { name: "shipping_address.state", type: "string", required: true, writable: true },
          { name: "shipping_address.pincode", type: "string", required: true, writable: true, pattern: "^\\d{6}$" },
          { name: "line_items[].title", type: "string", required: "if product_id omitted", writable: true },
          { name: "line_items[].quantity", type: "integer", required: true, writable: true, min: 1 },
          { name: "payment_status", type: "string", required: false, writable: true, allowed: ["PENDING", "PAID", "PARTIAL", "COD", "REFUNDED", "FAILED"] },
          { name: "parcel_weight_grams", type: "integer", required: false, writable: true, notes: "Locked after booking" },
        ],
      },
      shipment: {
        operations: ["book", "list", "get", "tracking", "label"],
        fields: [
          { name: "id", type: "uuid", read_only: true },
          { name: "status", type: "string", read_only: true, notes: "QUEUED/BOOKING until India Post confirms BOOKED" },
          { name: "barcode", type: "string", read_only: true },
          { name: "tracking_url", type: "string", read_only: true },
        ],
      },
    },
  };
}

export function merchantIdentity(ctx: {
  apiKeyId: string;
  keyPrefix: string;
  organizationName: string;
  scopes: string[];
}) {
  return {
    api_key: { id: ctx.apiKeyId, prefix: ctx.keyPrefix },
    organization: { name: ctx.organizationName },
    scopes: ctx.scopes,
    api_version: MERCHANT_API_VERSION,
    capabilities: [...MERCHANT_PUBLIC_CAPABILITIES],
  };
}
