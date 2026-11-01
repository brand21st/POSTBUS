import type { Metadata } from "next";
import Link from "next/link";
import { Container } from "@/components/ui/container";
import { SectionHeading } from "@/components/ui/section-heading";
import { serializeJsonLd, webPageJsonLd } from "@/lib/seo/json-ld";
import { marketingMetadata } from "@/lib/seo/metadata";
import { siteConfig } from "@/lib/site-config";

const description =
  "About PostBus, an India Post shipping management platform for ecommerce businesses using an existing India Post Customer ID.";

export const metadata: Metadata = marketingMetadata({
  title: "About",
  description,
  path: "/about",
});

export default function AboutPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: serializeJsonLd(
            webPageJsonLd({ name: "About PostBus", description, path: "/about" })
          ),
        }}
      />
      <section className="border-b border-border bg-white py-16 sm:py-20">
        <Container className="max-w-4xl">
          <SectionHeading
            align="left"
            as="h1"
            eyebrow="About PostBus"
            title="Shipping operations software for businesses that use India Post."
            description="PostBus gives ecommerce teams one workspace for orders, India Post shipment booking, labels, AWB tracking, invoices and analytics."
          />
        </Container>
      </section>
      <section className="bg-surface py-16 sm:py-20">
        <Container className="max-w-4xl">
          <div className="grid gap-6 md:grid-cols-2">
            <article className="rounded-[24px] border border-border bg-white p-7">
              <h2 className="text-2xl font-bold text-ink">What PostBus does</h2>
              <p className="mt-4 leading-relaxed text-muted">
                PostBus connects to the India Post Customer ID a merchant already uses. It
                organizes Shopify and manual orders, booking, barcode and label workflows,
                manifests, tracking and invoices in one dashboard.
              </p>
            </article>
            <article className="rounded-[24px] border border-border bg-white p-7">
              <h2 className="text-2xl font-bold text-ink">What PostBus is not</h2>
              <p className="mt-4 leading-relaxed text-muted">
                PostBus is independent software. It is not India Post and does not issue
                Customer IDs, operate the carrier network or bill India Post postage.
                WooCommerce integration is planned and is not currently live.
              </p>
            </article>
          </div>
          <article className="mt-6 rounded-[24px] border border-border bg-white p-7">
            <h2 className="text-2xl font-bold text-ink">Contact PostBus</h2>
            <p className="mt-4 leading-relaxed text-muted">
              Product, trial and support questions can be sent to{" "}
              <a className="font-semibold text-brand hover:underline" href={`mailto:${siteConfig.contactEmail}`}>
                {siteConfig.contactEmail}
              </a>
              . You can also use the{" "}
              <Link className="font-semibold text-brand hover:underline" href="/contact">
                PostBus contact page
              </Link>
              .
            </p>
          </article>
        </Container>
      </section>
    </>
  );
}
