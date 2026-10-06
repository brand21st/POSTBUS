import { NextRequest } from "next/server";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { apiRouteWithContext } from "@/lib/api/handler";
import { rateLimit } from "@/lib/security/rate-limit";
import { createAdminClient, hasAdminClient } from "@/lib/supabase/admin";
import { submitPublicCustomerOrderLink } from "@/modules/customer-order-links/public";
import {
  customerOrderLinkTokenSchema,
  submitCustomerOrderLinkSchema,
} from "@/modules/customer-order-links/schema";

export const POST = apiRouteWithContext<{ token: string }>(async (request: NextRequest, context) => {
  const ip = request.headers.get("x-forwarded-for") ?? "local";
  const { token } = await context.params;
  const parsedToken = customerOrderLinkTokenSchema.parse(token);
  const ipLimited = rateLimit(`public-order-submit:${ip}`, 20, 60_000);
  const tokenLimited = rateLimit(`public-order-submit-token:${parsedToken}`, 5, 60_000);
  if (!ipLimited.ok || !tokenLimited.ok) {
    throw new AppError(ERROR_CODES.RATE_LIMITED, "Too many requests. Try again shortly.");
  }
  if (!hasAdminClient()) {
    throw new AppError(ERROR_CODES.PROVIDER_ERROR, "This form is temporarily unavailable.");
  }
  const body = submitCustomerOrderLinkSchema.parse(await request.json().catch(() => ({})));
  return submitPublicCustomerOrderLink(createAdminClient(), { kind: "token", token: parsedToken }, body);
});
