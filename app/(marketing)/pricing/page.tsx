import type { Metadata } from "next";
import { FinalCta } from "@/components/landing/final-cta";
import { SeoFaq } from "@/components/marketing/seo-faq";
import { Container } from "@/components/ui/container";
import { SectionHeading } from "@/components/ui/section-heading";
import { PricingToggle } from "@/app/(marketing)/pricing/pricing-toggle";
import {
  entityIds,
  faqJsonLd,
  serializeJsonLd,
  webPageJsonLd,
} from "@/lib/seo/json-ld";
import { absoluteUrl, marketingMetadata } from "@/lib/seo/metadata";
import { createServerSupabase } from "@/lib/supabase/server";
import { mapPlan, type PlanRow } from "@/modules/billing/subscriptions";

export const metadata: Metadata = marketingMetadata({
  title: "India Post Shipping Software Pricing",
  description:
    "PostBus plans for India Post shipping management — Starter, Pro and Business with monthly or yearly billing and a 3-day full-feature trial.",
  path: "/pricing",
});

const pricingFaqs = [
  {
    q: "Is India Post postage included in PostBus pricing?",
    a: "No. PostBus is shipping management software. India Post bills your business separately for postage and carrier services.",
  },
  {
    q: "What is included in the 3-day trial?",
    a: "New workspaces receive a 3-day trial with every PostBus feature unlocked. One trial is available per email address or WhatsApp number.",
  },
  {
    q: "Can I pay yearly?",
    a: "Yes. PostBus offers monthly billing and yearly billing with a 20% discount.",
  },
  {
    q: "How do order limits work?",
    a: "Each plan has an order allowance that resets at the start of its billing period. Choose the plan that matches your India Post shipping volume.",
  },
] as const;

export default async function PricingPage() {
  const supabase = await createServerSupabase();
  const { data } = await supabase.from("plans").select("*").eq("is_active", true).order("display_order", { ascending: true });
  const plans = ((data ?? []) as PlanRow[]).map(mapPlan);
  const offerSchema =
    plans.length > 0
      ? {
          "@context": "https://schema.org",
          "@type": "SoftwareApplication",
          "@id": entityIds.application,
          offers: plans.flatMap((plan) => [
            {
              "@type": "Offer",
              name: `${plan.name} monthly`,
              url: absoluteUrl("/pricing"),
              price: (plan.monthlyPricePaise / 100).toFixed(2),
              priceCurrency: "INR",
              category: "monthly subscription",
              availability: "https://schema.org/InStock",
            },
            {
              "@type": "Offer",
              name: `${plan.name} yearly`,
              url: absoluteUrl("/pricing"),
              price: (plan.yearlyPricePaise / 100).toFixed(2),
              priceCurrency: "INR",
              category: "yearly subscription",
              availability: "https://schema.org/InStock",
            },
          ]),
        }
      : null;

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: serializeJsonLd(
            [
              webPageJsonLd({
                name: "PostBus pricing",
                description:
                  "Monthly and yearly plans for PostBus India Post shipping management software.",
                path: "/pricing",
              }),
              offerSchema,
              faqJsonLd(pricingFaqs),
            ].filter(Boolean)
          ),
        }}
      />
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
            description="Three plans billed in INR. New workspaces get a 3-day trial with every PostBus feature unlocked. Monthly or yearly (20% off). Order limits reset each billing period. India Post postage is billed separately."
          />
        </Container>
      </section>
      <section className="bg-surface py-16 sm:py-20">
        <Container>
          <PricingToggle plans={plans} />
        </Container>
      </section>
      <SeoFaq title="PostBus pricing questions" entries={pricingFaqs} />
      <FinalCta />
    </>
  );
}
