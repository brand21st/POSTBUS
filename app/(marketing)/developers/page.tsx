import type { Metadata } from "next";
import { CardLink, DocsHeader, DocsSection, InlineCode, Note } from "@/app/(marketing)/developers/docs-ui";
import { marketingMetadata } from "@/lib/seo/metadata";

export const metadata: Metadata = marketingMetadata({
  title: "PostBus Merchant API",
  description: "REST API and signed webhooks for India Post shipping. One contract for CRM, ERP, Sheets, and custom apps.",
  path: "/developers",
});

export default function DevelopersPage() {
  return (
    <>
      <DocsHeader
        kicker="Merchant API v1"
        title="Ship India Post from any app"
        description="One HTTPS contract for CRM, ERP, ecommerce, Google Sheets, n8n, Make, Zapier, and custom software. Create orders, book shipments, download labels, and receive signed webhooks."
      />

      <div className="grid gap-3 sm:grid-cols-2">
        <CardLink
          href="/developers/quickstart"
          title="Quick start"
          body="Mint a key, call /me, create an order, then book India Post in a separate request."
        />
        <CardLink
          href="/developers/authentication"
          title="Authentication"
          body="Bearer pb_live keys, exact scopes, rotation, and organization isolation."
        />
        <CardLink
          href="/developers/api-reference"
          title="API reference"
          body="Implemented endpoints, envelopes, errors, rate limits, and idempotency."
        />
        <CardLink
          href="/developers/webhooks"
          title="Webhooks"
          body="HMAC-signed events after order and shipment writes. Deduplicate by event id."
        />
        <CardLink
          href="/developers/integrations"
          title="Integration guides"
          body="Sheets, CRM, ERP, websites, and HTTP automation on the same REST contract."
        />
      </div>

      <DocsSection title="Base URL">
        <p>
          Production REST lives at <InlineCode>https://www.postbus.in/api/merchant/v1</InlineCode>. The dashboard session
          API at <InlineCode>/api/v1</InlineCode> is not this API. Do not send a merchant key there.
        </p>
      </DocsSection>

      <DocsSection title="Design rules">
        <ul className="list-disc space-y-2 pl-5">
          <li>
            Creating an order does not book India Post. Booking is <InlineCode>{"POST /orders/{id}/book"}</InlineCode>.
          </li>
          <li>
            REST access and outbound webhooks are independently allowlisted. A workspace can have REST without webhooks.
          </li>
          <li>
            Webhook delivery is at-least-once. Deduplicate on the envelope <InlineCode>id</InlineCode>.
          </li>
          <li>This documentation describes implemented behavior, not a guarantee that every workspace is enabled.</li>
        </ul>
      </DocsSection>

      <Note tone="info" title="Allowlists">
        If you receive <InlineCode>MERCHANT_API_DISABLED</InlineCode>, the organization is not on the Merchant API
        allowlist yet. Webhook subscriptions still require a separate webhook allowlist.
      </Note>
    </>
  );
}
