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
    .select("role, organization_id, organizations(id, name, slug, created_at)")
    .eq("user_id", userId);
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  return (data ?? []).sort((a, b) => {
    const left = Array.isArray(a.organizations) ? a.organizations[0] : a.organizations;
    const right = Array.isArray(b.organizations) ? b.organizations[0] : b.organizations;
    return String(left?.created_at ?? "").localeCompare(String(right?.created_at ?? ""));
  });
}

function orgFromMembership(item: {
  role: string;
  organization_id: string;
  organizations: { id: string; name: string; slug: string; created_at?: string } | { id: string; name: string; slug: string; created_at?: string }[] | null;
}) {
  const org = Array.isArray(item.organizations) ? item.organizations[0] : item.organizations;
  return org ? { id: org.id, name: org.name, slug: org.slug, role: item.role } : null;
}

function defaultWorkspaceName(fullName?: string | null, email?: string | null) {
  const fromName = fullName?.trim();
  if (fromName && fromName.length >= 2) return fromName;
  const fromEmail = email?.split("@")[0]?.trim();
  if (fromEmail && fromEmail.length >= 2) return fromEmail;
  return "Workspace";
}

export async function ensureActiveWorkspace(
  supabase: SupabaseClient,
  userId: string,
  options?: { fullName?: string | null; email?: string | null; activeOrganizationId?: string | null }
) {
  let memberships = await listMemberships(supabase, userId);
  if (memberships.length === 0) {
    await createOrganization(supabase, userId, defaultWorkspaceName(options?.fullName, options?.email));
    memberships = await listMemberships(supabase, userId);
    const created = memberships[0];
    return {
      memberships,
      current: created ? orgFromMembership(created) : null,
      role: created?.role ?? null,
    };
  }

  const activeId = options?.activeOrganizationId;
  const active = memberships.find((item) => item.organization_id === activeId) ?? memberships[0];
  if (active && active.organization_id !== activeId) {
    await switchOrganization(supabase, userId, active.organization_id);
  }

  return {
    memberships,
    current: active ? orgFromMembership(active) : null,
    role: active?.role ?? null,
  };
}
