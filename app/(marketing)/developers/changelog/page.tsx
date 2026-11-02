import type { Metadata } from "next";
import { DocsHeader, Note } from "@/app/(marketing)/developers/docs-ui";
import { marketingMetadata } from "@/lib/seo/metadata";

export const metadata: Metadata = marketingMetadata({
  title: "Merchant API changelog",
  description: "Documented Merchant API and webhook platform changes. Production deploy is separate from this listing.",
  path: "/developers/changelog",
});

export default function ChangelogPage() {
  return (
    <>
      <DocsHeader
        kicker="History"
        title="Changelog"
        description="Documented Merchant API and webhook platform changes. Listing a date here does not mean every workspace is enabled."
      />

      <article className="rounded-2xl border border-border bg-white p-6">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-brand">2026-10-18</p>
        <h2 className="mt-1 text-lg font-semibold text-ink">Webhook platform and public docs</h2>
        <ul className="mt-4 list-disc space-y-2 pl-5 text-[15px] leading-7 text-zinc-600">
          <li>Public documentation at /developers.</li>
          <li>Webhook subscription routes under /api/merchant/v1/webhook-subscriptions.</li>
          <li>Signed envelope version 2026-10-18 with SSRF-hardened delivery.</li>
          <li>Existing REST order, shipment, tracking, and label routes are unchanged.</li>
        </ul>
      </article>

      <div className="mt-6">
        <Note>This changelog describes the contract. Production allowlists are operated separately.</Note>
      </div>
    </>
  );
}
