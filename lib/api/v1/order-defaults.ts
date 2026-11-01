import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TenantContext } from "@/lib/api/context";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import {
  getOrderPaymentDefault,
  saveOrderPaymentDefault,
  saveOrderPaymentDefaultSchema,
} from "@/modules/orders/payment-default";

export async function handleOrderDefaultRoutes(
  request: NextRequest,
  supabase: SupabaseClient,
  ctx: TenantContext,
  method: string,
  slugs: string[]
) {
  if (slugs[0] !== "order-defaults") return null;
  if (slugs.length !== 1) {
    throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Not found.");
  }

  if (method === "GET") {
    return getOrderPaymentDefault(supabase, ctx.userId, ctx.organizationId);
  }

  if (method === "PUT") {
    // Accept a payment status, an extra COD amount, or both.
    const body = saveOrderPaymentDefaultSchema.parse(await request.json().catch(() => ({})));
    return saveOrderPaymentDefault(supabase, ctx.userId, ctx.organizationId, body);
  }

  throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Not found.");
}
