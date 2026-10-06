import { NextRequest } from "next/server";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { apiRouteWithContext } from "@/lib/api/handler";
import { rateLimit } from "@/lib/security/rate-limit";
import { createAdminClient, hasAdminClient } from "@/lib/supabase/admin";
import { submitPublicCustomerOrderLink } from "@/modules/customer-order-links/public";
import {
  publicOrderLinkPathQuery,
  submitCustomerOrderLinkSchema,
} from "@/modules/customer-order-links/schema";

export const POST = apiRouteWithContext(async (request: NextRequest, _context) => {
  const ip = request.headers.get("x-forwarded-for") ?? "local";
  const parsed = publicOrderLinkPathQuery.parse({
    workspace: request.nextUrl.searchParams.get("workspace") ?? "",
    code: request.nextUrl.searchParams.get("code") ?? "",
  });
  const ipLimited = rateLimit(`public-order-submit:${ip}`, 20, 60_000);
  const pathLimited = rateLimit(`public-order-submit-path:${parsed.workspace}:${parsed.code}`, 5, 60_000);
  if (!ipLimited.ok || !pathLimited.ok) {
    throw new AppError(ERROR_CODES.RATE_LIMITED, "Too many requests. Try again shortly.");
  }
  if (!hasAdminClient()) {
    throw new AppError(ERROR_CODES.PROVIDER_ERROR, "This form is temporarily unavailable.");
  }
  const body = submitCustomerOrderLinkSchema.parse(await request.json().catch(() => ({})));
  return submitPublicCustomerOrderLink(
    createAdminClient(),
    { kind: "path", workspace: parsed.workspace, publicId: parsed.code },
    body
  );
});
