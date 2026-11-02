import type { ReactNode } from "react";
import type { Metadata } from "next";
import { BillingAnnouncementBar } from "@/components/dashboard/billing-announcement-bar";
import { TrialStatusBar } from "@/components/dashboard/trial-status-bar";
import { DashboardShell } from "@/components/dashboard/shell";
import {
  billingAnnouncementPhase,
  type AnnouncementPlan,
} from "@/lib/dashboard/billing-announcement";
import { organizationHasPaidPlan, pickDashboardTopBanner } from "@/lib/dashboard/top-banner";
import { getOrganizationEntitlements } from "@/modules/billing/entitlements";
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

async function loadTopAnnouncement() {
  const phase = billingAnnouncementPhase(new Date());
  try {
    const supabase = await createServerSupabase();
    const { data: auth } = await supabase.auth.getUser();
    if (auth.user) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("active_organization_id")
        .eq("id", auth.user.id)
        .maybeSingle();
      const organizationId = profile?.active_organization_id as string | null;
      if (organizationId) {
        const entitlements = await getOrganizationEntitlements(supabase, organizationId);
        const banner = pickDashboardTopBanner({
          phase,
          trialLive: entitlements.trial,
          trialEnd: entitlements.trialEnd,
          trialCohort: entitlements.trialCohort,
          paidPlan: organizationHasPaidPlan({
            status: entitlements.status,
            trialLive: entitlements.trial,
            coverageEnded: entitlements.coverageEnded,
          }),
        });
        if (banner.kind === "none") return null;
        if (banner.kind === "trial") {
          return <TrialStatusBar {...banner.copy} />;
        }
      }
    }
  } catch {
    // Fall through to the calendar billing banner.
  }
  const plans = phase === "billing" ? await loadAnnouncementPlans() : [];
  return <BillingAnnouncementBar phase={phase} plans={plans} />;
}

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const announcement = await loadTopAnnouncement();
  return <DashboardShell announcement={announcement}>{children}</DashboardShell>;
}
