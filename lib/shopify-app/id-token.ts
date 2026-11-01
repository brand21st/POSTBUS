import { jwtVerify } from "jose";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { env } from "@/lib/env";
import { SHOPIFY_RETRY_INVALID_SESSION_HEADER } from "@/lib/shopify-app/constants";
import { isShopifyShopDomain, shopDomainFromIssuerOrDest } from "@/lib/shopify-app/shop-domain";

export type ShopifyIdTokenClaims = {
  shopDomain: string;
  userId: string | null;
  dest: string;
  aud: string;
  iss: string;
};

function retryAuthError(message: string) {
  return new AppError(ERROR_CODES.AUTH_REQUIRED, message, undefined, {
    [SHOPIFY_RETRY_INVALID_SESSION_HEADER]: "1",
  });
}

export async function verifyShopifyIdToken(token: string): Promise<ShopifyIdTokenClaims> {
  const secret = env.shopifyPublicAppClientSecret;
  const audience = env.shopifyPublicAppClientId;
  if (!secret || !audience) {
    throw new AppError(ERROR_CODES.AUTH_UNAVAILABLE, "Shopify public app is not configured.");
  }
  if (!token?.trim()) {
    throw retryAuthError("Sign in through Shopify Admin to continue.");
  }

  let payload: Record<string, unknown>;
  try {
    const verified = await jwtVerify(token, new TextEncoder().encode(secret), {
      algorithms: ["HS256"],
      audience,
      clockTolerance: 5,
    });
    payload = verified.payload as Record<string, unknown>;
  } catch {
    throw retryAuthError("Your Shopify session expired. Reload the app.");
  }

  const iss = String(payload.iss ?? "");
  const dest = String(payload.dest ?? "");
  const issHost = shopDomainFromIssuerOrDest(iss);
  const destHost = shopDomainFromIssuerOrDest(dest);
  if (!issHost || !destHost || issHost !== destHost || !isShopifyShopDomain(destHost)) {
    throw retryAuthError("This Shopify session is not valid for this shop.");
  }

  const sub = payload.sub ? String(payload.sub) : null;
  return {
    shopDomain: destHost,
    userId: sub,
    dest,
    aud: String(payload.aud ?? ""),
    iss,
  };
}

export function readBearerToken(header: string | null) {
  if (!header) return "";
  const [scheme, token] = header.split(" ");
  if (!scheme || !token) return header.trim();
  if (scheme.toLowerCase() !== "bearer") return "";
  return token.trim();
}
