import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { env } from "@/lib/env";
import { logInfo } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { SHOPIFY_APP_ORG_ORIGIN } from "@/lib/shopify-app/constants";
import { normalizeShopifyShopDomain } from "@/lib/shopify-app/shop-domain";

export type ShopifyAppInstallationRow = {
  id: string;
  shop_domain: string;
  organization_id: string;
  app_client_id: string;
  status: string;
  encrypted_access_token: string | null;
  encrypted_refresh_token: string | null;
  token_expires_at: string | null;
  refresh_token_expires_at: string | null;
  granted_scopes: string | null;
  last_shopify_user_id: string | null;
  uninstalled_at: string | null;
  token_version: number;
};

export async function provisionShopifyAppOrganization(input: {
  shopDomain: string;
  shopifyUserId?: string | null;
  shopName?: string | null;
}) {
  const shopDomain = normalizeShopifyShopDomain(input.shopDomain);
  const appClientId = env.shopifyPublicAppClientId;
  if (!appClientId) {
    throw new AppError(ERROR_CODES.AUTH_UNAVAILABLE, "Shopify public app is not configured.");
  }

  const admin = createAdminClient();
  const name = input.shopName?.trim() || shopDomain.replace(".myshopify.com", "");
  const { data, error } = await admin.rpc("provision_shopify_app_organization", {
    p_shop_domain: shopDomain,
    p_app_client_id: appClientId,
    p_name: name,
  });

  if (error || !data) {
    throw new AppError(
      ERROR_CODES.VALIDATION_ERROR,
      "Could not create a PostBus workspace for this shop."
    );
  }

  const row = Array.isArray(data) ? data[0] : data;
  const organizationId = String(row.org_id ?? row.organization_id);
  const installationId = String(row.install_id ?? row.installation_id);
  const created = Boolean(row.is_new ?? row.created);

  if (input.shopifyUserId) {
    await admin
      .from("shopify_app_installations")
      .update({ last_shopify_user_id: input.shopifyUserId })
      .eq("id", installationId)
      .eq("organization_id", organizationId);
  }

  logInfo("shopify_app.provision", {
    shopDomain,
    organizationId,
    created,
    origin: SHOPIFY_APP_ORG_ORIGIN,
  });

  return { organizationId, installationId, created, shopDomain };
}

export async function loadShopifyAppInstallation(shopDomain: string) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("shopify_app_installations")
    .select(
      "id, shop_domain, organization_id, app_client_id, status, encrypted_access_token, encrypted_refresh_token, token_expires_at, refresh_token_expires_at, granted_scopes, last_shopify_user_id, uninstalled_at, token_version"
    )
    .eq("shop_domain", normalizeShopifyShopDomain(shopDomain))
    .eq("app_client_id", env.shopifyPublicAppClientId)
    .maybeSingle();
  if (error) {
    throw new AppError(ERROR_CODES.AUTH_UNAVAILABLE, "Unable to load the Shopify installation.");
  }
  return (data ?? null) as ShopifyAppInstallationRow | null;
}
