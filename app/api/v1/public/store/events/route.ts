import { NextRequest } from "next/server";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { apiRouteWithContext } from "@/lib/api/handler";
import { ok } from "@/lib/api/response";
import { rateLimit } from "@/lib/security/rate-limit";
import {
  assertStorePublished,
  organizationFromLink,
  publicStoreClient,
} from "@/modules/storefront/public";
import { publicStoreEventSchema, storeLinkRef } from "@/modules/storefront/schema";

export const POST = apiRouteWithContext(async (request: NextRequest) => {
  const ip = request.headers.get("x-forwarded-for") ?? "local";
  const body = publicStoreEventSchema.parse(await request.json());
  const limited = rateLimit(`public-store-events:${ip}:${body.workspace ?? body.token ?? "x"}`, 120, 60_000);
  if (!limited.ok) throw new AppError(ERROR_CODES.RATE_LIMITED, "Too many events.");
  const supabase = publicStoreClient();
  const organizationId = await organizationFromLink(supabase, storeLinkRef(body));
  await assertStorePublished(supabase, organizationId);
  if (body.productId) {
    const { count } = await supabase
      .from("products")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("id", body.productId)
      .eq("store_visible", true);
    if ((count ?? 0) !== 1) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Product not found.");
    }
  }
  const { error } = await supabase.from("storefront_events").insert({
    organization_id: organizationId,
    event_type: body.eventType,
    product_id: body.productId ?? null,
    quantity: body.quantity ?? null,
    value: body.value ?? null,
    session_id: body.sessionId ?? null,
  });
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Could not record storefront activity.");
  return ok({ recorded: true });
});
