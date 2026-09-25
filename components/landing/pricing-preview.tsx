import { PricingPlanGrid } from "@/components/landing/pricing-plan-grid";
import { Container } from "@/components/ui/container";
import { createServerSupabase } from "@/lib/supabase/server";
import { mapPlan, type PlanRow } from "@/modules/billing/subscriptions";

export async function PricingPreview() {
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from("plans")
    .select("*")
    .eq("is_active", true)
    .order("display_order", { ascending: true });
  const plans = ((data ?? []) as PlanRow[]).map(mapPlan);

  return (
    <section id="pricing" className="bg-white py-14 sm:py-20 lg:py-24">
      <Container>
        <div className="mx-auto max-w-3xl text-center">
          <p className="inline-flex rounded-full bg-brand/10 px-4 py-1.5 text-xs font-bold uppercase tracking-[0.18em] text-brand">
            Simple pricing
          </p>
          <h2 className="mt-4 text-3xl font-bold tracking-tight text-ink sm:text-4xl lg:text-[42px]">
            Choose a plan after a full-feature trial
          </h2>
          <p className="mt-3 text-base text-muted sm:text-lg">
            New accounts get 3 days with every PostBus feature unlocked. Then pick a plan by
            monthly India Post booking volume. Postage is billed by India Post, not PostBus.
          </p>
        </div>

        {plans.length ? (
          <PricingPlanGrid plans={plans} />
        ) : (
          <p className="mt-10 text-center text-sm text-muted">
            Plans are loading from billing. Check{" "}
            <a href="/pricing" className="font-semibold text-brand hover:underline">
              the pricing page
            </a>{" "}
            or start a trial and choose a plan in the dashboard.
          </p>
        )}
      </Container>
    </section>
  );
}
