import type { Metadata } from "next";
import { marketingMetadata } from "@/lib/seo/metadata";

export const metadata: Metadata = marketingMetadata({
  title: "Tracking API",
  description: "Read cached PostBus tracking events. Polling India Post on every request is not supported.",
  path: "/developers/tracking",
});

export default function TrackingDocsPage() {
  return (
    <>
      <h1>Tracking</h1>
      <p>
        <code>GET /shipments/{`{id}`}/tracking</code> reads cached events. Stale data may enqueue a background refresh.
        Preferred live updates: subscribe to <code>tracking.updated</code>, <code>shipment.out_for_delivery</code>, and{" "}
        <code>shipment.delivered</code>.
      </p>
      <p>
        Public tracking URL format: <code>https://www.postbus.in/track?tracking=AWB</code>.
      </p>
    </>
  );
}
