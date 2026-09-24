"use client";

import { useState } from "react";
import { PlanPicker, type PublicPlan } from "@/components/billing/plan-picker";

export function PricingToggle({ plans }: { plans: PublicPlan[] }) {
  const [cycle, setCycle] = useState<"monthly" | "yearly">("monthly");
  return (
    <div>
      <div className="mb-8 flex justify-center">
        <div className="inline-flex rounded-full border border-border bg-white p-1 text-sm">
          <button
            type="button"
            className={`rounded-full px-4 py-2 font-medium ${cycle === "monthly" ? "bg-brand text-white" : "text-muted"}`}
            onClick={() => setCycle("monthly")}
          >
            Monthly
          </button>
          <button
            type="button"
            className={`rounded-full px-4 py-2 font-medium ${cycle === "yearly" ? "bg-brand text-white" : "text-muted"}`}
            onClick={() => setCycle("yearly")}
          >
            Yearly · 20% OFF
          </button>
        </div>
      </div>
      <PlanPicker plans={plans} cycle={cycle} cta="register" />
    </div>
  );
}
