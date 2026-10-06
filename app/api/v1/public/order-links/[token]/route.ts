import { NextRequest } from "next/server";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { apiRouteWithContext } from "@/lib/api/handler";
import { rateLimit } from "@/lib/security/rate-limit";
import { createAdminClient, hasAdminClient } from "@/lib/supabase/admin";
import { getPublicCustomerOrderLink } from "@/modules/customer-order-links/public";
import { customerOrderLinkTokenSchema } from "@/modules/customer-order-links/schema";

export const GET = apiRouteWithContext<{ token: string }>(async (request: NextRequest, context) => {
  const ip = request.headers.get("x-forwarded-for") ?? "local";
  const limited = rateLimit(`public-order-link:${ip}`, 20, 60_000);
  if (!limited.ok) {
    throw new AppError(ERROR_CODES.RATE_LIMITED, "Too many requests. Try again shortly.");
  }
  if (!hasAdminClient()) {
    throw new AppError(ERROR_CODES.PROVIDER_ERROR, "This form is temporarily unavailable.");
  }
  const { token } = await context.params;
  const parsed = customerOrderLinkTokenSchema.parse(token);
  return getPublicCustomerOrderLink(createAdminClient(), { kind: "token", token: parsed });
});
