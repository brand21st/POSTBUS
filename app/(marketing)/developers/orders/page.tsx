import type { Metadata } from "next";
import { CodeBlock } from "@/app/(marketing)/developers/docs-code";
import { DocsHeader, DocsSection, Endpoint, InlineCode, Note } from "@/app/(marketing)/developers/docs-ui";
import { marketingMetadata } from "@/lib/seo/metadata";

export const metadata: Metadata = marketingMetadata({
  title: "Orders API",
  description: "Create, list, get, patch, and bulk-import PostBus orders. Booking is a separate call.",
  path: "/developers/orders",
});

export default function OrdersDocsPage() {
  return (
    <>
      <DocsHeader
        kicker="REST"
        title="Orders"
        description="Create and sync PostBus orders from CRM, ERP, Sheets, or a custom app. Booking India Post is never implied by create."
      />

      <div className="space-y-3">
        <Endpoint method="POST" path="/api/merchant/v1/orders" scope="orders:write" purpose="Create. Requires Idempotency-Key. Status after create is typically READY." />
        <Endpoint method="POST" path="/api/merchant/v1/orders/bulk" scope="orders:write" purpose="Max 25 rows. Failed rows are included in the response." />
        <Endpoint method="GET" path="/api/merchant/v1/orders" scope="orders:read" purpose="Filter with updated_since, status, limit, cursor. Stable order (updated_at, id)." />
        <Endpoint method="GET" path="/api/merchant/v1/orders/{orderId}" scope="orders:read" purpose="404 if the order is not in the key’s organization." />
        <Endpoint method="PATCH" path="/api/merchant/v1/orders/{orderId}" scope="orders:write" purpose="Address and weights only. Locked after India Post booking (409)." />
      </div>

      <DocsSection title="Required fields">
        <p>
          <InlineCode>customer.name</InlineCode>, Indian 10-digit <InlineCode>customer.phone</InlineCode>,{" "}
          <InlineCode>shipping_address.line1</InlineCode>, <InlineCode>city</InlineCode>, <InlineCode>state</InlineCode>,{" "}
          <InlineCode>pincode</InlineCode> (6 digits), and <InlineCode>line_items</InlineCode> (each needs quantity and
          title or product_id).
        </p>
        <p>
          Optional: <InlineCode>external_order_id</InlineCode>, email, billing address, payment fields, metadata,{" "}
          <InlineCode>india_post_service</InlineCode>.
        </p>
      </DocsSection>

      <DocsSection title="Create example">
        <CodeBlock
          samples={[
            {
              label: "cURL",
              code: `curl -X POST "https://www.postbus.in/api/merchant/v1/orders" \\
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
  }'`,
            },
          ]}
        />
      </DocsSection>

      <Note title="No DELETE">There is no DELETE /orders. Use dashboard workflows for cancellation after import.</Note>
    </>
  );
}
