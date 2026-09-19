import { NextRequest } from "next/server";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { apiRoute } from "@/lib/api/handler";
import { rateLimit } from "@/lib/security/rate-limit";
import { createServerSupabase } from "@/lib/supabase/server";
import { resolveRequestSubdomain } from "@/modules/tracking-pages/public";
import { getPublishedTrackingPage } from "@/modules/tracking-pages/service";

export const GET = apiRoute(async (request: NextRequest) => {
  const ip = request.headers.get("x-forwarded-for") ?? "local";
  const limited = rateLimit(`public-page:${ip}`, 60, 60_000);
  if (!limited.ok) {
    throw new AppError(ERROR_CODES.RATE_LIMITED, "Too many requests. Try again shortly.");
  }

  const subdomain = resolveRequestSubdomain(
    request.headers.get("host"),
    request.headers.get("x-tracking-subdomain"),
    request.nextUrl.searchParams.get("subdomain")
  );
  if (!subdomain) {
    throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "This tracking page is not available.");
  }

  const supabase = await createServerSupabase();
  const page = await getPublishedTrackingPage(supabase, subdomain);
  if (!page) {
    throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "This tracking page is not available.");
  }
  return page;
});
