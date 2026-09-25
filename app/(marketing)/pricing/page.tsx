import type { Metadata } from "next";
import { FinalCta } from "@/components/landing/final-cta";
import { Container } from "@/components/ui/container";
import { SectionHeading } from "@/components/ui/section-heading";
import { PricingToggle } from "@/app/(marketing)/pricing/pricing-toggle";
import { createServerSupabase } from "@/lib/supabase/server";
import { siteConfig } from "@/lib/site-config";
import { mapPlan, type PlanRow } from "@/modules/billing/subscriptions";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "PostBus plans for Shopify India Post shipping automation — Starter, Pro, and Business with monthly or yearly billing.",
  keywords: [...siteConfig.keywords],
  alternates: { canonical: "/pricing" },
};

export default async function PricingPage() {
  const supabase = await createServerSupabase();
  const { data } = await supabase.from("plans").select("*").eq("is_active", true).order("display_order", { ascending: true });
  const plans = ((data ?? []) as PlanRow[]).map(mapPlan);

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
            description="Three plans. New workspaces get a 3-day trial with every PostBus feature unlocked. Monthly or yearly billing with 20% off annual. Order limits reset every billing period."
          />
        </Container>
      </section>
      <section className="bg-surface py-16 sm:py-20">
        <Container>
          <PricingToggle plans={plans} />
        </Container>
      </section>
      <FinalCta />
    </>
  );
}
