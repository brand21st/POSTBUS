import type { Metadata } from "next";
import { marketingMetadata } from "@/lib/seo/metadata";

export const metadata: Metadata = marketingMetadata({
  title: "Shipments and booking API",
  description: "Request India Post booking asynchronously, then list shipments and download labels.",
  path: "/developers/shipments",
});

export default function ShipmentsDocsPage() {
  return (
    <>
      <h1>Shipments and booking</h1>
      <p>
        <code>POST /orders/{`{id}`}/book</code> requires <code>shipments:book</code>. It enqueues India Post booking
        and typically returns <code>QUEUED</code>. Do not treat that as physically booked.
      </p>
      <p>
        Labels exist only after PostBus stores a PDF. <code>GET /shipments/{`{id}`}/label</code> returns{" "}
        <code>application/pdf</code>.
      </p>
    </>
  );
}
