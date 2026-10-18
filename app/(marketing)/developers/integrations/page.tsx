import type { Metadata } from "next";
import { marketingMetadata } from "@/lib/seo/metadata";

export const metadata: Metadata = marketingMetadata({
  title: "PostBus integration guides",
  description: "Google Sheets, CRM, ERP, custom websites, Node.js, Python, and generic HTTP automation.",
  path: "/developers/integrations",
});

export default function IntegrationsDocsPage() {
  return (
    <>
      <h1>Integration guides</h1>
      <p>Every integration uses the same Merchant API. There are no native Zapier, Make, or n8n plugins.</p>
      <h2>Google Sheets</h2>
      <p>
        Copy the Apps Script example from the dashboard. Map columns in your script. Use a stable{" "}
        <code>external_order_id</code>. Do not auto-book on create.
      </p>
      <h2>Custom CRM</h2>
      <p>
        Create orders with the CRM id as <code>external_order_id</code>. Book when the CRM workflow says ship. Update CRM
        records from signed webhooks.
      </p>
      <h2>Custom ERP</h2>
      <p>
        Use bulk import (25 rows). Reconcile with <code>updated_since</code> if a webhook is missed. Treat{" "}
        <code>QUEUED</code> as requested, not booked.
      </p>
      <h2>Custom website</h2>
      <p>Call PostBus only from your server. Never expose the merchant key to the browser.</p>
      <h2>Node.js</h2>
      <pre>
        <code>{`const res = await fetch("https://www.postbus.in/api/merchant/v1/me", {
  headers: { Authorization: "Bearer " + process.env.POSTBUS_API_KEY }
});
const json = await res.json();`}</code>
      </pre>
      <h2>Python</h2>
      <pre>
        <code>{`import os, requests
r = requests.get(
  "https://www.postbus.in/api/merchant/v1/me",
  headers={"Authorization": "Bearer " + os.environ["POSTBUS_API_KEY"]},
)
r.raise_for_status()`}</code>
      </pre>
      <h2>n8n / Make / Zapier</h2>
      <p>
        Use an HTTP request module with the Bearer header. For inbound updates, expose an HTTPS webhook and verify the
        PostBus signature.
      </p>
    </>
  );
}
