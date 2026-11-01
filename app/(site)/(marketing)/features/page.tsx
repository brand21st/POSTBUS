import type { Metadata } from "next";
import Link from "next/link";
import {
  Activity,
  Barcode,
  Boxes,
  FileText,
  PackageCheck,
  RefreshCw,
  ShoppingBag,
  Zap,
} from "lucide-react";
import { FinalCta } from "@/components/landing/final-cta";
import { buttonVariants } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { SectionHeading } from "@/components/ui/section-heading";
import { marketingMetadata } from "@/lib/seo/metadata";
import { siteConfig } from "@/lib/site-config";
import { cn } from "@/lib/utils";

export const metadata: Metadata = marketingMetadata({
  title: "India Post Shipping Management Features",
  description:
    "India Post shipping software for ecommerce: order sync, India Post booking, labels, manifests, tracking and invoices.",
  path: "/features",
});

const deepFeatures = [
  {
    icon: ShoppingBag,
    title: "Shopify Order Sync",
    description:
      "Keep new and updated Shopify orders flowing into a shipping-ready workspace.",
  },
  {
    icon: PackageCheck,
    title: "India Post Booking",
    description:
      "Prepare shipments through your connected India Post workflow without duplicate entry.",
  },
  {
    icon: Boxes,
    title: "Bulk Processing",
    description:
      "Select multiple orders and move them through booking and label steps together.",
  },
  {
    icon: Barcode,
    title: "Labels & Barcodes",
    description:
      "Generate shipping labels and manage barcode steps from the same queue.",
  },
  {
    icon: FileText,
    title: "Manifests",
    description:
      "Create and manage manifests without jumping between disconnected tools.",
  },
  {
    icon: RefreshCw,
    title: "Tracking Sync",
    description:
      "Keep tracking information organized and ready for fulfillment updates.",
  },
  {
    icon: Zap,
    title: "Automation Rules",
    description:
      "Define when shipments should be created, labeled, booked and synced.",
  },
  {
    icon: Activity,
    title: "Shipping Analytics",
    description:
      "See shipping activity, status distribution and workflow performance over time.",
  },
] as const;

export default function FeaturesPage() {
  return (
    <>
      <section className="border-b border-border bg-white py-16 sm:py-20">
        <Container>
          <SectionHeading
            align="left"
            as="h1"
            eyebrow="Features"
            title="Everything between order and delivery."
            description="PostBus connects India Post Customer ID bookings to Shopify and manual orders — labels, manifests, tracking and invoices in one workspace."
            className="max-w-3xl"
          />
          <Link
            href={siteConfig.getStartedUrl}
            className={cn(buttonVariants({ variant: "primary", size: "lg" }), "mt-8 inline-flex")}
          >
            Start Free Trial
          </Link>
        </Container>
      </section>

      <section className="bg-surface py-16 sm:py-20">
        <Container>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {deepFeatures.map((feature) => (
              <article
                key={feature.title}
                className="rounded-[24px] border border-border bg-white p-6 card-shadow"
              >
                <feature.icon className="mb-4 size-5 text-brand" />
                <h2 className="text-lg font-semibold text-ink">{feature.title}</h2>
                <p className="mt-2 text-sm leading-relaxed text-muted">
                  {feature.description}
                </p>
              </article>
            ))}
          </div>
        </Container>
      </section>

      <FinalCta />
    </>
  );
}
