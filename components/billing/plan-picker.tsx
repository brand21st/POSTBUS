"use client";

import { CheckoutButton } from "@/components/billing/checkout-button";
import { buttonVariants } from "@/components/ui/button";
import { formatPaise } from "@/lib/format";
import { yearlySavingsPaise } from "@/modules/billing/prices";
import { cn } from "@/lib/utils";
import { Check } from "lucide-react";
import Link from "next/link";

export type PublicPlan = {
  id: string;
  slug: string;
  name: string;
  description?: string | null;
  monthlyPricePaise: number;
  yearlyPricePaise: number;
  monthlyOrderLimit: number;
  features: string[];
};

export function PlanPicker({
  plans,
  cycle,
  cta = "checkout",
}: {
  plans: PublicPlan[];
  cycle: "monthly" | "yearly";
  cta?: "checkout" | "register";
}) {
  return (
    <div className="grid gap-5 lg:grid-cols-3">
      {plans.map((plan) => {
        const featured = plan.slug === "pro";
        const price = cycle === "yearly" ? plan.yearlyPricePaise : plan.monthlyPricePaise;
        const savings = yearlySavingsPaise(plan.monthlyPricePaise);
        return (
          <article
            key={plan.id}
            className={cn(
              "flex flex-col rounded-[28px] border bg-white p-7 card-shadow",
              featured ? "border-brand shadow-[0_0_0_1px_rgba(225,29,72,0.15)]" : "border-border"
            )}
          >
            {featured ? (
              <span className="mb-4 w-fit rounded-full bg-brand/10 px-2.5 py-1 text-[11px] font-semibold text-brand">
                Popular
              </span>
            ) : (
              <span className="mb-4 h-6" />
            )}
            <h2 className="text-2xl font-semibold tracking-tight text-ink">{plan.name}</h2>
            <p className="mt-3 text-sm leading-relaxed text-muted">{plan.description}</p>
            <p className="mt-6 text-3xl font-semibold tracking-tight text-ink">
              {formatPaise(price)}
              <span className="text-sm font-medium text-muted">{cycle === "yearly" ? "/year" : "/month"}</span>
            </p>
            {cycle === "yearly" ? (
              <p className="mt-1 text-xs font-medium text-brand">
                Save {formatPaise(savings)}/year · about 2 months free
              </p>
            ) : (
              <p className="mt-1 text-xs text-muted">Up to {plan.monthlyOrderLimit.toLocaleString("en-IN")} orders/month</p>
            )}
            <ul className="mt-6 space-y-3">
              {(plan.features.length ? plan.features : [`Up to ${plan.monthlyOrderLimit.toLocaleString("en-IN")} orders/month`]).map(
                (point) => (
                  <li key={point} className="flex gap-2 text-sm text-foreground">
                    <Check className="mt-0.5 size-4 shrink-0 text-brand" />
                    {point}
                  </li>
                )
              )}
            </ul>
            <div className="mt-8">
              {cta === "checkout" ? (
                <CheckoutButton
                  planId={plan.id}
                  billingCycle={cycle}
                  label={featured ? "Upgrade to Pro" : `Choose ${plan.name}`}
                  variant={featured ? "primary" : "secondary"}
                />
              ) : (
                <Link
                  href={`/register?plan=${plan.slug}&cycle=${cycle}`}
                  className={cn(buttonVariants({ variant: featured ? "primary" : "secondary", size: "lg" }), "w-full")}
                >
                  Get started
                </Link>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}
