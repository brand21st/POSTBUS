import { NextRequest } from "next/server";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { apiRouteWithContext } from "@/lib/api/handler";
import { ok } from "@/lib/api/response";
import { rateLimit } from "@/lib/security/rate-limit";
import { assertStorePublished, organizationFromLink, publicStoreClient } from "@/modules/storefront/public";
import { quotePublicStorePayment } from "@/modules/storefront/quote";
import { publicStoreQuoteSchema, storeLinkRef } from "@/modules/storefront/schema";

export const POST = apiRouteWithContext(async (request: NextRequest) => {
  const ip = request.headers.get("x-forwarded-for") ?? "local";
  const body = publicStoreQuoteSchema.parse(await request.json());
  const storeKey = body.workspace ?? body.token ?? "unknown";
  const limited = rateLimit(`public-store-quote:${ip}:${storeKey}`, 40, 60_000);
  if (!limited.ok) throw new AppError(ERROR_CODES.RATE_LIMITED, "Too many requests. Try again shortly.");
  const supabase = publicStoreClient();
  const organizationId = await organizationFromLink(supabase, storeLinkRef(body));
  await assertStorePublished(supabase, organizationId);
  return ok(await quotePublicStorePayment(supabase, organizationId, body.items, body.paymentPreference));
});
