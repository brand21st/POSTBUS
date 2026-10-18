import type { Metadata } from "next";
import { marketingMetadata } from "@/lib/seo/metadata";

export const metadata: Metadata = marketingMetadata({
  title: "PostBus webhooks",
  description: "Signed outbound events, HMAC construction, retries, and subscription management.",
  path: "/developers/webhooks",
});

export default function WebhooksDocsPage() {
  return (
    <>
      <h1>Webhooks</h1>
      <p>PostBus POSTs a versioned envelope to your HTTPS URL after order and shipment writes commit.</p>
      <pre>
        <code>{`canonical = timestamp + "." + event_id + "." + raw_body
X-PostBus-Signature: v1=<hex hmac-sha256(secret, canonical)>`}</code>
      </pre>
      <p>Headers: X-PostBus-Event-Id, X-PostBus-Event-Type, X-PostBus-Timestamp, X-PostBus-Signature.</p>
      <p>
        Reject timestamps older than five minutes. Compare signatures in constant time. Deduplicate on{" "}
        <code>id</code>. Delivery is at-least-once, never exactly-once.
      </p>
      <p>
        Node.js verification:
      </p>
      <pre>
        <code>{`const crypto = require("crypto");
function verify(secret, timestamp, eventId, rawBody, header) {
  const expected = crypto.createHmac("sha256", secret)
    .update(timestamp + "." + eventId + "." + rawBody)
    .digest("hex");
  const provided = String(header || "").replace(/^v1=/, "");
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
}`}</code>
      </pre>
      <p>
        Python:
      </p>
      <pre>
        <code>{`import hmac, hashlib
def verify(secret, timestamp, event_id, raw_body, header):
    expected = hmac.new(secret.encode(), f"{timestamp}.{event_id}.{raw_body}".encode(), hashlib.sha256).hexdigest()
    provided = header.replace("v1=", "")
    return hmac.compare_digest(expected, provided)`}</code>
      </pre>
    </>
  );
}
