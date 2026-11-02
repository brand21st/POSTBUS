import type { Metadata } from "next";
import { CodeBlock } from "@/app/(marketing)/developers/docs-code";
import { DocsHeader, DocsSection, Endpoint, InlineCode, Note } from "@/app/(marketing)/developers/docs-ui";
import { marketingMetadata } from "@/lib/seo/metadata";

export const metadata: Metadata = marketingMetadata({
  title: "Shipments and booking API",
  description: "Request India Post booking asynchronously, then list shipments and download labels.",
  path: "/developers/shipments",
});

export default function ShipmentsDocsPage() {
  return (
    <>
      <DocsHeader
        kicker="REST"
        title="Booking and labels"
        description="Booking is asynchronous. Treat QUEUED as requested. BOOKED means India Post confirmed and an AWB exists."
      />

      <div className="space-y-3">
        <Endpoint method="POST" path="/api/merchant/v1/orders/{orderId}/book" scope="shipments:book" purpose="Enqueue India Post booking. Requires Idempotency-Key." />
        <Endpoint method="GET" path="/api/merchant/v1/shipments" scope="shipments:read" purpose="List shipments." />
        <Endpoint method="GET" path="/api/merchant/v1/shipments/{shipmentId}" scope="shipments:read" purpose="Fetch one shipment, including barcode when booked." />
        <Endpoint method="GET" path="/api/merchant/v1/shipments/{shipmentId}/label" scope="labels:read" purpose="Authenticated PDF after PostBus stores the file." />
      </div>

      <DocsSection title="Book">
        <p>
          Optional body: <InlineCode>weight_grams</InlineCode>, <InlineCode>length_cm</InlineCode>,{" "}
          <InlineCode>width_cm</InlineCode>, <InlineCode>height_cm</InlineCode>, <InlineCode>service_code</InlineCode>.
          Duplicate book returns the existing shipment.
        </p>
        <CodeBlock
          samples={[
            {
              label: "cURL",
              code: `curl -X POST "https://www.postbus.in/api/merchant/v1/orders/ORDER_ID/book" \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Idempotency-Key: erp-1001-book" \\
  -H "Content-Type: application/json" \\
  -d '{ "weight_grams": 500 }'`,
            },
          ]}
        />
      </DocsSection>

      <Note tone="warn" title="HTTP 202 is not physically booked">
        A response with state queued means a background job was accepted. Poll GET shipment until status is BOOKED.
      </Note>
    </>
  );
}
