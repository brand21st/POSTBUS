import type { Metadata } from "next";
import Link from "next/link";
import { marketingMetadata } from "@/lib/seo/metadata";

export const metadata: Metadata = marketingMetadata({
  title: "PostBus Merchant API",
  description: "REST API and signed webhooks for India Post shipping. One contract for CRM, ERP, Sheets, and custom apps.",
  path: "/developers",
});

export default function DevelopersPage() {
  return (
    <>
      <h1>PostBus Merchant API</h1>
      <p>
        Integrate PostBus into any application that can make HTTPS requests. CRM, ERP, ecommerce, Google Sheets, n8n,
        Make, Zapier, and custom software all use the same public contract at <code>/api/merchant/v1</code>.
      </p>
      <p>
        The dashboard session API at <code>/api/v1</code> is not this API. Do not call it with a merchant key.
      </p>
      <p>
        Outbound webhooks are delivered only for organizations on the webhook allowlist. REST access is separately gated
        by the Merchant API allowlist. This site documents implemented behavior. It does not claim production rollout
        for every workspace.
      </p>
      <ul>
        <li>
          <Link href="/developers/quickstart">Quick start</Link>
        </li>
        <li>
          <Link href="/developers/authentication">Authentication</Link>
        </li>
        <li>
          <Link href="/developers/api-reference">API reference</Link>
        </li>
        <li>
          <Link href="/developers/webhooks">Webhooks</Link>
        </li>
        <li>
          <Link href="/developers/integrations">Integration guides</Link>
        </li>
      </ul>
    </>
  );
}
