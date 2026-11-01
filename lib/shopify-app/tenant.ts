import type { SupabaseClient } from "@supabase/supabase-js";
import type { TenantContext } from "@/lib/api/context";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { logError } from "@/lib/logger";
import { permissionsFor } from "@/lib/permissions/rbac";
import { requireShopifyAppContext, type ShopifyAppContext } from "@/lib/shopify-app/context";
import { ensureInstallationPrincipal } from "@/lib/shopify-app/principal";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  createPrincipalSupabase,
  principalAccessToken,
  type PrincipalSessionRow,
} from "@/lib/supabase/principal-client";
import type { MemberRole } from "@/types/domain";

export type ShopifyTenant = {
  ctx: TenantContext;
  /** Runs as the installation principal: RLS and auth.uid() apply exactly as for a dashboard user. */
  supabase: SupabaseClient;
  shop: ShopifyAppContext;
};

type PrincipalRow = PrincipalSessionRow & { organization_id: string; shop_domain: string };

const PRINCIPAL_COLUMNS =
  "id, organization_id, shop_domain, principal_user_id, encrypted_principal_secret, encrypted_principal_session, principal_session_expires_at, principal_session_version";

async function loadPrincipalRow(installationId: string, organizationId: string) {
  const { data, error } = await createAdminClient()
    .from("shopify_app_installations")
    .select(PRINCIPAL_COLUMNS)
    .eq("id", installationId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error || !data) {
    throw new AppError(ERROR_CODES.AUTH_UNAVAILABLE, "Shopify installation is missing.");
  }
  return data as PrincipalRow;
}

async function recordStaffSeen(installationId: string, shopifyUserId: string | null) {
  if (!shopifyUserId) return;
  const { error } = await createAdminClient()
    .from("shopify_app_staff")
    .upsert(
      { installation_id: installationId, shopify_user_id: shopifyUserId, last_seen_at: new Date().toISOString() },
      { onConflict: "installation_id,shopify_user_id" }
    );
  if (error) logError("shopify_app.staff_seen_failed", { installationId, message: error.message });
}

/**
 * Resolves the Shopify session token into the same TenantContext the dashboard uses, acting as the
 * installation's principal. Shopify staff identity stays in shop.shopifyUserId (and shopify_app_staff).
 */
export async function requireShopifyTenant(request: Request): Promise<ShopifyTenant> {
  const shop = await requireShopifyAppContext(request);
  const row = await loadPrincipalRow(shop.installationId, shop.organizationId);
  const principalUserId = await ensureInstallationPrincipal(row);
  // A newly attached principal has no session yet; reload so the version/session are current.
  const sessionRow = row.encrypted_principal_secret ? row : await loadPrincipalRow(shop.installationId, shop.organizationId);

  const supabase = createPrincipalSupabase(await principalAccessToken(sessionRow));

  const { data: membership, error } = await supabase
    .from("organization_members")
    .select("role, organizations(id, name)")
    .eq("organization_id", shop.organizationId)
    .eq("user_id", principalUserId)
    .maybeSingle();
  if (error || !membership) {
    throw new AppError(ERROR_CODES.TENANT_ACCESS_DENIED, "This shop no longer has access to its PostBus workspace.");
  }

  await recordStaffSeen(shop.installationId, shop.shopifyUserId);

  const role = membership.role as MemberRole;
  const organization = Array.isArray(membership.organizations)
    ? membership.organizations[0]
    : membership.organizations;

  return {
    ctx: {
      userId: principalUserId,
      email: null,
      fullName: `Shopify (${shop.shopDomain})`,
      organizationId: shop.organizationId,
      organizationName: (organization as { name?: string } | null)?.name ?? "Workspace",
      role,
      permissions: permissionsFor(role),
    },
    supabase,
    shop,
  };
}
