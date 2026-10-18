const GUARDRAIL = `Use only implemented and documented PostBus endpoints.

Do not invent API fields, permissions, or undocumented behavior.

Base URL: https://www.postbus.in/api/merchant/v1
Auth: Authorization: Bearer <MERCHANT_API_KEY>
Never log, print, or hard-code the API key.
Do not send organization_id. Tenant identity comes from the key.
Creating an order does not book India Post. Booking is POST /orders/{orderId}/book and returns a queued shipment.
BOOKED exists only after PostBus stores India Post confirmation.
Idempotency-Key is required on POST /orders, POST /orders/bulk, and POST /orders/{orderId}/book.
Webhook signature: HMAC-SHA256 of timestamp + "." + event_id + "." + raw body, header X-PostBus-Signature: v1=<hex>.
Deduplicate webhook events on envelope id. Delivery is at-least-once.
There is no native Zapier, Make, n8n, CRM, or ERP plugin. Use HTTPS plus webhooks.
There is no DELETE /orders endpoint.
Do not include real API keys in generated code.`;

function sheetsPrompt() {
  return `I want to connect my Google Sheet with PostBus.

I have attached the official PostBus Merchant API documentation (OpenAPI and API reference).

${GUARDRAIL}

Store the key in Apps Script PropertiesService. Never put the key in sheet cells or logs.

My Google Sheet contains columns that may not match PostBus field names. Create a configuration object that maps my column headers to the documented PostBus fields.

Typical columns I may have:
Customer Name
Phone Number
Full Address
City
State
Pincode
Product Name
Order Amount
COD Amount
Weight

Please create a Google Apps Script that:

1. Reads rows from my Google Sheet.
2. Maps my custom columns to the documented PostBus API schema.
3. Validates required fields.
4. Creates orders through POST /api/merchant/v1/orders with source implied as API.
5. Sends Idempotency-Key on create and book requests.
6. Uses a stable external_order_id per row (not the sheet row number after sorting).
7. Stores PostBus Order ID on the row.
8. Books only when I explicitly run the book function (POST /api/merchant/v1/orders/{orderId}/book). Do not auto-book on create.
9. Retrieves shipment AWB after booking via GET /api/merchant/v1/shipments or order payload.
10. Retrieves tracking via GET /api/merchant/v1/shipments/{shipmentId}/tracking.
11. Stores tracking URL on the sheet.
12. Optionally registers a webhook with POST /api/merchant/v1/webhook-subscriptions if I provide a public HTTPS URL, otherwise poll tracking.
13. Handles API errors, HTTP 429 Retry-After, and retries safely with exponential backoff.
14. Uses LockService so overlapping time-driven triggers cannot double-run.
15. Distinguishes statuses using PostBus enums only:
    Order: IMPORTED, READY, PROCESSING, BOOKED, SHIPPED, IN_TRANSIT, DELIVERED, FAILED, CANCELLED
    Shipment: QUEUED / BOOKING mean booking requested, not physical BOOKED.
    BOOKED only after India Post confirmation stored by PostBus.
16. Does not invent unsupported API methods or fields.`;
}

function crmPrompt() {
  return `I am integrating a custom CRM with PostBus using Merchant API v1.

${GUARDRAIL}

Build a CRM adapter that:
1. Creates a PostBus order when a CRM shipping order is confirmed (POST /orders) with external_order_id equal to the CRM order id.
2. Stores PostBus order id and order_number on the CRM record.
3. Books only after an operator or workflow step calls POST /orders/{id}/book.
4. Registers HTTPS webhooks for shipment.booked, tracking.updated, shipment.out_for_delivery, shipment.delivered, and shipment.booking_failed.
5. Verifies X-PostBus-Signature and timestamp, then updates CRM status from envelope.data.status.
6. Never posts API keys from the browser. All calls are server-side.`;
}

function erpPrompt() {
  return `I am integrating a custom ERP with PostBus using Merchant API v1.

${GUARDRAIL}

Build an ERP adapter that:
1. Bulk-imports orders with POST /orders/bulk (max 25 rows) using a stable external_order_id.
2. Maps ERP document numbers to PostBus order_id.
3. Requests booking with POST /orders/{id}/book and polls GET /shipments until AWB exists. Do not treat QUEUED as booked.
4. Syncs AWB and tracking_url back to the ERP shipment document.
5. Subscribes to shipment.booked, shipment.booking_failed, tracking.updated, shipment.delivered, and shipment.exception.
6. Reconciles missed webhooks with GET /orders?updated_since= and GET /shipments?updated_since=.
7. Retries failed webhook deliveries with POST /webhook-subscriptions/{id}/deliveries/{deliveryId}/retry when needed.`;
}

function customAppPrompt() {
  return `I am building a custom website or SaaS that ships through PostBus.

${GUARDRAIL}

Provide Node.js and Python examples that:
1. Authenticate with a Bearer merchant key stored in environment variables.
2. Create an order, retrieve it, request booking, list shipments, fetch tracking, and download a label.
3. Register a webhook subscription and verify signatures.
4. Handle MERCHANT_API_DISABLED, INSUFFICIENT_SCOPE, RATE_LIMIT_EXCEEDED, and IDEMPOTENCY_CONFLICT.
5. Keep credentials off the client.`;
}

export function merchantAiIntegrationPrompt(kind: string = "sheets") {
  if (kind === "crm") return crmPrompt();
  if (kind === "erp") return erpPrompt();
  if (kind === "app" || kind === "custom") return customAppPrompt();
  if (kind === "all") {
    return { sheets: sheetsPrompt(), crm: crmPrompt(), erp: erpPrompt(), custom: customAppPrompt() };
  }
  return sheetsPrompt();
}
