import { createServerSupabase } from "@/lib/supabase/server";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { hasPermission } from "@/lib/permissions/rbac";
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

export async function requireTenant(permission?: Permission): Promise<TenantContext> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

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
  if (permission && !hasPermission(role, permission)) {
    throw new AppError(
      ERROR_CODES.FORBIDDEN,
      "You do not have permission to perform this action."
    );
  }

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
    permissions: [],
  };
}

export async function getOptionalUser() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}
