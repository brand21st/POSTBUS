import type { ReactNode } from "react";
import type { Metadata } from "next";
import { BillingAnnouncementBar } from "@/components/dashboard/billing-announcement-bar";
import { DashboardShell } from "@/components/dashboard/shell";
import {
  billingAnnouncementPhase,
  type AnnouncementPlan,
} from "@/lib/dashboard/billing-announcement";
import { createServerSupabase } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: {
    default: "Dashboard",
    template: "%s · PostBus",
  },
  robots: { index: false, follow: false },
};

async function loadAnnouncementPlans(): Promise<AnnouncementPlan[]> {
  try {
    const supabase = await createServerSupabase();
    const { data } = await supabase
      .from("plans")
      .select("name, monthly_price_paise")
      .eq("is_active", true)
      .order("display_order", { ascending: true });
    return (data ?? [])
      .map((row) => ({
        name: String(row.name ?? "").trim(),
        monthlyPricePaise: Number(row.monthly_price_paise),
      }))
      .filter((plan) => plan.name && Number.isFinite(plan.monthlyPricePaise));
  } catch {
    return [];
  }
}

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const phase = billingAnnouncementPhase(new Date());
  const plans = phase === "billing" ? await loadAnnouncementPlans() : [];
  return (
    <DashboardShell
      announcement={<BillingAnnouncementBar phase={phase} plans={plans} />}
    >
      {children}
    </DashboardShell>
  );
}
