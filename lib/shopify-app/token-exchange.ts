import { env } from "@/lib/env";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { encryptSecret } from "@/lib/security/crypto";
import { TOKEN_REFRESH_SKEW_MS } from "@/lib/shopify-app/constants";
import { normalizeShopifyShopDomain } from "@/lib/shopify-app/shop-domain";

export type ShopifyOfflineTokenSet = {
  accessToken: string;
  refreshToken?: string;
  expiresAt: string | null;
  refreshExpiresAt: string | null;
  scope: string;
};

const refreshLocks = new Map<string, Promise<ShopifyOfflineTokenSet>>();

function expiryFromSeconds(seconds?: number | null) {
  if (!seconds || seconds <= 0) return null;
  return new Date(Date.now() + seconds * 1000).toISOString();
}

export function tokenNeedsRefresh(expiresAt?: string | null) {
  if (!expiresAt) return false;
  return Date.parse(expiresAt) - TOKEN_REFRESH_SKEW_MS <= Date.now();
}

export async function exchangeIdTokenForOfflineAccess(shopDomain: string, idToken: string): Promise<ShopifyOfflineTokenSet> {
  const shop = normalizeShopifyShopDomain(shopDomain);
  const clientId = env.shopifyPublicAppClientId;
  const clientSecret = env.shopifyPublicAppClientSecret;
  if (!clientId || !clientSecret) {
    throw new AppError(ERROR_CODES.AUTH_UNAVAILABLE, "Shopify public app is not configured.");
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
    subject_token: idToken,
    subject_token_type: "urn:ietf:params:oauth:token-type:id_token",
    requested_token_type: "urn:shopify:params:oauth:token-type:offline-access-token",
    expiring: "1",
  });

  const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const json = (await response.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    refresh_token_expires_in?: number;
    scope?: string;
    error?: string;
    error_description?: string;
  };

  if (!response.ok || !json.access_token) {
    throw new AppError(
      ERROR_CODES.AUTH_UNAVAILABLE,
      "Could not connect to Shopify. Try reopening the app from Admin.",
      { status: response.status }
    );
  }

  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: expiryFromSeconds(json.expires_in),
    refreshExpiresAt: expiryFromSeconds(json.refresh_token_expires_in),
    scope: json.scope ?? env.shopifyPublicAppScopes,
  };
}

export async function refreshOfflineAccessToken(shopDomain: string, refreshToken: string): Promise<ShopifyOfflineTokenSet> {
  const shop = normalizeShopifyShopDomain(shopDomain);
  const clientId = env.shopifyPublicAppClientId;
  const clientSecret = env.shopifyPublicAppClientSecret;
  if (!clientId || !clientSecret) {
    throw new AppError(ERROR_CODES.AUTH_UNAVAILABLE, "Shopify public app is not configured.");
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });

  const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = (await response.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    refresh_token_expires_in?: number;
    scope?: string;
  };
  if (!response.ok || !json.access_token) {
    throw new AppError(ERROR_CODES.AUTH_UNAVAILABLE, "Shopify access expired. Reopen the app from Admin.", {
      status: response.status,
    });
  }
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? refreshToken,
    expiresAt: expiryFromSeconds(json.expires_in),
    refreshExpiresAt: expiryFromSeconds(json.refresh_token_expires_in),
    scope: json.scope ?? env.shopifyPublicAppScopes,
  };
}

export function encryptTokenSet(tokens: ShopifyOfflineTokenSet) {
  return {
    encrypted_access_token: encryptSecret(tokens.accessToken),
    encrypted_refresh_token: tokens.refreshToken ? encryptSecret(tokens.refreshToken) : null,
    token_expires_at: tokens.expiresAt,
    refresh_token_expires_at: tokens.refreshExpiresAt,
    granted_scopes: tokens.scope,
  };
}

/** Shopify answered 4xx: the grant itself was refused, so retrying the same grant is pointless. */
export function isRejectedShopifyGrant(error: unknown) {
  const status = error instanceof AppError ? (error.details as { status?: number } | undefined)?.status : undefined;
  return typeof status === "number" && status >= 400 && status < 500 && status !== 429;
}

export function withShopRefreshLock<T>(shopDomain: string, work: () => Promise<T>) {
  const key = normalizeShopifyShopDomain(shopDomain);
  const pending = refreshLocks.get(key);
  if (pending) return pending as Promise<T>;
  const run = work().finally(() => {
    refreshLocks.delete(key);
  });
  refreshLocks.set(key, run as Promise<ShopifyOfflineTokenSet>);
  return run;
}
