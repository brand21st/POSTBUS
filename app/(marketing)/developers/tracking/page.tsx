import type { Metadata } from "next";
import { DocsHeader, DocsSection, Endpoint, InlineCode, Note } from "@/app/(marketing)/developers/docs-ui";
import { marketingMetadata } from "@/lib/seo/metadata";

export const metadata: Metadata = marketingMetadata({
  title: "Tracking API",
  description: "Read cached PostBus tracking events. Polling India Post on every request is not supported.",
  path: "/developers/tracking",
});

export default function TrackingDocsPage() {
  return (
    <>
      <DocsHeader
        kicker="REST"
        title="Tracking"
        description="Read cached events from PostBus. Prefer webhooks for live updates instead of polling India Post."
      />

      <Endpoint
        method="GET"
        path="/api/merchant/v1/shipments/{shipmentId}/tracking"
        scope="tracking:read"
        purpose="Cached events. Stale data may enqueue a background refresh (older than 15 minutes)."
      />

      <DocsSection title="Public page">
        <p>
          Shareable URL: <InlineCode>https://www.postbus.in/track?tracking=AWB</InlineCode>
        </p>
      </DocsSection>

      <Note tone="ok" title="Preferred live path">
        Subscribe to <InlineCode>tracking.updated</InlineCode>, <InlineCode>shipment.out_for_delivery</InlineCode>, and{" "}
        <InlineCode>shipment.delivered</InlineCode>.
      </Note>
    </>
  );
}
