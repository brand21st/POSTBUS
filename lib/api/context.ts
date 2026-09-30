import { cache } from "react";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { hasPermission, permissionsFor } from "@/lib/permissions/rbac";
import { getRequestAuthUser } from "@/lib/supabase/request-auth";
import type { MemberRole, Permission } from "@/types/domain";

export type TenantContext = {
  userId: string;
  email: string | null;
  fullName: string | null;
  organizationId: string;
  organizationName: string;
  role: MemberRole;
  permissions: Permission[];
};

const resolveRequestTenant = cache(async (): Promise<TenantContext> => {
  const { supabase, user } = await getRequestAuthUser();

  if (!user) {
    throw new AppError(ERROR_CODES.AUTH_REQUIRED, "Please sign in to continue.");
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, email, full_name, active_organization_id")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError) {
    throw new AppError(ERROR_CODES.AUTH_REQUIRED, "Unable to load your profile.");
  }

  const organizationId = profile?.active_organization_id as string | null;
  if (!organizationId) {
    throw new AppError(
      ERROR_CODES.TENANT_ACCESS_DENIED,
      "Select or create a workspace to continue."
    );
  }

  const { data: membership, error: memberError } = await supabase
    .from("organization_members")
    .select("role, organizations(id, name)")
    .eq("organization_id", organizationId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (memberError || !membership) {
    throw new AppError(
      ERROR_CODES.TENANT_ACCESS_DENIED,
      "You do not have access to this workspace."
    );
  }

  const role = membership.role as MemberRole;
  const organization = Array.isArray(membership.organizations)
    ? membership.organizations[0]
    : membership.organizations;

  return {
    userId: user.id,
    email: profile?.email ?? user.email ?? null,
    fullName: profile?.full_name ?? null,
    organizationId,
    organizationName: organization?.name ?? "Workspace",
    role,
    permissions: permissionsFor(role),
  };
});

export async function requireTenant(permission?: Permission): Promise<TenantContext> {
  const ctx = await resolveRequestTenant();
  if (permission && !hasPermission(ctx.role, permission)) {
    throw new AppError(
      ERROR_CODES.FORBIDDEN,
      "You do not have permission to perform this action."
    );
  }
  return ctx;
}
