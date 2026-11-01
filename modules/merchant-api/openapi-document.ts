export const MERCHANT_V1_ROUTES = [
  { method: "GET", path: "/me" },
  { method: "GET", path: "/meta/schema" },
  { method: "POST", path: "/orders" },
  { method: "POST", path: "/orders/bulk" },
  { method: "GET", path: "/orders" },
  { method: "GET", path: "/orders/{orderId}" },
  { method: "PATCH", path: "/orders/{orderId}" },
  { method: "POST", path: "/orders/{orderId}/book" },
  { method: "GET", path: "/shipments" },
  { method: "GET", path: "/shipments/{shipmentId}" },
  { method: "GET", path: "/shipments/{shipmentId}/tracking" },
  { method: "GET", path: "/shipments/{shipmentId}/label" },
  { method: "GET", path: "/webhook-subscriptions" },
  { method: "POST", path: "/webhook-subscriptions" },
  { method: "GET", path: "/webhook-subscriptions/{subscriptionId}" },
  { method: "PATCH", path: "/webhook-subscriptions/{subscriptionId}" },
  { method: "DELETE", path: "/webhook-subscriptions/{subscriptionId}" },
  { method: "GET", path: "/webhook-subscriptions/{subscriptionId}/deliveries" },
  { method: "POST", path: "/webhook-subscriptions/{subscriptionId}/test" },
  { method: "POST", path: "/webhook-subscriptions/{subscriptionId}/rotate-secret" },
  { method: "POST", path: "/webhook-subscriptions/{subscriptionId}/deliveries/{deliveryId}/retry" },
] as const;

export function merchantOpenApiDocument() {
  return {
    openapi: "3.1.0",
    info: {
      title: "PostBus Merchant API",
      version: "v1",
      description:
        "Public merchant API for PostBus. Authenticate with a scoped organization API key. Creating an order does not book India Post. Webhook delivery is at-least-once and must be deduplicated by event id. Outbound webhooks are sent only for organizations on MERCHANT_WEBHOOKS_ORG_ALLOWLIST.",
    },
    servers: [{ url: "https://www.postbus.in/api/merchant/v1", description: "Production" }],
    security: [{ bearerAuth: [] }],
    tags: [{ name: "Discovery" }, { name: "Orders" }, { name: "Shipments" }, { name: "Webhooks" }],
    paths: buildPaths(),
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "pb_live_<lookup>_<secret>" },
      },
      schemas: {
        ErrorEnvelope: {
          type: "object",
          required: ["success", "error", "meta"],
          properties: {
            success: { const: false },
            error: {
              type: "object",
              required: ["code", "message"],
              properties: {
                code: {
                  type: "string",
                  enum: [
                    "INVALID_API_KEY",
                    "API_KEY_REVOKED",
                    "API_KEY_EXPIRED",
                    "INSUFFICIENT_SCOPE",
                    "MERCHANT_API_DISABLED",
                    "RESOURCE_NOT_FOUND",
                    "VALIDATION_ERROR",
                    "DUPLICATE_ORDER",
                    "IDEMPOTENCY_CONFLICT",
                    "BOOKING_NOT_ALLOWED",
                    "RATE_LIMIT_EXCEEDED",
                    "UPSTREAM_SERVICE_UNAVAILABLE",
                    "INTERNAL_ERROR",
                  ],
                },
                message: { type: "string" },
              },
            },
            meta: {
              type: "object",
              properties: {
                request_id: { type: "string" },
                api_version: { const: "v1" },
              },
            },
          },
        },
        WebhookEnvelope: {
          type: "object",
          required: ["id", "type", "api_version", "created_at", "data"],
          properties: {
            id: { type: "string", examples: ["evt_00000000-0000-4000-8000-000000000000"] },
            type: {
              type: "string",
              enum: [
                "order.created",
                "order.updated",
                "shipment.booking_requested",
                "shipment.booked",
                "shipment.booking_failed",
                "tracking.updated",
                "shipment.out_for_delivery",
                "shipment.delivered",
                "shipment.exception",
                "webhook.test",
              ],
            },
            api_version: { const: "2026-10-18" },
            created_at: { type: "string", format: "date-time" },
            data: { type: "object", additionalProperties: { type: "string" } },
          },
        },
      },
    },
    webhooks: {
      postbusEvent: {
        post: {
          summary: "Signed PostBus event",
          description:
            "PostBus POSTs the WebhookEnvelope. Signature is hex HMAC-SHA256 of timestamp + '.' + event id + '.' + raw body, sent as X-PostBus-Signature: v1=<hex>. Compare in constant time. Reject timestamps older than 5 minutes. Deduplicate on id.",
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/WebhookEnvelope" } } },
          },
          responses: { "200": { description: "Acknowledge receipt." } },
        },
      },
    },
  };
}

function yamlScalar(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "string") {
    if (value === "" || /[:#{}[\],&*!|>'"%@`]|^\s|\s$/.test(value) || value.includes("\n")) return JSON.stringify(value);
    return value;
  }
  return JSON.stringify(value);
}

function toYaml(value: unknown, indent = 0): string {
  const pad = "  ".repeat(indent);
  if (Array.isArray(value)) {
    if (!value.length) return " []";
    return value
      .map((item) => {
        if (item && typeof item === "object") return `\n${pad}- ${toYaml(item, indent + 1).trimStart()}`;
        return `\n${pad}- ${yamlScalar(item)}`;
      })
      .join("");
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (!entries.length) return " {}";
    return entries
      .map(([key, item]) => {
        if (item && typeof item === "object") return `\n${pad}${key}:${toYaml(item, indent + 1)}`;
        return `\n${pad}${key}: ${yamlScalar(item)}`;
      })
      .join("");
  }
  return ` ${yamlScalar(value)}`;
}

export function merchantOpenApiYaml() {
  return `${toYaml(merchantOpenApiDocument()).trimStart()}\n`;
}

function buildPaths() {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const route of MERCHANT_V1_ROUTES) {
    const operation = route.method.toLowerCase();
    paths[route.path] ??= {};
    const tag = route.path.includes("webhook")
      ? "Webhooks"
      : route.path.includes("shipment") || route.path.endsWith("/book")
        ? "Shipments"
        : route.path.includes("order")
          ? "Orders"
          : "Discovery";
    paths[route.path][operation] = {
      tags: [tag],
      summary: `${route.method} ${route.path}`,
      responses: {
        "200": { description: "Success envelope. GET /shipments/{shipmentId}/label returns application/pdf." },
        "401": { description: "Missing or invalid API key." },
        "403": { description: "Insufficient scope or Merchant API disabled for this workspace." },
      },
    };
  }
  return paths;
}
