import { NextRequest } from "next/server";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { apiRouteWithContext } from "@/lib/api/handler";
import { ok } from "@/lib/api/response";
import { rateLimit } from "@/lib/security/rate-limit";
import { loadPublicStorefront, publicStoreClient } from "@/modules/storefront/public";
import { publicStoreQuery, storeLinkRef } from "@/modules/storefront/schema";

export const GET = apiRouteWithContext(async (request: NextRequest) => {
  const ip = request.headers.get("x-forwarded-for") ?? "local";
  const parsed = publicStoreQuery.parse({
    workspace: request.nextUrl.searchParams.get("workspace") || undefined,
    token: request.nextUrl.searchParams.get("token") || undefined,
    code: request.nextUrl.searchParams.get("code") || undefined,
  });
  const limited = rateLimit(`public-store:${ip}:${parsed.workspace ?? parsed.token ?? "x"}`, 60, 60_000);
  if (!limited.ok) throw new AppError(ERROR_CODES.RATE_LIMITED, "Too many requests. Try again shortly.");
  const response = ok(await loadPublicStorefront(publicStoreClient(), storeLinkRef(parsed)));
  response.headers.set("Cache-Control", "public, max-age=15, s-maxage=30, stale-while-revalidate=60");
  return response;
});
