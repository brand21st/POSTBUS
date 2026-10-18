import type { Metadata } from "next";
import { CodeBlock } from "@/app/(marketing)/developers/docs-code";
import {
  CardLink,
  DocsHeader,
  DocsSection,
  DocsTable,
  InlineCode,
  Note,
} from "@/app/(marketing)/developers/docs-ui";
import { marketingMetadata } from "@/lib/seo/metadata";

export const metadata: Metadata = marketingMetadata({
  title: "PostBus integration guides",
  description: "Google Sheets, CRM, ERP, custom websites, Node.js, Python, and generic HTTP automation.",
  path: "/developers/integrations",
});

export default function IntegrationsDocsPage() {
  return (
    <>
      <DocsHeader
        kicker="Guides"
        title="API integrations"
        description="Every custom integration uses the same Merchant API at /api/merchant/v1. There are no native Zapier, Make, n8n, CRM, or ERP plugins."
      />

      <div className="grid gap-3 sm:grid-cols-2">
        <CardLink href="/developers/quickstart" title="Start with /me" body="Prove the key works before wiring a CRM or sheet." />
        <CardLink href="/developers/webhooks" title="Webhooks" body="Push booked, tracking, NDR, and RTO events into your system." />
        <CardLink href="/developers/api-reference" title="API reference" body="Envelopes, idempotency, rate limits, and every implemented route." />
        <CardLink href="/developers/build-with-ai" title="Build with AI" body="Copy a prompt plus OpenAPI into ChatGPT, Gemini, Claude, or Cursor." />
      </div>

      <DocsSection title="What this API is">
        <p>
          Merchant API is for your own software: Google Sheets, CRM, ERP, a custom website backend, or an HTTP
          automation tool. Tenant identity comes from the Bearer key. Do not send <InlineCode>organization_id</InlineCode>.
        </p>
        <p>
          The Shopify and WooCommerce connectors inside the PostBus dashboard are separate. They are not called with a{" "}
          <InlineCode>pb_live_</InlineCode> key. A custom Shopify or Woo app can still use this REST API from a server.
        </p>
        <p>
          Dashboard session routes at <InlineCode>/api/v1</InlineCode> are not this API.
        </p>
      </DocsSection>

      <DocsSection title="Recommended lifecycle">
        <ol className="list-decimal space-y-2 pl-5">
          <li>
            Call <InlineCode>GET /me</InlineCode>. If you receive <InlineCode>MERCHANT_API_DISABLED</InlineCode>, the
            workspace is not on the REST allowlist yet.
          </li>
          <li>
            Create the order with <InlineCode>POST /orders</InlineCode> (or bulk). Store <InlineCode>id</InlineCode>,{" "}
            <InlineCode>order_number</InlineCode>, and your <InlineCode>external_order_id</InlineCode>. Status after create
            is typically <InlineCode>READY</InlineCode>. This does not book India Post.
          </li>
          <li>
            Optionally <InlineCode>PATCH</InlineCode> address or weight while unbooked.
          </li>
          <li>
            When the operator or workflow says ship, <InlineCode>{"POST /orders/{id}/book"}</InlineCode>. HTTP 202 with
            queued means the job was accepted, not that an AWB exists.
          </li>
          <li>
            Wait for <InlineCode>shipment.booked</InlineCode> (preferred) or poll{" "}
            <InlineCode>{"GET /shipments/{id}"}</InlineCode> until <InlineCode>BOOKED</InlineCode>. Then download the
            label PDF.
          </li>
          <li>
            Keep the CRM/ERP in sync from webhooks. If a webhook is missed, reconcile with{" "}
            <InlineCode>GET /orders?updated_since=</InlineCode> and a cursor.
          </li>
        </ol>
      </DocsSection>

      <DocsSection title="Choose an integration">
        <DocsTable
          monoFirst={false}
          columns={["System", "Create", "Book", "Stay in sync"]}
          rows={[
            [
              "Google Sheets",
              "Apps Script POST /orders per row",
              "Separate bookPending() function, never on import",
              "Time-driven syncTracking(), or a webhook to a public HTTPS URL",
            ],
            [
              "CRM",
              "POST /orders with CRM id as external_order_id",
              "Only after a ship action in the CRM",
              "Subscribe to booked, tracking, OFD, delivered, failed, exception",
            ],
            [
              "ERP",
              "POST /orders/bulk, max 25 rows",
              "Batch book when the warehouse releases the wave",
              "Webhooks plus updated_since reconciliation",
            ],
            [
              "Website / app",
              "Your server creates the order after checkout",
              "Warehouse or admin action, not the browser",
              "Webhooks to your backend; never expose the key",
            ],
            [
              "n8n / Make / Zapier",
              "HTTP Request module",
              "Separate scenario, Idempotency-Key required",
              "Catch Hook URL + signature verify, then map data.status",
            ],
          ]}
        />
      </DocsSection>

      <DocsSection title="Scopes to mint">
        <p>Mint only what the integration needs. Write does not include booking.</p>
        <DocsTable
          columns={["Need", "Scopes"]}
          rows={[
            ["Import orders only", "orders:write, orders:read"],
            ["Book India Post", "orders:read, orders:write, shipments:book, shipments:read"],
            ["Labels", "labels:read"],
            ["Polling tracking", "tracking:read, shipments:read"],
            ["Register webhooks", "webhooks:manage, webhooks:read"],
          ]}
        />
      </DocsSection>

      <DocsSection title="Google Sheets">
        <p>
          Copy the Apps Script example from Dashboard → Integrations → Developer API. PostBus does not host the script
          in your Google account.
        </p>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            Store <InlineCode>POSTBUS_API_KEY</InlineCode> and optional <InlineCode>POSTBUS_API_BASE</InlineCode> in
            Project Settings → Script properties. Never put the key in a cell.
          </li>
          <li>
            Map your column headers to PostBus fields. Required: customer name, 10-digit phone, address line1, city,
            state, 6-digit pincode, line item title and quantity.
          </li>
          <li>
            Use a stable <InlineCode>external_order_id</InlineCode> per order (not a sheet row number after sorting).
            Repeating the same id returns the original order.
          </li>
          <li>
            Send <InlineCode>Idempotency-Key</InlineCode> on create and book. Example: <InlineCode>create:ERP-1001</InlineCode>{" "}
            and <InlineCode>{"book:{postbusOrderId}"}</InlineCode>.
          </li>
          <li>
            Keep import, book, and tracking as three functions. Do not auto-book on create. Use{" "}
            <InlineCode>LockService</InlineCode> so overlapping time-driven triggers cannot double-run.
          </li>
          <li>
            On HTTP 429, sleep and retry (the reference script backs off up to five times). Write API errors into a Last
            Error column instead of throwing the whole sheet.
          </li>
        </ul>
        <Note tone="warn" title="Sheets cannot receive PostBus webhooks">
          Google Sheets has no public HTTPS URL. Either poll tracking on a time-driven trigger, or point webhooks at a
          small server / Apps Script web app that you publish yourself and still verify the signature.
        </Note>
      </DocsSection>

      <DocsSection title="Custom CRM">
        <p>
          Treat PostBus as the shipping ledger. The CRM remains the system of record for the customer and payment.
        </p>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            On “ready to ship”, create the order with <InlineCode>external_order_id</InlineCode> equal to the CRM order
            id. Store PostBus <InlineCode>id</InlineCode> and <InlineCode>order_number</InlineCode> on the CRM record.
          </li>
          <li>
            Book only from an operator action or fulfillment workflow. Do not book at CRM order creation.
          </li>
          <li>
            Register an HTTPS webhook for <InlineCode>shipment.booked</InlineCode>,{" "}
            <InlineCode>shipment.booking_failed</InlineCode>, <InlineCode>tracking.updated</InlineCode>,{" "}
            <InlineCode>shipment.out_for_delivery</InlineCode>, <InlineCode>shipment.delivered</InlineCode>, and{" "}
            <InlineCode>shipment.exception</InlineCode>.
          </li>
          <li>
            Map <InlineCode>data.status</InlineCode> onto CRM shipping status.{" "}
            <InlineCode>shipment.exception</InlineCode> uses <InlineCode>NDR</InlineCode> or <InlineCode>RTO</InlineCode>
            — it is not a database EXCEPTION row. <InlineCode>RTO_DELIVERED</InlineCode> does not emit{" "}
            <InlineCode>shipment.delivered</InlineCode>.
          </li>
          <li>All PostBus calls stay on the CRM server. Browser widgets must not hold the merchant key.</li>
        </ul>
      </DocsSection>

      <DocsSection title="Custom ERP">
        <p>
          Use <InlineCode>POST /orders/bulk</InlineCode> (max 25 rows). Failed rows are returned alongside successes —
          commit the successes and retry only the failures with a new idempotency key per row.
        </p>
        <p>
          Book in a separate wave when inventory is picked. Treat <InlineCode>QUEUED</InlineCode> /{" "}
          <InlineCode>BOOKING</InlineCode> as requested. Physical booking is <InlineCode>BOOKED</InlineCode> after India
          Post confirmation.
        </p>
        <p>
          Nightly reconciliation: <InlineCode>GET /orders?updated_since=ISO&limit=100</InlineCode> and follow{" "}
          <InlineCode>cursor</InlineCode>. Sort on the server is stable <InlineCode>(updated_at, id)</InlineCode>.
        </p>
      </DocsSection>

      <DocsSection title="Custom website">
        <Note tone="warn" title="Server only">
          Call PostBus only from your server. Next.js Route Handlers, a backend worker, or a serverless function are
          fine. Client components, public env vars, and checkout JavaScript are not.
        </Note>
        <p>
          Typical flow: your checkout creates a local order → your server <InlineCode>POST /orders</InlineCode> → warehouse
          books → show the customer <InlineCode>https://www.postbus.in/track?tracking=AWB</InlineCode> after{" "}
          <InlineCode>shipment.booked</InlineCode>.
        </p>
      </DocsSection>

      <DocsSection title="Create then book">
        <CodeBlock
          samples={[
            {
              label: "cURL",
              code: `# 1. Create — does not book India Post
curl -X POST "https://www.postbus.in/api/merchant/v1/orders" \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Idempotency-Key: create:ERP-1001" \\
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
  }'

# 2. Book only when you are ready
curl -X POST "https://www.postbus.in/api/merchant/v1/orders/ORDER_ID/book" \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Idempotency-Key: book:ORDER_ID" \\
  -H "Content-Type: application/json" \\
  -d '{ "weight_grams": 500 }'`,
            },
            {
              label: "Node.js",
              code: `const base = "https://www.postbus.in/api/merchant/v1";
const headers = {
  Authorization: "Bearer " + process.env.POSTBUS_API_KEY,
  "Content-Type": "application/json",
};

const created = await fetch(base + "/orders", {
  method: "POST",
  headers: { ...headers, "Idempotency-Key": "create:ERP-1001" },
  body: JSON.stringify({
    external_order_id: "ERP-1001",
    customer: { name: "Asha Rao", phone: "9876543210" },
    shipping_address: { line1: "12 MG Road", city: "Bengaluru", state: "KA", pincode: "560001" },
    line_items: [{ title: "Notebook", quantity: 1, unit_price: 199 }],
  }),
}).then((r) => r.json());

const orderId = created.data.id;
await fetch(base + "/orders/" + orderId + "/book", {
  method: "POST",
  headers: { ...headers, "Idempotency-Key": "book:" + orderId },
  body: JSON.stringify({ weight_grams: 500 }),
});`,
            },
            {
              label: "Python",
              code: `import os, requests

base = "https://www.postbus.in/api/merchant/v1"
headers = {"Authorization": "Bearer " + os.environ["POSTBUS_API_KEY"]}

created = requests.post(
    base + "/orders",
    headers={**headers, "Idempotency-Key": "create:ERP-1001", "Content-Type": "application/json"},
    json={
        "external_order_id": "ERP-1001",
        "customer": {"name": "Asha Rao", "phone": "9876543210"},
        "shipping_address": {"line1": "12 MG Road", "city": "Bengaluru", "state": "KA", "pincode": "560001"},
        "line_items": [{"title": "Notebook", "quantity": 1, "unit_price": 199}],
    },
)
created.raise_for_status()
order_id = created.json()["data"]["id"]

book = requests.post(
    base + f"/orders/{order_id}/book",
    headers={**headers, "Idempotency-Key": f"book:{order_id}", "Content-Type": "application/json"},
    json={"weight_grams": 500},
)
book.raise_for_status()`,
            },
          ]}
        />
      </DocsSection>

      <DocsSection title="n8n / Make / Zapier">
        <p>
          Use an HTTP Request module against <InlineCode>https://www.postbus.in/api/merchant/v1/...</InlineCode> with{" "}
          <InlineCode>Authorization: Bearer</InlineCode>. There is no PostBus app in those marketplaces.
        </p>
        <ul className="list-disc space-y-2 pl-5">
          <li>Store the key in the scenario’s credential / secret vault, not in a mapped spreadsheet cell.</li>
          <li>
            Create and book as two modules. The book module must send a stable <InlineCode>Idempotency-Key</InlineCode>.
          </li>
          <li>
            For inbound updates, expose an HTTPS Catch Hook, register it with{" "}
            <InlineCode>POST /webhook-subscriptions</InlineCode>, and verify{" "}
            <InlineCode>X-PostBus-Signature</InlineCode> before mapping fields. Skip verification and anyone can POST
            fake delivered events.
          </li>
        </ul>
      </DocsSection>

      <DocsSection title="Errors every integrator should handle">
        <DocsTable
          columns={["Code", "What to do"]}
          rows={[
            ["MERCHANT_API_DISABLED", "Workspace is not on the REST allowlist. Stop retrying until PostBus enables it."],
            ["INSUFFICIENT_SCOPE", "Mint a key that includes the missing scope. orders:write cannot book."],
            ["DUPLICATE_ORDER", "Same external_order_id already exists. Use the returned original order."],
            ["IDEMPOTENCY_CONFLICT", "You reused Idempotency-Key with a different body. Use a new key."],
            ["BOOKING_NOT_ALLOWED", "Address/weight locked or the order cannot be booked in its current status."],
            ["RATE_LIMIT_EXCEEDED", "Honor Retry-After. Caps: 120/min per key, 30 book posts/min, bulk 25 rows."],
            ["VALIDATION_ERROR", "Fix details[].field (phone, pincode, line items)."],
          ]}
        />
      </DocsSection>
    </>
  );
}
