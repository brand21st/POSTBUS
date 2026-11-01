import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { isShopifyEmbeddedAppEnabled, isShopifyPublicAppConfigured } from "@/lib/env";
import { SHOPIFY_RETRY_INVALID_SESSION_HEADER } from "@/lib/shopify-app/constants";
import { readBearerToken, verifyShopifyIdToken } from "@/lib/shopify-app/id-token";
import { loadShopifyAppInstallation, provisionShopifyAppOrganization } from "@/lib/shopify-app/provision";
import { createShopifyTenantAdmin } from "@/lib/shopify-app/tenant-admin";
import { ensureOfflineToken } from "@/lib/shopify-app/offline-token";

export type ShopifyAppContext = {
  shopDomain: string;
  shopifyUserId: string | null;
  organizationId: string;
  installationId: string;
  installationStatus: string;
  created: boolean;
};

function disabledError() {
  return new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Not found.");
}

export function assertShopifyPublicAppConfigured() {
  if (!isShopifyPublicAppConfigured()) {
    throw new AppError(ERROR_CODES.AUTH_UNAVAILABLE, "Shopify public app is not configured.");
  }
}

export function assertShopifyEmbeddedEnabled() {
  if (!isShopifyEmbeddedAppEnabled()) throw disabledError();
  assertShopifyPublicAppConfigured();
}

export async function requireShopifyAppContext(request: Request): Promise<ShopifyAppContext> {
  assertShopifyEmbeddedEnabled();
  const token = readBearerToken(request.headers.get("authorization"));
  const claims = await verifyShopifyIdToken(token);
  const provisioned = await provisionShopifyAppOrganization({
    shopDomain: claims.shopDomain,
    shopifyUserId: claims.userId,
  });
  const installation = await loadShopifyAppInstallation(claims.shopDomain);
  if (!installation) {
    throw new AppError(ERROR_CODES.AUTH_UNAVAILABLE, "Shopify installation is missing.");
  }
  if (installation.status === "DISCONNECTED") {
    throw new AppError(
      ERROR_CODES.AUTH_REQUIRED,
      "Reinstall PostBus from the Shopify App listing.",
      undefined,
      { [SHOPIFY_RETRY_INVALID_SESSION_HEADER]: "1" }
    );
  }

  await ensureOfflineToken(installation, token, claims.shopDomain);

  return {
    shopDomain: claims.shopDomain,
    shopifyUserId: claims.userId,
    organizationId: provisioned.organizationId,
    installationId: provisioned.installationId,
    installationStatus: installation.status,
    created: provisioned.created,
  };
}

export function shopifyTenantFor(organizationId: string) {
  return createShopifyTenantAdmin(organizationId);
}
