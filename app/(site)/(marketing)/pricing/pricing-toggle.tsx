"use client";

import { useState } from "react";
import { PlanPicker, type PublicPlan } from "@/components/billing/plan-picker";

export function PricingToggle({ plans, inclusiveLabel = false }: { plans: PublicPlan[]; inclusiveLabel?: boolean }) {
  const [cycle, setCycle] = useState<"monthly" | "yearly">("monthly");
  return (
    <div>
      <div className="mb-8 text-center text-sm text-muted">
        New accounts get a 7-day trial with every feature from every plan.
      </div>
      <div className="mb-8 flex justify-center">
        <div className="inline-flex rounded-full border border-border bg-white p-1 text-sm">
          <button
            type="button"
            aria-pressed={cycle === "monthly"}
            className={`rounded-full px-4 py-2 font-medium ${cycle === "monthly" ? "bg-brand text-white" : "text-muted"}`}
            onClick={() => setCycle("monthly")}
          >
            Monthly
          </button>
          <button
            type="button"
            aria-pressed={cycle === "yearly"}
            className={`rounded-full px-4 py-2 font-medium ${cycle === "yearly" ? "bg-brand text-white" : "text-muted"}`}
            onClick={() => setCycle("yearly")}
          >
            Yearly · 20% OFF
          </button>
        </div>
      </div>
      <PlanPicker plans={plans} cycle={cycle} cta="register" inclusiveLabel={inclusiveLabel} />
    </div>
  );
}
