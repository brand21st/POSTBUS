import type { SupabaseClient } from "@supabase/supabase-js";
import { getAddonEntitlement } from "@/modules/addons/entitlements";
import { remainingAssistantQuota } from "@/modules/ai-accountant/assistant/run";
import { loadAccountingWorkspace } from "@/modules/ai-accountant/settings";

export type SetupStepKey = "gst" | "tax_rates" | "costs" | "sync" | "cod";

export type SetupStep = { key: SetupStepKey; done: boolean };

/** Ordered setup steps; pure so the UI and tests agree on what "set up" means. */
export function setupSteps(input: {
  gstReady: boolean;
  productsMissingRate: number;
  hasDefaultRate: boolean;
  costsReady: boolean;
  lastSyncedAt: string | null;
  codToReview: number;
}): SetupStep[] {
  return [
    { key: "gst", done: input.gstReady },
    { key: "tax_rates", done: input.hasDefaultRate || input.productsMissingRate === 0 },
    { key: "costs", done: input.costsReady },
    { key: "sync", done: Boolean(input.lastSyncedAt) },
    { key: "cod", done: input.codToReview === 0 },
  ];
}

/**
 * Lightweight status for the section header and nav badges: add-on period,
 * assistant quota, setup progress and counts of things that need attention.
 */
export async function loadAccountantStatus(supabase: SupabaseClient, organizationId: string) {
  const [workspace, entitlement, quota, products, profiles, costs, cod] = await Promise.all([
    loadAccountingWorkspace(supabase, organizationId),
    getAddonEntitlement(supabase, organizationId),
    remainingAssistantQuota(supabase, organizationId),
    supabase.from("products").select("id").eq("organization_id", organizationId).eq("active", true).limit(5000),
    supabase.from("product_tax_profiles").select("product_id").eq("organization_id", organizationId).limit(20000),
    supabase.from("product_costs").select("product_id").eq("organization_id", organizationId).limit(20000),
    supabase
      .from("cod_reconciliations")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .in("status", ["NEEDS_REVIEW", "UNMATCHED"]),
  ]);
  const active = (products.data ?? []).map((row) => row.id as string);
  const withRate = new Set((profiles.data ?? []).map((row) => row.product_id as string));
  const withCost = new Set((costs.data ?? []).map((row) => row.product_id as string));
  const productsMissingRate = active.filter((id) => !withRate.has(id)).length;
  const productsMissingCost = active.filter((id) => !withCost.has(id)).length;
  const settings = workspace.settings;
  const steps = setupSteps({
    gstReady: workspace.setup.gstReady,
    productsMissingRate,
    hasDefaultRate: settings?.default_rate_bps != null,
    costsReady: workspace.setup.costsReady,
    lastSyncedAt: settings?.last_synced_at ?? null,
    codToReview: cod.count ?? 0,
  });
  return {
    addon: {
      status: entitlement?.status ?? "NOT_INSTALLED",
      currentPeriodEnd: entitlement?.current_period_end ?? null,
    },
    quota,
    gst: { registered: settings?.gst_registered ?? null, gstin: workspace.registration?.gstin ?? null },
    lastSyncedAt: settings?.last_synced_at ?? null,
    counts: {
      activeProducts: active.length,
      productsMissingRate,
      productsMissingCost,
      codToReview: cod.count ?? 0,
    },
    setup: { steps, done: steps.filter((step) => step.done).length, total: steps.length },
  };
}

export type AccountantStatus = Awaited<ReturnType<typeof loadAccountantStatus>>;
