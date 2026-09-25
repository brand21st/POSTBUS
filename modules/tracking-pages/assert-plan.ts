import type { SupabaseClient } from "@supabase/supabase-js";
import { FEATURE, assertPlanFeature } from "@/modules/billing/entitlements";

export async function assertTrackingPagePlan(supabase: SupabaseClient, organizationId: string) {
  await assertPlanFeature(supabase, organizationId, FEATURE.trackingPage);
}
