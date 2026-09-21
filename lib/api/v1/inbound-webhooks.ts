import type { NextRequest } from "next/server";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { logError } from "@/lib/logger";
import { hashSecret } from "@/lib/security/crypto";
import { isAutoShopifySyncEnabled } from "@/modules/automation/service";
import { createBackgroundJob } from "@/modules/jobs/service";
import { parseIndiaPostWebhookPath } from "@/modules/india-post/webhook-urls";
import { resolveShopifyWebhookSecrets, verifyWebhookHmac } from "@/modules/shopify/oauth";
import {
  importShopifyWebhookOrder,
  type ShopifyRemoteOrder,
} from "@/modules/shopify/orders";

export function isInboundWebhookPath(path: string) {
  return Boolean(parseIndiaPostWebhookPath(path) || path === "webhooks/shopify");
}

export async function handleInboundWebhook(request: NextRequest, path: string) {
  const method = request.method;
  const indiaPostWebhook = parseIndiaPostWebhookPath(path);

  if (indiaPostWebhook && method === "POST") {
    const raw = await request.text();
    const { createWebhookInboxClient } = await import("@/lib/supabase/admin");
    const { acceptIndiaPostWebhook } = await import("@/modules/india-post/webhook");
    return acceptIndiaPostWebhook(createWebhookInboxClient(), {
      connectionId: indiaPostWebhook.connectionId,
      channel: indiaPostWebhook.channel,
      rawBody: raw,
      contentType: request.headers.get("content-type"),
      headers: request.headers,
    });
  }

  if (path === "webhooks/shopify" && method === "POST") {
    const raw = await request.text();
    const topic = request.headers.get("x-shopify-topic") || "";
    const shop = request.headers.get("x-shopify-shop-domain") || "";
    const hmacHeader = request.headers.get("x-shopify-hmac-sha256");
    const eventId = request.headers.get("x-shopify-webhook-id") || hashSecret(raw);
    const { createAdminClient, hasAdminClient } = await import("@/lib/supabase/admin");
    const admin = hasAdminClient() ? createAdminClient() : null;
    const { data: connection } = admin
      ? await admin
          .from("shopify_connections")
          .select(
            "organization_id, client_id, encrypted_client_secret, encrypted_previous_client_secret, encrypted_api_key, encrypted_api_secret"
          )
          .eq("shop_domain", shop)
          .maybeSingle()
      : { data: null };
    const webhookSecrets = resolveShopifyWebhookSecrets(connection);
    if (!verifyWebhookHmac(raw, hmacHeader, webhookSecrets)) {
      throw new AppError(ERROR_CODES.FORBIDDEN, "Invalid Shopify webhook signature.");
    }
    if (!admin) {
      return { accepted: true, queued: false };
    }
    const { data: existing } = await admin
      .from("idempotency_keys")
      .select("id")
      .eq("key", `shopify:${eventId}`)
      .maybeSingle();
    if (existing) return { duplicate: true };
    if (connection) {
      await admin.from("idempotency_keys").insert({
        organization_id: connection.organization_id,
        key: `shopify:${eventId}`,
        request_hash: hashSecret(raw),
      });
      if (topic === "app/uninstalled") {
        await admin
          .from("shopify_connections")
          .update({ status: "DISCONNECTED", encrypted_access_token: null })
          .eq("organization_id", connection.organization_id);
      } else if (topic.startsWith("orders/")) {
        try {
          const remote = JSON.parse(raw) as ShopifyRemoteOrder;
          await importShopifyWebhookOrder(admin, {
            organizationId: connection.organization_id,
            shopDomain: shop,
            topic,
            remote,
          });
        } catch (error) {
          logError("shopify.webhook_order_import_failed", {
            topic,
            shop,
            message: error instanceof Error ? error.message : "import failed",
          });
          throw error;
        }
      } else if (await isAutoShopifySyncEnabled(admin, connection.organization_id)) {
        await createBackgroundJob(admin, {
          organizationId: connection.organization_id,
          jobType: "shopify-sync",
          entityType: "shopify_connection",
          progress: { topic },
        });
      }
    }
    return { accepted: true };
  }

  return null;
}
