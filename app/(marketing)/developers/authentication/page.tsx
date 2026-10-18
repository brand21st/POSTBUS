import type { Metadata } from "next";
import { marketingMetadata } from "@/lib/seo/metadata";

export const metadata: Metadata = marketingMetadata({
  title: "Merchant API authentication",
  description: "Bearer pb_live keys, HMAC storage, scopes, rotation, and organization isolation.",
  path: "/developers/authentication",
});

export default function AuthenticationPage() {
  return (
    <>
      <h1>Authentication</h1>
      <p>
        Send <code>Authorization: Bearer pb_live_&lt;lookup&gt;_&lt;secret&gt;</code>. The key belongs to one
        organization. Do not send <code>organization_id</code>.
      </p>
      <p>Scopes are exact. <code>orders:write</code> does not book shipments and does not manage webhooks.</p>
      <p>Rotate and revoke keys in the dashboard. The secret is shown only at create and rotate.</p>
      <p>Never put the key in a browser, Google Sheet cell, or client-side JavaScript.</p>
    </>
  );
}
