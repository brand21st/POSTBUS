import type { Metadata } from "next";
import { CodeBlock } from "@/app/(marketing)/developers/docs-code";
import { DocsHeader, DocsSection, InlineCode, Note } from "@/app/(marketing)/developers/docs-ui";
import { marketingMetadata } from "@/lib/seo/metadata";

export const metadata: Metadata = marketingMetadata({
  title: "Merchant API quick start",
  description: "Create a PostBus account, mint an API key, create an order, then book India Post in a separate call.",
  path: "/developers/quickstart",
});

const ME = [
  {
    label: "cURL",
    code: `curl -X GET "https://www.postbus.in/api/merchant/v1/me" \\
  -H "Authorization: Bearer YOUR_API_KEY"`,
  },
  {
    label: "JavaScript",
    code: `const res = await fetch("https://www.postbus.in/api/merchant/v1/me", {
  headers: { Authorization: "Bearer " + process.env.POSTBUS_API_KEY },
});
const json = await res.json();
console.log(json);`,
  },
  {
    label: "Python",
    code: `import os, requests

r = requests.get(
    "https://www.postbus.in/api/merchant/v1/me",
    headers={"Authorization": "Bearer " + os.environ["POSTBUS_API_KEY"]},
)
r.raise_for_status()
print(r.json())`,
  },
  {
    label: "Apps Script",
    code: `function postbusMe() {
  const res = UrlFetchApp.fetch("https://www.postbus.in/api/merchant/v1/me", {
    method: "get",
    headers: { Authorization: "Bearer " + PropertiesService.getScriptProperties().getProperty("POSTBUS_API_KEY") },
    muteHttpExceptions: true,
  });
  Logger.log(res.getContentText());
}`,
  },
];

const CREATE = [
  {
    label: "cURL",
    code: `curl -X POST "https://www.postbus.in/api/merchant/v1/orders" \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Idempotency-Key: erp-1001-create" \\
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
  {
    label: "JavaScript",
    code: `const res = await fetch("https://www.postbus.in/api/merchant/v1/orders", {
  method: "POST",
  headers: {
    Authorization: "Bearer " + process.env.POSTBUS_API_KEY,
    "Idempotency-Key": "erp-1001-create",
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    external_order_id: "ERP-1001",
    customer: { name: "Asha Rao", phone: "9876543210" },
    shipping_address: {
      line1: "12 MG Road",
      city: "Bengaluru",
      state: "KA",
      pincode: "560001",
    },
    line_items: [{ title: "Notebook", quantity: 1, unit_price: 199 }],
  }),
});`,
  },
];

export default function QuickStartPage() {
  return (
    <>
      <DocsHeader
        kicker="Getting started"
        title="Quick start"
        description="Create an account, mint a scoped key, prove identity, then create an order. Booking India Post is a later, explicit call."
      />

      <ol className="space-y-5 text-[15px] leading-7 text-zinc-600">
        <li className="rounded-xl border border-border bg-white p-4">
          <p className="font-semibold text-ink">1. Create a PostBus merchant account</p>
          <p className="mt-1">Sign up at postbus.in and complete the workspace.</p>
        </li>
        <li className="rounded-xl border border-border bg-white p-4">
          <p className="font-semibold text-ink">2. Mint an API key</p>
          <p className="mt-1">
            Open Dashboard → Integrations → Developer API. Generate a scoped key and copy the secret once.
          </p>
        </li>
        <li className="rounded-xl border border-border bg-white p-4">
          <p className="mb-3 font-semibold text-ink">3. Call identity</p>
          <CodeBlock samples={ME} title="GET /me" />
        </li>
        <li className="rounded-xl border border-border bg-white p-4">
          <p className="mb-3 font-semibold text-ink">4. Create an order</p>
          <p className="mb-3">
            Send <InlineCode>Idempotency-Key</InlineCode>. This does not book India Post. Status after create is typically{" "}
            <InlineCode>READY</InlineCode>.
          </p>
          <CodeBlock samples={CREATE} title="POST /orders" />
        </li>
        <li className="rounded-xl border border-border bg-white p-4">
          <p className="font-semibold text-ink">5. Book when you are ready</p>
          <p className="mt-1">
            <InlineCode>{"POST /orders/{id}/book"}</InlineCode> requires <InlineCode>shipments:book</InlineCode>. Poll
            shipments until status is <InlineCode>BOOKED</InlineCode> and an AWB exists.
          </p>
        </li>
        <li className="rounded-xl border border-border bg-white p-4">
          <p className="font-semibold text-ink">6. Subscribe to webhooks</p>
          <p className="mt-1">Register an HTTPS endpoint to receive signed shipment events (allowlist required).</p>
        </li>
      </ol>

      <DocsSection title="If identity fails">
        <Note tone="warn" title="MERCHANT_API_DISABLED">
          The workspace is not on the API allowlist yet, or Merchant API is globally disabled. Keys still authenticate;
          the request is rejected before your data is read.
        </Note>
      </DocsSection>
    </>
  );
}
