import { Faq } from "@/components/landing/faq";
import { faqs } from "@/components/landing/faq-data";
import { Features } from "@/components/landing/features";
import { FinalCta } from "@/components/landing/final-cta";
import { Hero } from "@/components/landing/hero";
import { HowItWorks } from "@/components/landing/how-it-works";
import { IndiaPostSection } from "@/components/landing/india-post-section";
import { PricingPreview } from "@/components/landing/pricing-preview";
import { ProblemSection } from "@/components/landing/problem-section";
import { TrustedIntegrations } from "@/components/landing/trusted-integrations";
import { Workflow } from "@/components/landing/workflow";
import { faqJsonLd, serializeJsonLd, webPageJsonLd } from "@/lib/seo/json-ld";
import { marketingMetadata } from "@/lib/seo/metadata";
import { siteConfig } from "@/lib/site-config";
import type { Metadata } from "next";

export const metadata: Metadata = marketingMetadata({
  title: siteConfig.seoTitle,
  description: siteConfig.description,
  path: "/",
  absoluteTitle: true,
});

export default function HomePage() {
  const schemas = [
    webPageJsonLd({
      name: siteConfig.seoTitle,
      description: siteConfig.description,
      path: "/",
    }),
    faqJsonLd(faqs),
  ];

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(schemas) }}
      />
      <Hero />
      <ProblemSection />
      <HowItWorks />
      <IndiaPostSection />
      <Features />
      <TrustedIntegrations />
      <Workflow />
      <PricingPreview />
      <Faq />
      <FinalCta />
    </>
  );
}
