import { AutomationSection } from "@/components/landing/automation-section";
import { AutomationShowcase } from "@/components/landing/automation-showcase";
import { Benefits } from "@/components/landing/benefits";
import { Faq } from "@/components/landing/faq";
import { Features } from "@/components/landing/features";
import { FinalCta } from "@/components/landing/final-cta";
import { Hero } from "@/components/landing/hero";
import { HowItWorks } from "@/components/landing/how-it-works";
import { IndiaPostSection } from "@/components/landing/india-post-section";
import { PricingPreview } from "@/components/landing/pricing-preview";
import { ProblemSection } from "@/components/landing/problem-section";
import { ProductShowcase } from "@/components/landing/product-showcase";
import { SecuritySection } from "@/components/landing/security-section";
import { ShopifySection } from "@/components/landing/shopify-section";
import { TrustedIntegrations } from "@/components/landing/trusted-integrations";
import { Workflow } from "@/components/landing/workflow";

export default function HomePage() {
  return (
    <>
      <Hero />
      <TrustedIntegrations />
      <ProblemSection />
      <Workflow />
      <Features />
      <AutomationShowcase />
      <HowItWorks />
      <AutomationSection />
      <Benefits />
      <ShopifySection />
      <IndiaPostSection />
      <ProductShowcase />
      <SecuritySection />
      <PricingPreview />
      <Faq />
      <FinalCta />
    </>
  );
}
