import type { Metadata } from "next";
import { CodeBlock } from "@/app/(marketing)/developers/docs-code";
import {
  DocsHeader,
  DocsSection,
  DocsTable,
  Endpoint,
  InlineCode,
  Note,
} from "@/app/(marketing)/developers/docs-ui";
import { marketingMetadata } from "@/lib/seo/metadata";

export const metadata: Metadata = marketingMetadata({
  title: "PostBus webhooks",
  description: "Signed outbound events, HMAC construction, retries, and subscription management.",
  path: "/developers/webhooks",
});

export default function WebhooksDocsPage() {
  return (
    <>
      <DocsHeader
        kicker="Events"
        title="Webhooks"
        description="After an order or shipment write commits, PostBus POSTs a versioned JSON envelope to your HTTPS URL. Delivery is at-least-once. Deduplicate on envelope id."
      />

      <Note tone="info" title="Closed by default">
        Outbound webhooks are sent only when the organization is on the webhook allowlist. REST access is a separate
        allowlist. A workspace can call the Merchant API without receiving webhooks.
      </Note>

      <DocsSection title="How delivery works">
        <ol className="list-decimal space-y-2 pl-5">
          <li>A status-changing write commits in PostBus (order create, book queued, India Post booked, tracking scan, and so on).</li>
          <li>An outbox row is stored, then a worker fans it out to every active subscription that matches the event.</li>
          <li>
            PostBus POSTs the envelope with <InlineCode>User-Agent: PostBus-Webhooks/1.0</InlineCode> and the signature
            headers below. Timeout is 10 seconds. Redirects are not followed.
          </li>
          <li>Respond with HTTP 2xx as soon as you have persisted the event id. Do heavy CRM work after the response.</li>
        </ol>
      </DocsSection>

      <DocsSection title="Envelope">
        <p>
          REST responses use <InlineCode>api_version: v1</InlineCode>. Webhook envelopes use{" "}
          <InlineCode>2026-10-18</InlineCode>. Empty data fields are omitted.
        </p>
        <CodeBlock
          samples={[
            {
              label: "JSON",
              code: `{
  "id": "evt_00000000-0000-4000-8000-000000000000",
  "type": "shipment.booked",
  "api_version": "2026-10-18",
  "created_at": "2026-10-18T12:00:00.000Z",
  "data": {
    "order_id": "…",
    "order_number": "PB-…",
    "external_order_id": "ERP-1001",
    "shipment_id": "…",
    "awb": "…",
    "status": "BOOKED",
    "tracking_url": "https://www.postbus.in/track?tracking=…"
  }
}`,
            },
          ]}
        />
      </DocsSection>

      <DocsSection title="data fields">
        <DocsTable
          columns={["Field", "Present when"]}
          rows={[
            ["order_id", "Order or shipment event"],
            ["order_number", "PostBus order number is known"],
            ["external_order_id", "You supplied one on create"],
            ["shipment_id", "Shipment events and tracking"],
            ["awb", "After India Post confirmation"],
            ["status", "Current PostBus status, or NDR / RTO on shipment.exception"],
            ["previous_status", "Status-change events"],
            ["tracking_url", "Public track link when an AWB exists"],
            ["error_code", "Booking failure"],
          ]}
        />
      </DocsSection>

      <DocsSection title="Events">
        <DocsTable
          columns={["Type", "Emitted when"]}
          rows={[
            ["order.created", "Order row committed (API import, dashboard, or connected store)."],
            ["order.updated", "Order status actually changed. Same-status writes do not emit."],
            [
              "shipment.booking_requested",
              "Booking job queued. Alias shipment.created is accepted on subscribe and maps to this event.",
            ],
            ["shipment.booked", "India Post confirmed. AWB is in data.awb. Do not treat QUEUED as this event."],
            [
              "shipment.booking_failed",
              "Booking failed. Alias shipment.failed. Inspect data.error_code / data.status.",
            ],
            ["tracking.updated", "A new cached scan was stored. Prefer this over polling India Post."],
            ["shipment.out_for_delivery", "Status transitioned to OUT_FOR_DELIVERY."],
            [
              "shipment.delivered",
              "Operational status became DELIVERED. Not emitted for RTO_DELIVERED or other return statuses.",
            ],
            [
              "shipment.exception",
              "Operational status became NDR or RTO. data.status is NDR or RTO. This is not a database EXCEPTION row.",
            ],
            ["webhook.test", "POST …/test from the API or dashboard. Only that subscription receives it."],
          ]}
        />
        <Note title="Subscribe list">
          Omit <InlineCode>events</InlineCode> (or send an empty list) to receive every event except{" "}
          <InlineCode>webhook.test</InlineCode>. You cannot subscribe to <InlineCode>webhook.test</InlineCode> in the
          list; use the test endpoint.
        </Note>
      </DocsSection>

      <DocsSection title="Headers">
        <DocsTable
          columns={["Header", "Value"]}
          rows={[
            ["Content-Type", "application/json"],
            ["User-Agent", "PostBus-Webhooks/1.0"],
            ["X-PostBus-Event-Id", "Same as envelope.id. Deduplicate on this."],
            ["X-PostBus-Event-Type", "Canonical type, e.g. shipment.booked"],
            ["X-PostBus-Timestamp", "Unix time in milliseconds as a decimal string"],
            ["X-PostBus-Signature", "v1=<hex HMAC-SHA256>"],
          ]}
        />
      </DocsSection>

      <DocsSection title="Verify the signature">
        <p>
          Read the <strong>raw</strong> request body. Do not re-serialize JSON before hashing. Canonical string is{" "}
          <InlineCode>timestamp + "." + event_id + "." + raw_body</InlineCode>. HMAC-SHA256 with the subscription secret,
          hex digest, compared in constant time to the header without the <InlineCode>v1=</InlineCode> prefix.
        </p>
        <p>
          Reject if the timestamp is missing, not a number, or older/newer than five minutes. HTTPS destinations only.
          URLs cannot include credentials, localhost, <InlineCode>.local</InlineCode> / <InlineCode>.internal</InlineCode>{" "}
          hosts, or private / loopback / link-local IPs.
        </p>
        <CodeBlock
          samples={[
            {
              label: "Node.js",
              code: `const crypto = require("crypto");

function verifyPostBusWebhook(secret, timestamp, eventId, rawBody, header) {
  const age = Math.abs(Date.now() - Number(timestamp));
  if (!Number.isFinite(age) || age > 5 * 60 * 1000) return false;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(timestamp + "." + eventId + "." + rawBody)
    .digest("hex");
  const provided = String(header || "").replace(/^v1=/, "");
  if (expected.length !== provided.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
}

// Express: express.raw({ type: "application/json" })
app.post("/postbus-webhooks", (req, res) => {
  const rawBody = req.body.toString("utf8");
  const ok = verifyPostBusWebhook(
    process.env.POSTBUS_WEBHOOK_SECRET,
    req.get("X-PostBus-Timestamp"),
    req.get("X-PostBus-Event-Id"),
    rawBody,
    req.get("X-PostBus-Signature")
  );
  if (!ok) return res.status(401).end();
  const event = JSON.parse(rawBody);
  // persist event.id first, then 2xx, then update CRM
  res.status(200).json({ ok: true });
});`,
            },
            {
              label: "Python",
              code: `import hmac, hashlib, os, time
from flask import Flask, request

app = Flask(__name__)

def verify(secret, timestamp, event_id, raw_body, header):
    try:
        ts = int(timestamp)
    except (TypeError, ValueError):
        return False
    if abs(time.time() * 1000 - ts) > 5 * 60 * 1000:
        return False
    expected = hmac.new(
        secret.encode(),
        f"{timestamp}.{event_id}.{raw_body}".encode(),
        hashlib.sha256,
    ).hexdigest()
    provided = (header or "").replace("v1=", "")
    return hmac.compare_digest(expected, provided)

@app.post("/postbus-webhooks")
def inbound():
    raw = request.get_data(as_text=True)
    ok = verify(
        os.environ["POSTBUS_WEBHOOK_SECRET"],
        request.headers.get("X-PostBus-Timestamp"),
        request.headers.get("X-PostBus-Event-Id"),
        raw,
        request.headers.get("X-PostBus-Signature"),
    )
    if not ok:
        return ("", 401)
    return ("", 200)`,
            },
          ]}
        />
      </DocsSection>

      <DocsSection title="Retries">
        <p>
          HTTP 2xx marks the delivery <InlineCode>DELIVERED</InlineCode>. HTTP 408, 429, and 5xx are retried. Other 4xx
          fail permanently (fix your receiver). Redirects (3xx) are not followed and are retried, then fail. Network
          errors retry unless the URL is blocked.
        </p>
        <p>Up to 6 attempts. Backoff after failures: 1 minute, 5 minutes, 30 minutes, 2 hours, 8 hours.</p>
        <p>
          You can also <InlineCode>{"POST …/deliveries/{deliveryId}/retry"}</InlineCode> from the API or retry from
          Dashboard → Integrations → Developer API.
        </p>
        <Note tone="warn" title="At-least-once">
          The same <InlineCode>id</InlineCode> can arrive more than once. Store processed event ids and ignore
          duplicates. Never treat a retry as a second booking.
        </Note>
      </DocsSection>

      <DocsSection title="Create a subscription">
        <p>
          Scope <InlineCode>webhooks:manage</InlineCode>. The signing secret is returned only on create and rotate.
          Store it with the rest of your secrets.
        </p>
        <CodeBlock
          samples={[
            {
              label: "cURL",
              code: `curl -X POST "https://www.postbus.in/api/merchant/v1/webhook-subscriptions" \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "url": "https://crm.example.com/postbus-webhooks",
    "description": "Production CRM",
    "events": [
      "order.created",
      "shipment.booking_requested",
      "shipment.booked",
      "shipment.booking_failed",
      "tracking.updated",
      "shipment.out_for_delivery",
      "shipment.delivered",
      "shipment.exception"
    ]
  }'`,
            },
          ]}
        />
      </DocsSection>

      <DocsSection title="Management API">
        <div className="space-y-3">
          <Endpoint method="GET" path="/api/merchant/v1/webhook-subscriptions" scope="webhooks:read" purpose="List subscriptions. Secrets are never listed." />
          <Endpoint method="POST" path="/api/merchant/v1/webhook-subscriptions" scope="webhooks:manage" purpose="Create. Body: url (required), events, description. Secret shown once." />
          <Endpoint method="GET" path="/api/merchant/v1/webhook-subscriptions/{id}" scope="webhooks:read" />
          <Endpoint method="PATCH" path="/api/merchant/v1/webhook-subscriptions/{id}" scope="webhooks:manage" purpose="Update url, events, description, or enabled." />
          <Endpoint method="DELETE" path="/api/merchant/v1/webhook-subscriptions/{id}" scope="webhooks:manage" purpose="Disables the endpoint. Delivery history is kept." />
          <Endpoint method="GET" path="/api/merchant/v1/webhook-subscriptions/{id}/deliveries" scope="webhooks:read" purpose="Recent attempts. Query limit and cursor." />
          <Endpoint method="POST" path="/api/merchant/v1/webhook-subscriptions/{id}/test" scope="webhooks:manage" purpose="Enqueue webhook.test for that subscription only. HTTP 202." />
          <Endpoint method="POST" path="/api/merchant/v1/webhook-subscriptions/{id}/rotate-secret" scope="webhooks:manage" purpose="New secret, shown once. Update your receiver before or immediately after." />
          <Endpoint method="POST" path="/api/merchant/v1/webhook-subscriptions/{id}/deliveries/{deliveryId}/retry" scope="webhooks:manage" purpose="Re-queue a failed delivery. HTTP 202." />
        </div>
      </DocsSection>
    </>
  );
}
