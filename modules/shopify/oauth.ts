import { env } from "@/lib/env";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { decryptSecret } from "@/lib/security/crypto";
import { createHmac, randomBytes } from "crypto";

export type ShopifyAppCredentials = {
  apiKey: string;
  apiSecret: string;
  scopes: string;
};

export type ShopifyCredentialRow = {
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

export function resolveShopifyAppCredentials(row?: ShopifyCredentialRow | null): ShopifyAppCredentials | null {
  const apiKey = decryptColumn(row?.encrypted_api_key) || env.shopifyApiKey;
  const apiSecret = decryptColumn(row?.encrypted_api_secret) || env.shopifyApiSecret;
  const scopes = row?.requested_scopes?.trim() || env.shopifyScopes;
  if (!apiKey || !apiSecret) return null;
  return { apiKey, apiSecret, scopes };
}

export function resolveShopifyWebhookSecret(row?: Pick<ShopifyCredentialRow, "encrypted_api_secret"> | null) {
  return decryptColumn(row?.encrypted_api_secret) || env.shopifyApiSecret;
}

export function shopifyAppConfiguredFor(row?: ShopifyCredentialRow | null) {
  return Boolean(resolveShopifyAppCredentials(row));
}

export function normalizeShopDomain(shop: string) {
  return shop.replace(/^https?:\/\//, "").replace(/\/$/, "").trim();
}

export function shopifyInstallUrl(shop: string, state: string, creds: Pick<ShopifyAppCredentials, "apiKey" | "scopes">) {
  if (!creds.apiKey) {
    throw new AppError(
      ERROR_CODES.INTEGRATION_NOT_CONNECTED,
      "Shopify app credentials are not configured."
    );
  }
  const normalized = normalizeShopDomain(shop);
  const params = new URLSearchParams({
    client_id: creds.apiKey,
    scope: creds.scopes,
    redirect_uri: `${env.appUrl}/api/v1/integrations/shopify/callback`,
    state,
  });
  return `https://${normalized}/admin/oauth/authorize?${params}`;
}

export function verifyShopifyHmac(query: URLSearchParams, apiSecret: string) {
  if (!apiSecret) return false;
  const hmac = query.get("hmac") || "";
  const map = new URLSearchParams(query);
  map.delete("hmac");
  map.delete("signature");
  const message = [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
  const digest = createHmac("sha256", apiSecret).update(message).digest("hex");
  return digest === hmac;
}

export function verifyWebhookHmac(rawBody: string, header: string | null, apiSecret?: string) {
  const secret = apiSecret?.trim() || process.env.SHOPIFY_API_SECRET?.trim() || env.shopifyApiSecret;
  if (!secret || !header) return false;
  const digest = createHmac("sha256", secret).update(rawBody, "utf8").digest("base64");
  return digest === header;
}

export async function exchangeShopifyToken(
  shop: string,
  code: string,
  creds: Pick<ShopifyAppCredentials, "apiKey" | "apiSecret">
) {
  const response = await fetch(`https://${normalizeShopDomain(shop)}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: creds.apiKey,
      client_secret: creds.apiSecret,
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

export function shopifyWebhookUrl() {
  return `${env.appUrl.replace(/\/$/, "")}/api/v1/webhooks/shopify`;
}
