import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { logInfo } from "@/lib/logger";

export async function createOrganization(
  supabase: SupabaseClient,
  userId: string,
  name: string
) {
  const { data: rpcOrg, error: rpcError } = await supabase.rpc("create_organization_for_user", {
    p_name: name,
  });

  const org = Array.isArray(rpcOrg) ? rpcOrg[0] : rpcOrg;
  if (rpcError || !org) {
    throw new AppError(
      ERROR_CODES.VALIDATION_ERROR,
      rpcError?.message || "Could not create workspace."
    );
  }

  logInfo("organization.created", { organizationId: org.id, userId });
  return org;
}

export async function switchOrganization(
  supabase: SupabaseClient,
  userId: string,
  organizationId: string
) {
  const { data: membership } = await supabase
    .from("organization_members")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!membership) {
    throw new AppError(ERROR_CODES.TENANT_ACCESS_DENIED, "You are not a member of that workspace.");
  }

  const { error } = await supabase
    .from("profiles")
    .update({ active_organization_id: organizationId })
    .eq("id", userId);

  if (error) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  }
}

export async function listMemberships(supabase: SupabaseClient, userId: string) {
  const { data, error } = await supabase
    .from("organization_members")
    .select("role, organization_id, organizations(id, name, slug)")
    .eq("user_id", userId);
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  return data ?? [];
}
