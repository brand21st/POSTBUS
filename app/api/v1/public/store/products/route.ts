import { NextRequest } from "next/server";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { apiRouteWithContext } from "@/lib/api/handler";
import { ok } from "@/lib/api/response";
import { rateLimit } from "@/lib/security/rate-limit";
import { listPublicProducts, organizationFromLink, publicStoreClient, assertStorePublished } from "@/modules/storefront/public";
import { publicCatalogQuery, storeLinkRef } from "@/modules/storefront/schema";

export const GET = apiRouteWithContext(async (request: NextRequest) => {
  const ip = request.headers.get("x-forwarded-for") ?? "local";
  const parsed = publicCatalogQuery.parse(Object.fromEntries(request.nextUrl.searchParams));
  const storeKey = parsed.workspace ?? parsed.token ?? "unknown";
  const limited = rateLimit(`public-store-products:${ip}:${storeKey}`, 80, 60_000);
  if (!limited.ok) throw new AppError(ERROR_CODES.RATE_LIMITED, "Too many requests. Try again shortly.");
  const supabase = publicStoreClient();
  const organizationId = await organizationFromLink(supabase, storeLinkRef(parsed));
  await assertStorePublished(supabase, organizationId);
  const response = ok(await listPublicProducts(supabase, organizationId, parsed));
  response.headers.set("Cache-Control", "public, max-age=15, s-maxage=30, stale-while-revalidate=60");
  return response;
});
