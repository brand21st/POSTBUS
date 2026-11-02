import type { Metadata } from "next";
import { CodeBlock } from "@/app/(marketing)/developers/docs-code";
import { DocsHeader, DocsSection, Endpoint, InlineCode, Note } from "@/app/(marketing)/developers/docs-ui";
import { marketingMetadata } from "@/lib/seo/metadata";
import { MERCHANT_V1_ROUTES } from "@/modules/merchant-api/openapi-document";

export const metadata: Metadata = marketingMetadata({
  title: "Merchant API reference",
  description: "Implemented PostBus Merchant API v1 endpoints, errors, rate limits, and idempotency.",
  path: "/developers/api-reference",
});

const META: Record<string, { scope: string; purpose: string }> = {
  "GET /me": { scope: "any", purpose: "Key prefix, organization name, scopes, and capabilities. Never returns the secret." },
  "GET /meta/schema": { scope: "any", purpose: "Curated field contract, limits, and allowed values. Not the PostgreSQL schema." },
  "POST /orders": { scope: "orders:write", purpose: "Create an order with source API. Does not book India Post." },
  "POST /orders/bulk": { scope: "orders:write", purpose: "Import up to 25 rows. Returns per-row success or error." },
  "GET /orders": { scope: "orders:read", purpose: "List orders. Query updated_since, status, limit (max 100), cursor." },
  "GET /orders/{orderId}": { scope: "orders:read", purpose: "Fetch one order in the key’s organization." },
  "PATCH /orders/{orderId}": { scope: "orders:write", purpose: "Address and weights only, before booking." },
  "POST /orders/{orderId}/book": { scope: "shipments:book", purpose: "Enqueue India Post booking. 202 queued is not BOOKED." },
  "GET /shipments": { scope: "shipments:read", purpose: "List shipments for the organization." },
  "GET /shipments/{shipmentId}": { scope: "shipments:read", purpose: "Fetch one shipment." },
  "GET /shipments/{shipmentId}/tracking": { scope: "tracking:read", purpose: "Cached tracking events. May enqueue a refresh." },
  "GET /shipments/{shipmentId}/label": { scope: "labels:read", purpose: "Authenticated PDF. 404 until a label file exists." },
  "GET /webhook-subscriptions": { scope: "webhooks:read", purpose: "List outbound webhook subscriptions." },
  "POST /webhook-subscriptions": { scope: "webhooks:manage", purpose: "Create an HTTPS subscription. Secret shown once." },
  "GET /webhook-subscriptions/{subscriptionId}": { scope: "webhooks:read", purpose: "Fetch one subscription." },
  "PATCH /webhook-subscriptions/{subscriptionId}": { scope: "webhooks:manage", purpose: "Update URL, events, or enabled state." },
  "DELETE /webhook-subscriptions/{subscriptionId}": { scope: "webhooks:manage", purpose: "Disable the subscription. History is kept." },
  "GET /webhook-subscriptions/{subscriptionId}/deliveries": { scope: "webhooks:read", purpose: "Recent delivery attempts." },
  "POST /webhook-subscriptions/{subscriptionId}/test": { scope: "webhooks:manage", purpose: "Send a webhook.test event." },
  "POST /webhook-subscriptions/{subscriptionId}/rotate-secret": { scope: "webhooks:manage", purpose: "Rotate the signing secret. Shown once." },
  "POST /webhook-subscriptions/{subscriptionId}/deliveries/{deliveryId}/retry": {
    scope: "webhooks:manage",
    purpose: "Retry a failed delivery.",
  },
};

const SUCCESS = `{
  "success": true,
  "data": {},
  "meta": { "request_id": "uuid", "api_version": "v1" }
}`;

const ERROR = `{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "details": [{ "field": "shipping_address.pincode", "message": "Invalid" }]
  },
  "meta": { "request_id": "uuid", "api_version": "v1" }
}`;

export default function ApiReferencePage() {
  return (
    <>
      <DocsHeader
        kicker="Contract"
        title="API reference"
        description="Implemented Merchant API v1 only. Machine-readable copies are published as OpenAPI 3.1."
      />

      <p className="mb-8 text-sm text-zinc-600">
        Spec:{" "}
        <a className="font-medium text-brand hover:text-brand-dark" href="/developers/openapi.json">
          openapi.json
        </a>
        {" · "}
        <a className="font-medium text-brand hover:text-brand-dark" href="/developers/openapi.yaml">
          openapi.yaml
        </a>
      </p>

      <DocsSection title="Success envelope">
        <p>JSON responses use this shape. Label download returns application/pdf instead.</p>
        <CodeBlock samples={[{ label: "JSON", code: SUCCESS }]} />
      </DocsSection>

      <DocsSection title="Error envelope">
        <div className="flex flex-wrap gap-1.5">
          {[
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
          ].map((code) => (
            <InlineCode key={code}>{code}</InlineCode>
          ))}
        </div>
        <CodeBlock samples={[{ label: "JSON", code: ERROR }]} />
      </DocsSection>

      <DocsSection title="Idempotency">
        <p>
          <InlineCode>Idempotency-Key</InlineCode> is required on create, bulk, and book. Retention is 72 hours. The same
          key with a different body returns <InlineCode>IDEMPOTENCY_CONFLICT</InlineCode>.{" "}
          <InlineCode>external_order_id</InlineCode> is unique per organization for source API.
        </p>
      </DocsSection>

      <DocsSection title="Endpoints">
        <div className="space-y-3">
          {MERCHANT_V1_ROUTES.map((route) => {
            const key = `${route.method} ${route.path}`;
            const meta = META[key];
            return (
              <Endpoint
                key={key}
                method={route.method}
                path={`/api/merchant/v1${route.path}`}
                scope={meta?.scope}
                purpose={meta?.purpose}
              />
            );
          })}
        </div>
      </DocsSection>

      <DocsSection title="Rate limits">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>120 requests/minute per API key</li>
          <li>300 requests/minute per organization</li>
          <li>30 booking posts/minute per key</li>
          <li>100 bulk rows counted per minute toward bulk quota</li>
          <li>20 invalid-key attempts/minute per IP</li>
          <li>Payload 256 KB (512 KB bulk)</li>
        </ul>
        <p>
          HTTP 429 includes <InlineCode>Retry-After</InlineCode>.
        </p>
      </DocsSection>

      <Note tone="info" title="Status enums">
        Orders: IMPORTED, READY, PROCESSING, BOOKED, SHIPPED, IN_TRANSIT, DELIVERED, FAILED, CANCELLED. A book response
        of QUEUED or BOOKING means the job was accepted, not that India Post confirmed.
      </Note>
    </>
  );
}
