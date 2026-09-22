import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { logError, logInfo } from "@/lib/logger";
import { provisionTrackingPage } from "@/modules/tracking-pages/service";

type MembershipRow = {
  role: string;
  organization_id: string;
  organizations:
    | { id: string; name: string; slug: string; created_at?: string }
    | { id: string; name: string; slug: string; created_at?: string }[]
    | null;
};

async function ensureTrackingPage(
  supabase: SupabaseClient,
  userId: string,
  organization: { id: string; name: string }
) {
  try {
    await provisionTrackingPage(supabase, {
      userId,
      organizationId: organization.id,
      organizationName: organization.name,
    });
  } catch (error) {
    logError("tracking_page.provision_failed", {
      organizationId: organization.id,
      message: error instanceof Error ? error.message : "Could not create the tracking URL.",
    });
  }
}

function orgFromMembership(item: MembershipRow) {
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

async function setActiveOrganization(supabase: SupabaseClient, userId: string, organizationId: string) {
  const { error } = await supabase
    .from("profiles")
    .update({ active_organization_id: organizationId })
    .eq("id", userId);
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
}

export async function createOrganization(
  supabase: SupabaseClient,
  userId: string,
  name: string
) {
  const existing = await listMemberships(supabase, userId);
  if (existing[0]) {
    const org = orgFromMembership(existing[0]);
    if (org) await setActiveOrganization(supabase, userId, existing[0].organization_id);
    return org;
  }

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
  await ensureTrackingPage(supabase, userId, { id: org.id, name: org.name ?? name });
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

  await setActiveOrganization(supabase, userId, organizationId);
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
  }

  const canonical =
    memberships.find((item) => item.organization_id === options?.activeOrganizationId) ??
    memberships[0];
  if (canonical && canonical.organization_id !== options?.activeOrganizationId) {
    await setActiveOrganization(supabase, userId, canonical.organization_id);
  }

  const current = canonical ? orgFromMembership(canonical) : null;
  if (current) {
    await ensureTrackingPage(supabase, userId, current);
  }

  return {
    memberships: canonical ? [canonical] : [],
    current,
    role: canonical?.role ?? null,
  };
}
