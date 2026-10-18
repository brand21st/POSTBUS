import type { Metadata } from "next";
import { marketingMetadata } from "@/lib/seo/metadata";

export const metadata: Metadata = marketingMetadata({
  title: "Merchant API quick start",
  description: "Create a PostBus account, mint an API key, create an order, then book India Post in a separate call.",
  path: "/developers/quickstart",
});

export default function QuickStartPage() {
  return (
    <>
      <h1>Quick start</h1>
      <ol>
        <li>Create a PostBus merchant account.</li>
        <li>Open Dashboard → Integrations → Developer API.</li>
        <li>Generate a scoped API key. Copy the secret once.</li>
        <li>
          Call identity:
          <pre>
            <code>{`curl -X GET "https://www.postbus.in/api/merchant/v1/me" \\
  -H "Authorization: Bearer YOUR_API_KEY"`}</code>
          </pre>
        </li>
        <li>
          Create an order with <code>Idempotency-Key</code>. This does not book India Post.
        </li>
        <li>Retrieve the order, then <code>{"POST /orders/{id}/book"}</code> when you are ready.</li>
        <li>Poll shipments until status is <code>BOOKED</code> and an AWB exists.</li>
        <li>Register a webhook endpoint to receive signed shipment events.</li>
      </ol>
      <p>If you receive <code>MERCHANT_API_DISABLED</code>, the workspace is not on the API allowlist yet.</p>
    </>
  );
}
