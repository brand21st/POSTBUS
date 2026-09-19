import { NextRequest } from "next/server";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { apiRoute } from "@/lib/api/handler";
import { rateLimit } from "@/lib/security/rate-limit";
import { createServerSupabase } from "@/lib/supabase/server";
import { publicTrackLookup, resolveRequestSubdomain } from "@/modules/tracking-pages/public";
import { publicTrackSchema } from "@/modules/tracking-pages/schema";

export const POST = apiRoute(async (request: NextRequest) => {
  const body = await request.json().catch(() => ({}));
  const parsed = publicTrackSchema.parse(body);
  const subdomain = resolveRequestSubdomain(
    request.headers.get("host"),
    request.headers.get("x-tracking-subdomain"),
    request.nextUrl.searchParams.get("subdomain"),
    parsed.subdomain
  );
  if (!subdomain) {
    throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "This tracking page is not available.");
  }

  const ip = request.headers.get("x-forwarded-for") ?? "local";
  const limited = rateLimit(`public-track:${ip}:${subdomain}`, 20, 60_000);
  if (!limited.ok) {
    throw new AppError(ERROR_CODES.RATE_LIMITED, "Too many lookups. Try again shortly.");
  }

  const supabase = await createServerSupabase();
  return publicTrackLookup(supabase, subdomain, parsed.query);
});
