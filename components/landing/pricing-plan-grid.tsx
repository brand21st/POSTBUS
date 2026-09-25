"use client";

import { useState } from "react";
import Link from "next/link";
import { Check } from "lucide-react";
import type { PublicPlan } from "@/components/billing/plan-picker";
import { yearlySavingsPaise } from "@/modules/billing/prices";
import { cn } from "@/lib/utils";

function formatOrderQuota(limit: number) {
  return limit.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function formatLandingPrice(paise: number) {
  return `₹${formatOrderQuota(Math.round(paise / 100))}`;
}

function getPreviewFeatures(plan: PublicPlan) {
  const quotaCopy = `Up to ${formatOrderQuota(plan.monthlyOrderLimit)} orders/month`;
  const features = (plan.features.length ? plan.features : [quotaCopy]).filter(
    (feature) => !/^up to [\d,]+ orders/i.test(feature)
  );
  const preview = [quotaCopy, ...features].slice(0, 6);
  const priorityFeatures = ["WhatsApp (Wati) notifications", "Custom packing labels"];
  let replaceIndex = preview.length - 1;

  for (const feature of priorityFeatures) {
    if (features.includes(feature) && !preview.includes(feature)) {
      preview[replaceIndex] = feature;
      replaceIndex = Math.max(0, replaceIndex - 1);
    }
  }

  return preview;
}

export function PricingPlanGrid({ plans }: { plans: PublicPlan[] }) {
  const [cycle, setCycle] = useState<"monthly" | "yearly">("monthly");

  return (
    <>
      <div
        className="mx-auto mt-7 flex w-full max-w-[340px] items-center rounded-full bg-white p-1.5 shadow-[0_10px_30px_rgba(15,23,42,0.08)] ring-1 ring-zinc-200 sm:inline-flex sm:w-auto sm:max-w-none"
        role="group"
        aria-label="Billing cycle"
      >
        <button
          type="button"
          onClick={() => setCycle("monthly")}
          aria-pressed={cycle === "monthly"}
          className={cn(
            "flex-1 rounded-full px-4 py-2.5 text-sm font-bold transition-all sm:flex-none sm:px-6",
            cycle === "monthly" ? "bg-brand text-white shadow-sm" : "text-zinc-600"
          )}
        >
          Monthly
        </button>
        <button
          type="button"
          onClick={() => setCycle("yearly")}
          aria-pressed={cycle === "yearly"}
          className={cn(
            "flex-1 rounded-full px-4 py-2.5 text-sm font-bold transition-all sm:flex-none sm:px-5",
            cycle === "yearly" ? "bg-brand text-white shadow-sm" : "text-zinc-600"
          )}
        >
          Yearly · 20% OFF
        </button>
      </div>

      <div
        className="-mx-5 mt-10 flex snap-x gap-4 overflow-x-auto px-5 pb-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:-mx-6 sm:px-6 lg:mx-0 lg:mt-12 lg:grid lg:grid-cols-3 lg:gap-6 lg:overflow-visible lg:px-0 lg:pb-0"
        aria-label="PostBus plans"
      >
        {plans.map((plan) => {
          const featured = plan.slug === "pro";
          const price =
            cycle === "yearly" ? plan.yearlyPricePaise : plan.monthlyPricePaise;
          const previewFeatures = getPreviewFeatures(plan);

          return (
            <article
              key={plan.name}
              className={cn(
                "relative flex w-[82vw] max-w-[340px] flex-none snap-center rounded-[24px] border bg-white p-5 shadow-[0_12px_40px_rgba(15,23,42,0.04)] transition-all duration-200 hover:-translate-y-1 hover:shadow-xl hover:shadow-zinc-200/60 sm:w-[360px] sm:max-w-none sm:p-7 lg:w-auto",
                featured
                  ? "border-brand/60 ring-2 ring-brand/15"
                  : "border-zinc-200/80"
              )}
            >
              {featured ? (
                <span className="absolute right-6 top-6 rounded-lg bg-brand px-3 py-1.5 text-xs font-bold text-white shadow-sm">
                  Popular
                </span>
              ) : null}

              <div className="flex min-h-[480px] w-full flex-col sm:min-h-[520px] lg:min-h-[560px]">
                <div>
                  <h3 className="pr-20 text-xl font-bold tracking-tight text-ink sm:text-2xl">
                    {plan.name}
                  </h3>
                  <p className="mt-1 text-sm font-medium leading-relaxed text-muted sm:pr-20">
                    {plan.description}
                  </p>

                  <div className="mt-7 flex items-end gap-2 sm:mt-8">
                    <span className="text-3xl font-extrabold tracking-tight text-ink sm:text-[44px]">
                      {formatLandingPrice(price)}
                    </span>
                    <span className="pb-1 text-sm font-medium text-muted sm:pb-1.5 sm:text-base">
                      /{cycle === "yearly" ? "year" : "month"}
                    </span>
                  </div>

                  {cycle === "yearly" ? (
                    <p className="mt-1 text-xs font-semibold text-brand">
                      Save {formatLandingPrice(yearlySavingsPaise(plan.monthlyPricePaise))}/year
                    </p>
                  ) : (
                    <p className="mt-1 text-xs text-muted">
                      Up to {formatOrderQuota(plan.monthlyOrderLimit)} orders/month
                    </p>
                  )}

                  <ul className="mt-7 space-y-3.5 sm:mt-8 sm:space-y-4">
                    {previewFeatures.map((feature) => (
                      <li
                        key={feature}
                        className="flex items-start gap-3 text-sm font-medium text-zinc-700"
                      >
                        <Check className="mt-0.5 size-4 shrink-0 text-brand stroke-[3]" />
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>

                  {plan.features.length > previewFeatures.length ? (
                    <Link
                      href="/pricing"
                      className="mt-4 inline-flex text-xs font-bold text-brand hover:underline"
                    >
                      View all included features
                    </Link>
                  ) : null}
                </div>

                <Link
                  href="/register"
                  className={cn(
                    "mt-auto inline-flex h-12 w-full items-center justify-center rounded-xl border text-sm font-bold transition-all duration-200",
                    featured
                      ? "border-brand bg-brand text-white shadow-sm hover:bg-brand-dark hover:shadow-md"
                      : "border-brand/45 bg-white text-brand hover:border-brand hover:bg-brand/5"
                  )}
                >
                  Start Free Trial
                </Link>
              </div>
            </article>
          );
        })}
      </div>
    </>
  );
}
