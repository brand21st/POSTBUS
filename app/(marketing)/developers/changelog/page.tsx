import type { Metadata } from "next";
import { marketingMetadata } from "@/lib/seo/metadata";

export const metadata: Metadata = marketingMetadata({
  title: "Merchant API changelog",
  description: "Documented Merchant API and webhook platform changes. Production deploy is separate from this listing.",
  path: "/developers/changelog",
});

export default function ChangelogPage() {
  return (
    <>
      <h1>Changelog</h1>
      <h2>2026-10-18 — webhook platform and public docs</h2>
      <ul>
        <li>Public documentation at /developers.</li>
        <li>Webhook subscription routes under /api/merchant/v1/webhook-subscriptions.</li>
        <li>Signed envelope version 2026-10-18 with SSRF-hardened delivery.</li>
        <li>Existing REST order, shipment, tracking, and label routes are unchanged.</li>
      </ul>
      <p>This changelog does not mark production deployment as complete.</p>
    </>
  );
}
