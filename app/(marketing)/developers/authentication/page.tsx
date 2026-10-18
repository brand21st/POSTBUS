import type { Metadata } from "next";
import { DocsHeader, DocsSection, InlineCode, Note, ScopeTable } from "@/app/(marketing)/developers/docs-ui";
import { marketingMetadata } from "@/lib/seo/metadata";

export const metadata: Metadata = marketingMetadata({
  title: "Merchant API authentication",
  description: "Bearer pb_live keys, HMAC storage, scopes, rotation, and organization isolation.",
  path: "/developers/authentication",
});

export default function AuthenticationPage() {
  return (
    <>
      <DocsHeader
        kicker="Security"
        title="Authentication"
        description="Every Merchant API request uses a scoped organization key. Tenant identity comes from the key, never from a request field."
      />

      <DocsSection title="Bearer key">
        <p>
          Send <InlineCode>Authorization: Bearer pb_live_&lt;lookup&gt;_&lt;secret&gt;</InlineCode>. Do not send{" "}
          <InlineCode>organization_id</InlineCode>.
        </p>
        <p>
          Rotate and revoke keys in the dashboard. The secret is shown only at create and rotate. PostBus stores an HMAC,
          not the raw secret.
        </p>
      </DocsSection>

      <DocsSection title="Scopes">
        <p>Scopes are exact. Write access does not imply booking, and booking does not imply webhook management.</p>
        <ScopeTable
          rows={[
            { scope: "orders:read", allows: "List and get orders" },
            { scope: "orders:write", allows: "Create, bulk import, and patch orders. Does not book" },
            { scope: "shipments:read", allows: "List and get shipments" },
            { scope: "shipments:book", allows: "POST /orders/{id}/book" },
            { scope: "tracking:read", allows: "Cached tracking events" },
            { scope: "labels:read", allows: "Authenticated label PDF" },
            { scope: "webhooks:read", allows: "List subscriptions and deliveries" },
            { scope: "webhooks:manage", allows: "Create, update, disable, rotate, test, retry" },
          ]}
        />
      </DocsSection>

      <Note tone="warn" title="Never expose the key">
        Do not put the key in a browser, Google Sheet cell, client-side JavaScript, or a public Git repository. Call
        PostBus from a server, Apps Script property, or secret store.
      </Note>
    </>
  );
}
