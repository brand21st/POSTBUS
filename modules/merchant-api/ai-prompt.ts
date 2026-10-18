export function merchantAiIntegrationPrompt() {
  return `I want to connect my Google Sheet with PostBus.

I have attached the official PostBus Merchant API documentation (OpenAPI and API reference).

Use only the documented PostBus Merchant API v1 at /api/merchant/v1.

Authentication:
Authorization: Bearer <MERCHANT_API_KEY>
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
12. Handles API errors, HTTP 429 Retry-After, and retries safely with exponential backoff.
13. Uses LockService so overlapping time-driven triggers cannot double-run.
14. Distinguishes statuses using PostBus enums only:
    Order: IMPORTED, READY, PROCESSING, BOOKED, SHIPPED, IN_TRANSIT, DELIVERED, FAILED, CANCELLED
    Shipment: QUEUED / BOOKING mean booking requested, not physical BOOKED.
    BOOKED only after India Post confirmation stored by PostBus.
15. Does not invent unsupported API methods or fields.

Use only documented PostBus API endpoints.`;
}
