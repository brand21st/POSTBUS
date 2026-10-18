import type { Metadata } from "next";
import { marketingMetadata } from "@/lib/seo/metadata";

export const metadata: Metadata = marketingMetadata({
  title: "Orders API",
  description: "Create, list, get, patch, and bulk-import PostBus orders. Booking is a separate call.",
  path: "/developers/orders",
});

export default function OrdersDocsPage() {
  return (
    <>
      <h1>Orders</h1>
      <p>
        <code>POST /orders</code> and <code>POST /orders/bulk</code> require <code>orders:write</code> and{" "}
        <code>Idempotency-Key</code>. Source is always <code>API</code>. Status after create is typically{" "}
        <code>READY</code>.
      </p>
      <p>
        There is no <code>DELETE /orders</code>. Patch is allowed before booking for address and weights.
      </p>
      <pre>
        <code>{`curl -X POST "https://www.postbus.in/api/merchant/v1/orders" \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Idempotency-Key: YOUR_IDEMPOTENCY_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "external_order_id": "ERP-1001",
    "customer": { "name": "Asha Rao", "phone": "9876543210" },
    "shipping_address": {
      "line1": "12 MG Road",
      "city": "Bengaluru",
      "state": "KA",
      "pincode": "560001"
    },
    "line_items": [{ "title": "Notebook", "quantity": 1, "unit_price": 199 }]
  }'`}</code>
      </pre>
    </>
  );
}
