import type { NextRequest } from "next/server";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { rateLimit } from "@/lib/security/rate-limit";
import { sharedRateLimit } from "@/lib/security/shared-rate-limit";
import {
  SHOPIFY_APP_BFF_RATE_LIMIT,
  SHOPIFY_APP_SHOP_RATE_LIMIT,
  SHOPIFY_APP_WEBHOOK_RATE_LIMIT,
} from "@/lib/shopify-app/constants";
import { readBearerToken, verifyShopifyIdToken } from "@/lib/shopify-app/id-token";
import { strictShopDomain } from "@/lib/shopify-app/shop-domain";
import {
  assertShopifyEmbeddedEnabled,
  assertShopifyPublicAppConfigured,
  requireShopifyAppContext,
} from "@/lib/shopify-app/context";
import { buildShopifyBootstrap } from "@/lib/shopify-app/bootstrap";
import { isShopifyAppRouteAllowed } from "@/lib/shopify-app/route-allowlist";
import { handleShopifyPublicAppWebhook } from "@/lib/shopify-app/webhooks";

function rateLimited() {
  return new AppError(ERROR_CODES.RATE_LIMITED, "Too many requests. Try again shortly.");
}

function assertShopifyAppRateLimit(request: NextRequest, bucket: string, limit: number) {
  const limited = rateLimit(`shopify-app:${request.headers.get("x-forwarded-for") ?? "local"}:${bucket}`, limit);
  if (!limited.ok) throw rateLimited();
}

/** Verifies the session token first, then limits per shop so tenants sharing an IP don't starve each other. */
async function assertShopRateLimit(request: NextRequest) {
  const claims = await verifyShopifyIdToken(readBearerToken(request.headers.get("authorization")));
  const limited = await sharedRateLimit(`shopify-app:shop:${claims.shopDomain}`, SHOPIFY_APP_SHOP_RATE_LIMIT);
  if (!limited.ok) throw rateLimited();
}

/** Keeps shop/host so App Bridge can re-embed; drops anything that is not a valid shop domain. */
function embeddedAppRedirect(request: NextRequest) {
  const target = new URL("/shopify", request.url);
  const shop = strictShopDomain(request.nextUrl.searchParams.get("shop"));
  const host = request.nextUrl.searchParams.get("host");
  if (shop) target.searchParams.set("shop", shop);
  if (shop && host && /^[A-Za-z0-9_=-]+$/.test(host)) target.searchParams.set("host", host);
  return Response.redirect(target);
}

export async function handleShopifyAppApi(request: NextRequest, slugs: string[]) {
  const path = slugs.join("/");
  const method = request.method;

  if (path === "webhooks" && method === "POST") {
    assertShopifyPublicAppConfigured();
    // Shopify delivers from shared IPs; bucket by the claimed shop (HMAC is checked next).
    const shop = strictShopDomain(request.headers.get("x-shopify-shop-domain")) ?? "unknown";
    assertShopifyAppRateLimit(request, `webhooks:${shop}`, SHOPIFY_APP_WEBHOOK_RATE_LIMIT);
    return handleShopifyPublicAppWebhook(request);
  }

  if (path === "auth/callback" && method === "GET") {
    assertShopifyEmbeddedEnabled();
    return embeddedAppRedirect(request);
  }

  assertShopifyEmbeddedEnabled();
  assertShopifyAppRateLimit(request, "bff", SHOPIFY_APP_BFF_RATE_LIMIT);
  await assertShopRateLimit(request);

  if ((path === "bootstrap" || path === "") && (method === "GET" || method === "POST")) {
    const ctx = await requireShopifyAppContext(request);
    let requestedOrg: string | null = null;
    if (method === "POST") {
      const body = (await request.json().catch(() => ({}))) as { organizationId?: string };
      requestedOrg = body.organizationId ?? null;
    } else {
      requestedOrg = request.nextUrl.searchParams.get("organization_id");
    }
    return buildShopifyBootstrap(ctx, requestedOrg);
  }

  if (slugs[0] === "v1") {
    const v1Slugs = slugs.slice(1);
    const v1Path = v1Slugs.join("/");
    // Allowlist before auth work, so unlisted routes cost nothing and reveal nothing.
    if (!isShopifyAppRouteAllowed(method, v1Path)) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Not found.");
    }
    // Loaded lazily: the v1 handler graph is large and webhooks/bootstrap never need it.
    const [{ requireShopifyTenant }, { dispatchTenantRoutes }] = await Promise.all([
      import("@/lib/shopify-app/tenant"),
      import("@/lib/api/v1/dispatch"),
    ]);
    const { ctx, supabase } = await requireShopifyTenant(request);
    return dispatchTenantRoutes(request, supabase, ctx, {
      key: `${method} ${v1Path}`,
      path: v1Path,
      method,
      slugs: v1Slugs,
    });
  }

  throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Not found.");
}
