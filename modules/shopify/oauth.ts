import { env } from "@/lib/env";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { decryptSecret, safeEqual } from "@/lib/security/crypto";
import { createHmac, randomBytes } from "crypto";

export type ShopifyAppCredentials = {
  clientId: string;
  clientSecret: string;
  scopes: string;
};

export type ShopifyCredentialRow = {
  client_id?: string | null;
  encrypted_client_secret?: string | null;
  encrypted_previous_client_secret?: string | null;
  encrypted_api_key?: string | null;
  encrypted_api_secret?: string | null;
  requested_scopes?: string | null;
};

function decryptColumn(value?: string | null) {
  if (!value) return "";
  try {
    return decryptSecret(value);
  } catch {
    return "";
  }
}

export function storedClientId(row?: ShopifyCredentialRow | null) {
  return row?.client_id?.trim() || decryptColumn(row?.encrypted_api_key);
}

export function storedClientSecret(row?: ShopifyCredentialRow | null) {
  return decryptColumn(row?.encrypted_client_secret) || decryptColumn(row?.encrypted_api_secret);
}

export function hasStoredClientSecret(row?: ShopifyCredentialRow | null) {
  return Boolean(row?.encrypted_client_secret || row?.encrypted_api_secret);
}

export function resolveShopifyAppCredentials(row?: ShopifyCredentialRow | null): ShopifyAppCredentials | null {
  const clientId = storedClientId(row) || env.shopifyApiKey;
  const clientSecret = storedClientSecret(row) || env.shopifyApiSecret;
  const scopes = row?.requested_scopes?.trim() || env.shopifyScopes;
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret, scopes };
}

export function resolveShopifyWebhookSecrets(row?: ShopifyCredentialRow | null) {
  const secrets = [
    storedClientSecret(row),
    decryptColumn(row?.encrypted_previous_client_secret),
    env.shopifyApiSecret,
  ].filter((value, index, list) => Boolean(value) && list.indexOf(value) === index);
  return secrets;
}

export function shopifyAppConfiguredFor(row?: ShopifyCredentialRow | null) {
  return Boolean(resolveShopifyAppCredentials(row));
}

export function normalizeShopDomain(shop: string) {
  return shop.replace(/^https?:\/\//, "").replace(/\/$/, "").trim();
}

export function shopifyInstallUrl(shop: string, state: string, creds: Pick<ShopifyAppCredentials, "clientId" | "scopes">) {
  if (!creds.clientId) {
    throw new AppError(
      ERROR_CODES.INTEGRATION_NOT_CONNECTED,
      "Shopify app credentials are not configured."
    );
  }
  const normalized = normalizeShopDomain(shop);
  const params = new URLSearchParams({
    client_id: creds.clientId,
    scope: creds.scopes,
    redirect_uri: `${env.appUrl}/api/v1/integrations/shopify/callback`,
    state,
  });
  return `https://${normalized}/admin/oauth/authorize?${params}`;
}

export function verifyShopifyHmac(query: URLSearchParams, clientSecret: string) {
  if (!clientSecret) return false;
  const hmac = query.get("hmac") || "";
  const map = new URLSearchParams(query);
  map.delete("hmac");
  map.delete("signature");
  const message = [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
  const digest = createHmac("sha256", clientSecret).update(message).digest("hex");
  return digest === hmac;
}

export function verifyWebhookHmac(rawBody: string, header: string | null, clientSecret?: string | string[]) {
  const extra = Array.isArray(clientSecret) ? clientSecret : clientSecret ? [clientSecret] : [];
  const secrets = [...extra, process.env.SHOPIFY_API_SECRET?.trim() || "", env.shopifyApiSecret]
    .map((value) => value.trim())
    .filter((value, index, list) => Boolean(value) && list.indexOf(value) === index);
  if (!secrets.length || !header) return false;
  return secrets.some((secret) => {
    const digest = createHmac("sha256", secret).update(rawBody, "utf8").digest("base64");
    return digest === header;
  });
}

export async function exchangeShopifyToken(
  shop: string,
  code: string,
  creds: Pick<ShopifyAppCredentials, "clientId" | "clientSecret">
) {
  const response = await fetch(`https://${normalizeShopDomain(shop)}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      code,
    }),
  });
  if (!response.ok) {
    throw new AppError(ERROR_CODES.PROVIDER_ERROR, "Shopify token exchange failed.");
  }
  return response.json() as Promise<{ access_token: string; scope: string }>;
}

export function newOAuthState() {
  return randomBytes(16).toString("hex");
}

export const SHOPIFY_OAUTH_STATE_COOKIE = "pb_shopify_oauth_state";

export function createShopifyOAuthState(organizationId: string) {
  return `${organizationId}.${newOAuthState()}`;
}

export function parseShopifyOAuthState(state: string | null | undefined) {
  if (!state) return null;
  const separator = state.indexOf(".");
  if (separator <= 0 || separator === state.length - 1) return null;
  return {
    organizationId: state.slice(0, separator),
    nonce: state.slice(separator + 1),
  };
}

export function oauthStateMatches(expected: string | undefined, received: string | null) {
  if (!expected || !received) return false;
  return safeEqual(expected, received);
}

export function shopifyOAuthCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: env.appUrl.startsWith("https://"),
    path: "/",
    maxAge: 10 * 60,
  };
}

export function shopifyWebhookUrl() {
  return `${env.appUrl.replace(/\/$/, "")}/api/v1/webhooks/shopify`;
}
