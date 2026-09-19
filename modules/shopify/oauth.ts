import { env, isShopifyAppConfigured } from "@/lib/env";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { createHmac, randomBytes } from "crypto";

export function shopifyInstallUrl(shop: string, state: string) {
  if (!isShopifyAppConfigured()) {
    throw new AppError(
      ERROR_CODES.INTEGRATION_NOT_CONNECTED,
      "Shopify app credentials are not configured."
    );
  }
  const normalized = shop.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const params = new URLSearchParams({
    client_id: env.shopifyApiKey,
    scope: env.shopifyScopes,
    redirect_uri: `${env.appUrl}/api/v1/integrations/shopify/callback`,
    state,
  });
  return `https://${normalized}/admin/oauth/authorize?${params}`;
}

export function verifyShopifyHmac(query: URLSearchParams) {
  const hmac = query.get("hmac") || "";
  const map = new URLSearchParams(query);
  map.delete("hmac");
  map.delete("signature");
  const message = [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
  const digest = createHmac("sha256", env.shopifyApiSecret).update(message).digest("hex");
  return digest === hmac;
}

export function verifyWebhookHmac(rawBody: string, header: string | null) {
  const secret = process.env.SHOPIFY_API_SECRET?.trim() || env.shopifyApiSecret;
  if (!secret || !header) return false;
  const digest = createHmac("sha256", secret).update(rawBody, "utf8").digest("base64");
  return digest === header;
}

export async function exchangeShopifyToken(shop: string, code: string) {
  const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: env.shopifyApiKey,
      client_secret: env.shopifyApiSecret,
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
