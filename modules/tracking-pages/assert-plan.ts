import type { SupabaseClient } from "@supabase/supabase-js";
import { FEATURE, assertPlanFeature } from "@/modules/billing/entitlements";

/** Pass method "GET" for read-only routes: settings stay readable after coverage ends. */
export async function assertTrackingPagePlan(supabase: SupabaseClient, organizationId: string, method?: string) {
  await assertPlanFeature(supabase, organizationId, FEATURE.trackingPage, { method });
}
