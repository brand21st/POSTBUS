import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireMerchantScope, type MerchantApiKeyContext } from "@/modules/merchant-api/auth";
import {
  createWebhookSubscription,
  disableWebhookSubscription,
  getWebhookSubscription,
  listWebhookDeliveries,
  listWebhookSubscriptions,
  retryWebhookDelivery,
  rotateWebhookSecret,
  sendWebhookTest,
  updateWebhookSubscription,
} from "@/modules/webhooks/subscriptions";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function dispatchMerchantWebhooks(
  request: NextRequest,
  supabase: SupabaseClient,
  ctx: MerchantApiKeyContext,
  method: string,
  slugs: string[]
): Promise<{ status: number; data: unknown } | null> {
  const [root, id, action, deliveryId, tail] = slugs;
  if (root !== "webhook-subscriptions") return null;
  const org = ctx.organizationId;

  if (method === "GET" && !id) {
    requireMerchantScope(ctx, "webhooks:read");
    return { status: 200, data: await listWebhookSubscriptions(supabase, org) };
  }
  if (method === "POST" && !id) {
    requireMerchantScope(ctx, "webhooks:manage");
    const body = (await request.json().catch(() => ({}))) as {
      url?: string;
      events?: string[];
      description?: string | null;
    };
    if (!body.url) {
      const { MerchantApiError, MERCHANT_ERROR_CODES } = await import("@/modules/merchant-api/errors");
      throw new MerchantApiError(MERCHANT_ERROR_CODES.VALIDATION_ERROR, "url is required.");
    }
    return {
      status: 201,
      data: await createWebhookSubscription(supabase, org, {
        url: body.url,
        events: body.events,
        description: body.description,
      }),
    };
  }
  if (!id || !UUID.test(id)) return { status: 404, data: null };

  if (method === "GET" && !action) {
    requireMerchantScope(ctx, "webhooks:read");
    return { status: 200, data: await getWebhookSubscription(supabase, org, id) };
  }
  if (method === "PATCH" && !action) {
    requireMerchantScope(ctx, "webhooks:manage");
    const body = (await request.json().catch(() => ({}))) as {
      url?: string;
      events?: string[];
      description?: string | null;
      enabled?: boolean;
    };
    return { status: 200, data: await updateWebhookSubscription(supabase, org, id, body) };
  }
  if (method === "DELETE" && !action) {
    requireMerchantScope(ctx, "webhooks:manage");
    return { status: 200, data: await disableWebhookSubscription(supabase, org, id) };
  }
  if (method === "GET" && action === "deliveries" && !deliveryId) {
    requireMerchantScope(ctx, "webhooks:read");
    const cursor = request.nextUrl.searchParams.get("cursor");
    const limit = Number(request.nextUrl.searchParams.get("limit") ?? "20");
    return { status: 200, data: await listWebhookDeliveries(supabase, org, id, cursor, limit) };
  }
  if (method === "POST" && action === "test" && !deliveryId) {
    requireMerchantScope(ctx, "webhooks:manage");
    return { status: 202, data: await sendWebhookTest(supabase, org, id) };
  }
  if (method === "POST" && action === "rotate-secret" && !deliveryId) {
    requireMerchantScope(ctx, "webhooks:manage");
    return { status: 200, data: await rotateWebhookSecret(supabase, org, id) };
  }
  if (method === "POST" && action === "deliveries" && deliveryId && UUID.test(deliveryId) && tail === "retry") {
    requireMerchantScope(ctx, "webhooks:manage");
    return { status: 202, data: await retryWebhookDelivery(supabase, org, id, deliveryId) };
  }
  return { status: 404, data: null };
}
