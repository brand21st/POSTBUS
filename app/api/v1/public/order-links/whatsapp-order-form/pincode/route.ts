import { NextRequest } from "next/server";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { apiRouteWithContext } from "@/lib/api/handler";
import { rateLimit } from "@/lib/security/rate-limit";
import { createAdminClient, hasAdminClient } from "@/lib/supabase/admin";
import { lookupPublicOrderLinkPincode } from "@/modules/customer-order-links/public";
import { publicOrderLinkPathQuery } from "@/modules/customer-order-links/schema";

export const GET = apiRouteWithContext(async (request: NextRequest, _context) => {
  const ip = request.headers.get("x-forwarded-for") ?? "local";
  const parsed = publicOrderLinkPathQuery.parse({
    workspace: request.nextUrl.searchParams.get("workspace") ?? "",
    code: request.nextUrl.searchParams.get("code") ?? "",
  });
  const limited = rateLimit(`public-order-pincode:${ip}:${parsed.workspace}:${parsed.code}`, 30, 60_000);
  if (!limited.ok) {
    throw new AppError(ERROR_CODES.RATE_LIMITED, "Too many requests. Try again shortly.");
  }
  if (!hasAdminClient()) {
    throw new AppError(ERROR_CODES.PROVIDER_ERROR, "This form is temporarily unavailable.");
  }
  const pincode = request.nextUrl.searchParams.get("pincode") ?? "";
  return lookupPublicOrderLinkPincode(
    createAdminClient(),
    { kind: "path", workspace: parsed.workspace, publicId: parsed.code },
    pincode
  );
});
