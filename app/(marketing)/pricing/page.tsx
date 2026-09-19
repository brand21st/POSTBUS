import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import { FinalCta } from "@/components/landing/final-cta";
import { buttonVariants } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { SectionHeading } from "@/components/ui/section-heading";
import { siteConfig } from "@/lib/site-config";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Simple PostBus plans designed for growing Shopify businesses. Contact us for current pricing.",
  alternates: { canonical: "/pricing" },
};

const planStructure = [
  {
    name: "Starter",
    blurb: "For early-stage Shopify stores setting up automated shipping.",
    featured: false,
    points: [
      "Shopify order sync",
      "Shipment workspace",
      "Label & barcode workflows",
      "Email support",
    ],
  },
  {
    name: "Growth",
    blurb: "For teams processing shipments in bulk every day.",
    featured: true,
    points: [
      "Everything in Starter",
      "Bulk shipping tools",
      "Automation rules",
      "Manifest management",
      "Priority onboarding help",
    ],
  },
  {
    name: "Scale",
    blurb: "For multi-store and high-volume shipping operations.",
    featured: false,
    points: [
      "Everything in Growth",
      "Advanced workspace controls",
      "Operational analytics",
      "Dedicated success support",
    ],
  },
] as const;

export default function PricingPage() {
  return (
    <>
      <section className="border-b border-border bg-white py-16 sm:py-20">
        <Container>
          <SectionHeading
            as="h1"
            title={
              <>
                Simple shipping software.
                <br />
                Built to grow with you.
              </>
            }
            description="Plans designed for growing Shopify businesses. Pricing is shared during onboarding so it matches your volume and workflow."
          />
        </Container>
      </section>

      <section className="bg-surface py-16 sm:py-20">
        <Container>
          <p className="mb-8 text-center text-xs font-semibold uppercase tracking-[0.16em] text-muted">
            Plan structure · editable content · contact for current pricing
          </p>
          <div className="grid gap-5 lg:grid-cols-3">
            {planStructure.map((plan) => (
              <article
                key={plan.name}
                className={cn(
                  "flex flex-col rounded-[28px] border bg-white p-7 card-shadow",
                  plan.featured
                    ? "border-brand shadow-[0_0_0_1px_rgba(225,29,72,0.15)]"
                    : "border-border"
                )}
              >
                {plan.featured ? (
                  <span className="mb-4 w-fit rounded-full bg-brand/10 px-2.5 py-1 text-[11px] font-semibold text-brand">
                    Popular
                  </span>
                ) : (
                  <span className="mb-4 h-6" />
                )}
                <h2 className="text-2xl font-semibold tracking-tight text-ink">
                  {plan.name}
                </h2>
                <p className="mt-3 text-sm leading-relaxed text-muted">{plan.blurb}</p>
                <p className="mt-6 text-sm font-semibold text-ink">Custom pricing</p>
                <p className="mt-1 text-xs text-muted">
                  Contact us for current plan details
                </p>
                <ul className="mt-6 space-y-3">
                  {plan.points.map((point) => (
                    <li key={point} className="flex gap-2 text-sm text-foreground">
                      <Check className="mt-0.5 size-4 shrink-0 text-brand" />
                      {point}
                    </li>
                  ))}
                </ul>
                <Link
                  href={`${siteConfig.contactEmail ? "/contact" : "/contact"}?intent=start&plan=${plan.name.toLowerCase()}`}
                  className={cn(
                    buttonVariants({
                      variant: plan.featured ? "primary" : "secondary",
                      size: "lg",
                    }),
                    "group mt-8 w-full"
                  )}
                >
                  Talk to us
                  <ArrowRight className="transition-transform group-hover:translate-x-0.5" />
                </Link>
              </article>
            ))}
          </div>
        </Container>
      </section>

      <FinalCta />
    </>
  );
}
