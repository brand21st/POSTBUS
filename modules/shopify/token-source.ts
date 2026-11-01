import { env } from "@/lib/env";
import { logError } from "@/lib/logger";
import { ensureOfflineToken } from "@/lib/shopify-app/offline-token";
import { loadShopifyAppInstallation } from "@/lib/shopify-app/provision";
import { createAdminClient, hasAdminClient } from "@/lib/supabase/admin";

/**
 * Where a workspace's Shopify Admin token comes from. Public App Store installs keep expiring offline
 * tokens in shopify_app_installations; older bring-your-own-app workspaces use shopify_connections.
 */
export type ShopifyConnectionSource = "app_installation" | "legacy_connection";

/**
 * Shops served by the public App Store app must use the GraphQL Admin API only. Every place that
 * resolves an app installation records the shop here, and the shared REST helper refuses those shops,
 * so no legacy REST path (images, payments, fulfillments) can silently run for an App Store install.
 */
const graphqlOnlyShops = new Set<string>();

export function markGraphqlOnlyShop(shop: string) {
  graphqlOnlyShops.add(shop.trim().toLowerCase());
}

export function isGraphqlOnlyShop(shopOrUrl: string) {
  const raw = shopOrUrl.trim().toLowerCase();
  let host = raw;
  try {
    host = new URL(raw.includes("://") ? raw : `https://${raw}`).hostname;
  } catch {
    // keep raw
  }
  return graphqlOnlyShops.has(host);
}

export type AppInstallationConnection = {
  source: "app_installation";
  organization_id: string;
  shop_domain: string;
  encrypted_access_token: string;
  status: "CONNECTED";
};

/**
 * Returns the public-app installation for this workspace as a connection row, refreshing the offline
 * token first when it is close to expiry. Null when the workspace has no usable app installation.
 */
export async function loadAppInstallationConnection(organizationId: string): Promise<AppInstallationConnection | null> {
  const clientId = env.shopifyPublicAppClientId;
  if (!clientId || !hasAdminClient()) return null;

  const { data, error } = await createAdminClient()
    .from("shopify_app_installations")
    .select("shop_domain, status")
    .eq("organization_id", organizationId)
    .eq("app_client_id", clientId)
    .maybeSingle();
  if (error || !data || data.status !== "CONNECTED") return null;

  const installation = await loadShopifyAppInstallation(String(data.shop_domain));
  if (!installation || installation.organization_id !== organizationId) return null;
  try {
    await ensureOfflineToken(installation, null, installation.shop_domain);
  } catch (refreshError) {
    logError("shopify.token_source.refresh_failed", {
      organizationId,
      message: refreshError instanceof Error ? refreshError.message : "unknown",
    });
  }
  markGraphqlOnlyShop(installation.shop_domain);
  if (installation.status !== "CONNECTED" || !installation.encrypted_access_token) return null;

  return {
    source: "app_installation",
    organization_id: organizationId,
    shop_domain: installation.shop_domain,
    encrypted_access_token: installation.encrypted_access_token,
    status: "CONNECTED",
  };
}

export function isAppInstallationConnection(row: { source?: string } | null | undefined) {
  return row?.source === "app_installation";
}
