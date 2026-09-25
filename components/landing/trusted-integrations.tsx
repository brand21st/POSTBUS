import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Check, ClipboardList } from "lucide-react";
import { IndiaPostLogo } from "@/components/brand/india-post-logo";
import { ShopifyLogo } from "@/components/brand/shopify-logo";
import { WatiLogo } from "@/components/brand/wati-logo";
import { WooCommerceLogo } from "@/components/brand/woocommerce-logo";
import { buttonVariants } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { siteConfig } from "@/lib/site-config";
import { cn } from "@/lib/utils";

const trackingBenefits = [
  "Live tracking updates from India Post",
  "Status next to the order, not in another tab",
  "History for booked, in-transit and delivered shipments",
  "WhatsApp updates via Wati on eligible plans",
] as const;

export function TrustedIntegrations() {
  return (
    <section id="integrations" className="overflow-hidden bg-white py-14 sm:py-20 lg:py-24">
      <Container>
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand">
            Works with the way you already ship
          </p>
          <h2 className="mt-3 text-3xl font-bold tracking-tight text-ink sm:text-4xl">
            India Post stays the carrier. PostBus is the workspace.
          </h2>
          <p className="mt-4 text-base text-muted sm:text-lg">
            Connect your existing Customer ID, then add Shopify or manual orders. WooCommerce is on
            the roadmap — not live yet.
          </p>
        </div>

        <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <li className="rounded-[24px] border border-border bg-surface p-5 text-left sm:p-6 lg:col-span-1">
            <IndiaPostLogo className="h-12 mix-blend-darken" />
            <h3 className="mt-4 text-lg font-semibold text-ink">India Post Customer ID</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              Primary connection. Book, label and track with the India Post account you already have.
            </p>
            <Link href="/india-post-customer-id" className="mt-4 inline-block text-sm font-semibold text-brand hover:underline">
              How Customer ID shipping works
            </Link>
          </li>
          <li className="rounded-[24px] border border-border bg-surface p-5 text-left sm:p-6">
            <ShopifyLogo className="h-8" />
            <h3 className="mt-4 text-lg font-semibold text-ink">Shopify</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              Sync store orders into PostBus, then ship through your India Post workflow.
            </p>
            <Link href="/shopify-india-post" className="mt-4 inline-block text-sm font-semibold text-brand hover:underline">
              Explore Shopify and India Post
            </Link>
          </li>
          <li className="rounded-[24px] border border-border bg-surface p-5 text-left sm:p-6">
            <span className="inline-flex size-10 items-center justify-center rounded-2xl bg-white text-brand shadow-sm">
              <ClipboardList className="size-5" aria-hidden="true" />
            </span>
            <h3 className="mt-4 text-lg font-semibold text-ink">Manual orders</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              Add shipments that never came from a store — phone orders, WhatsApp sales, marketplaces.
            </p>
          </li>
          <li className="rounded-[24px] border border-border bg-surface p-5 text-left sm:p-6">
            <WatiLogo className="h-8" />
            <h3 className="mt-4 text-lg font-semibold text-ink">Wati WhatsApp</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              Optional customer updates through your Wati account on Business plans and during trial.
            </p>
          </li>
          <li className="rounded-[24px] border border-dashed border-zinc-300 bg-white p-5 text-left sm:p-6 sm:col-span-2 lg:col-span-2">
            <div className="flex flex-wrap items-center gap-3">
              <WooCommerceLogo className="h-10" />
              <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-bold uppercase tracking-wide text-zinc-600">
                Coming soon
              </span>
            </div>
            <h3 className="mt-4 text-lg font-semibold text-ink">WooCommerce</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              A WooCommerce connection is planned. Today you can still ship WooCommerce orders as
              manual shipments with your India Post Customer ID.
            </p>
            <Link href="/woocommerce-india-post" className="mt-4 inline-block text-sm font-semibold text-brand hover:underline">
              See the current WooCommerce workflow
            </Link>
          </li>
        </ul>
        <p className="mt-6 text-center text-xs leading-relaxed text-muted">
          PostBus is independent software. It is not affiliated with, endorsed by, or part of India
          Post, Shopify, WooCommerce or Wati.
        </p>

        <div className="mt-14 grid items-center gap-10 lg:grid-cols-2 lg:gap-14">
          <Image
            src="/images/postbus-india-post-tracking-dashboard.webp"
            alt="PostBus dashboard shipment overview next to a mobile tracking timeline for an India Post AWB"
            width={1024}
            height={512}
            sizes="(min-width: 1024px) 40vw, 100vw"
            className="w-full object-contain mix-blend-multiply"
          />
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-brand">
              Tracking
            </p>
            <h3 className="mt-3 text-2xl font-bold tracking-tight text-ink sm:text-3xl">
              Know where every shipment is without checking multiple systems.
            </h3>
            <ul className="mt-6 space-y-3">
              {trackingBenefits.map((benefit) => (
                <li key={benefit} className="flex items-start gap-3 text-sm font-medium text-zinc-700">
                  <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-brand/10 text-brand">
                    <Check className="size-3.5 stroke-[3]" aria-hidden="true" />
                  </span>
                  {benefit}
                </li>
              ))}
            </ul>
            <Link href="/india-post-tracking" className="mt-5 inline-block text-sm font-semibold text-brand hover:underline">
              Learn about India Post tracking management
            </Link>
            <Link
              href={siteConfig.getStartedUrl}
              className={cn(buttonVariants({ variant: "primary", size: "lg" }), "mt-7 rounded-full")}
            >
              Start Free Trial
              <ArrowRight className="size-4" />
            </Link>
          </div>
        </div>
      </Container>
    </section>
  );
}
