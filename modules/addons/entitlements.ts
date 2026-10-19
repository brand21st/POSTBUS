import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import {
  AI_ACCOUNTANT_SLUG,
  type AddonAccessMode,
} from "@/modules/addons/constants";

export type AddonEntitlementRow = {
  organization_id: string;
  addon_slug: string;
  status: string;
  access_mode: AddonAccessMode;
  current_period_start: string | null;
  current_period_end: string | null;
  source_subscription_id: string | null;
};

export function accessModeForAddonStatus(input: {
  status: string;
  currentPeriodEnd?: string | null;
  now?: Date;
}): AddonAccessMode {
  const now = input.now ?? new Date();
  const periodEnd = input.currentPeriodEnd ? new Date(input.currentPeriodEnd) : null;
  const periodOpen = Boolean(periodEnd && periodEnd.getTime() > now.getTime());
  if (input.status === "ACTIVE") return periodOpen || !periodEnd ? "FULL" : "READ_ONLY";
  if (input.status === "CANCELLED") return periodOpen ? "FULL" : "READ_ONLY";
  if (input.status === "EXPIRED") return "READ_ONLY";
  return "NONE";
}

export async function listOrganizationAddonEntitlements(
  supabase: SupabaseClient,
  organizationId: string
): Promise<AddonEntitlementRow[]> {
  const { data, error } = await supabase
    .from("organization_entitlements")
    .select(
      "organization_id, addon_slug, status, access_mode, current_period_start, current_period_end, source_subscription_id"
    )
    .eq("organization_id", organizationId);
  if (error) return [];
  return (data ?? []) as AddonEntitlementRow[];
}

export async function getAddonEntitlement(
  supabase: SupabaseClient,
  organizationId: string,
  slug = AI_ACCOUNTANT_SLUG
): Promise<AddonEntitlementRow | null> {
  const { data } = await supabase
    .from("organization_entitlements")
    .select(
      "organization_id, addon_slug, status, access_mode, current_period_start, current_period_end, source_subscription_id"
    )
    .eq("organization_id", organizationId)
    .eq("addon_slug", slug)
    .maybeSingle();
  return (data as AddonEntitlementRow | null) ?? null;
}

export async function getAddonAccessMode(
  supabase: SupabaseClient,
  organizationId: string,
  slug = AI_ACCOUNTANT_SLUG
): Promise<AddonAccessMode> {
  const row = await getAddonEntitlement(supabase, organizationId, slug);
  if (!row) return "NONE";
  return accessModeForAddonStatus({
    status: row.status,
    currentPeriodEnd: row.current_period_end,
  });
}

export async function assertAddonEntitlement(
  supabase: SupabaseClient,
  organizationId: string,
  options?: { slug?: string; write?: boolean }
) {
  const mode = await getAddonAccessMode(supabase, organizationId, options?.slug ?? AI_ACCOUNTANT_SLUG);
  if (mode === "NONE") {
    throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "AI Accountant is not available for this workspace.");
  }
  if (options?.write && mode !== "FULL") {
    throw new AppError(ERROR_CODES.FORBIDDEN, "AI Accountant is read-only for this workspace.");
  }
  return mode;
}

export async function upsertAddonEntitlement(
  supabase: SupabaseClient,
  input: {
    organizationId: string;
    slug: string;
    status: string;
    currentPeriodStart?: string | null;
    currentPeriodEnd?: string | null;
    sourceSubscriptionId?: string | null;
  }
) {
  const accessMode = accessModeForAddonStatus({
    status: input.status,
    currentPeriodEnd: input.currentPeriodEnd,
  });
  const { error } = await supabase.from("organization_entitlements").upsert(
    {
      organization_id: input.organizationId,
      addon_slug: input.slug,
      status: input.status,
      access_mode: accessMode,
      current_period_start: input.currentPeriodStart ?? null,
      current_period_end: input.currentPeriodEnd ?? null,
      source_subscription_id: input.sourceSubscriptionId ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "organization_id,addon_slug" }
  );
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  return accessMode;
}
