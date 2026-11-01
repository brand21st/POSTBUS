import { createHash } from "crypto";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { env } from "@/lib/env";
import { logError, logInfo } from "@/lib/logger";
import { SHOPIFY_WEBHOOK_MAX_BODY_BYTES } from "@/lib/shopify-app/constants";
import { verifyShopifyAppWebhookHmac } from "@/lib/shopify-app/hmac";
import { normalizeShopifyShopDomain } from "@/lib/shopify-app/shop-domain";
import { isStaleUninstall } from "@/lib/shopify-app/uninstall-timing";
import { createAdminClient } from "@/lib/supabase/admin";

const COMPLIANCE_TOPICS = new Set(["customers/data_request", "customers/redact", "shop/redact"]);
export const APP_ORDER_TOPICS = new Set(["orders/create", "orders/updated", "orders/cancelled"]);

const PUBLIC_APP_TOPICS = new Set([
  "app/uninstalled",
  "app/scopes_update",
  ...COMPLIANCE_TOPICS,
  ...APP_ORDER_TOPICS,
]);

const deliveryLocks = new Map<string, Promise<unknown>>();

export async function handleShopifyPublicAppWebhook(request: Request) {
  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, "utf8") > SHOPIFY_WEBHOOK_MAX_BODY_BYTES) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Webhook payload is too large.");
  }

  const hmac = request.headers.get("x-shopify-hmac-sha256");
  if (!verifyShopifyAppWebhookHmac(rawBody, hmac, env.shopifyPublicAppClientSecret)) {
    throw new AppError(ERROR_CODES.AUTH_REQUIRED, "Invalid webhook signature.");
  }

  const topic = String(request.headers.get("x-shopify-topic") ?? "").toLowerCase();
  const shop = normalizeShopifyShopDomain(String(request.headers.get("x-shopify-shop-domain") ?? ""));
  const webhookId = String(request.headers.get("x-shopify-webhook-id") ?? hashBody(rawBody));
  const triggeredAt =
    request.headers.get("x-shopify-triggered-at") || request.headers.get("x-shopify-event-time");

  if (!PUBLIC_APP_TOPICS.has(topic)) {
    return { ignored: true, topic };
  }

  const pending = deliveryLocks.get(webhookId);
  if (pending) return pending;

  const run = processDelivery({ topic, shop, rawBody, webhookId, triggeredAt }).finally(() => {
    deliveryLocks.delete(webhookId);
  });
  deliveryLocks.set(webhookId, run);
  return run;
}

async function processDelivery(input: {
  topic: string;
  shop: string;
  rawBody: string;
  webhookId: string;
  triggeredAt: string | null;
}) {
  const admin = createAdminClient();
  const existing = await admin
    .from("shopify_app_webhook_deliveries")
    .select("id, status")
    .eq("id", input.webhookId)
    .maybeSingle();
  if (existing.data?.status === "SUCCEEDED") {
    return { duplicate: true, topic: input.topic };
  }

  if (input.topic === "app/uninstalled") {
    const uninstall = await uninstallPublicApp(input.shop, input.triggeredAt);
    if (uninstall.ignored) {
      return { ignored: true, topic: input.topic, reason: uninstall.reason };
    }
  } else if (APP_ORDER_TOPICS.has(input.topic)) {
    const imported = await importAppOrderWebhook(input);
    if (imported.ignored) {
      return { ignored: true, topic: input.topic, reason: imported.reason };
    }
  } else if (input.topic === "app/scopes_update") {
    await updateGrantedScopes(input.shop, input.rawBody);
  } else if (COMPLIANCE_TOPICS.has(input.topic)) {
    await persistComplianceRequest(input);
  }

  await admin.from("shopify_app_webhook_deliveries").upsert({
    id: input.webhookId,
    topic: input.topic,
    shop_domain: input.shop || null,
    status: "SUCCEEDED",
    processed_at: new Date().toISOString(),
  });

  logInfo("shopify_app.webhook", { topic: input.topic, shop: input.shop, webhookId: input.webhookId });
  return { ok: true, topic: input.topic };
}

async function uninstallPublicApp(shop: string, triggeredAt: string | null) {
  if (!shop) return { ignored: true, reason: "missing_shop" };
  const admin = createAdminClient();
  const { data: installation } = await admin
    .from("shopify_app_installations")
    .select("id, organization_id, installed_at, status")
    .eq("shop_domain", shop)
    .eq("app_client_id", env.shopifyPublicAppClientId)
    .maybeSingle();

  if (!installation) return { ignored: true, reason: "missing_install" };
  if (isStaleUninstall(triggeredAt, installation.installed_at)) {
    logInfo("shopify_app.webhook.stale_uninstall", { shop, triggeredAt, installedAt: installation.installed_at });
    return { ignored: true, reason: "stale" };
  }

  await admin
    .from("shopify_app_installations")
    .update({
      status: "DISCONNECTED",
      encrypted_access_token: null,
      encrypted_refresh_token: null,
      token_expires_at: null,
      refresh_token_expires_at: null,
      uninstalled_at: new Date().toISOString(),
    })
    .eq("id", installation.id)
    .eq("organization_id", installation.organization_id)
    .eq("app_client_id", env.shopifyPublicAppClientId);

  return { ignored: false as const, reason: null };
}

async function persistComplianceRequest(input: {
  topic: string;
  shop: string;
  rawBody: string;
  webhookId: string;
}) {
  const admin = createAdminClient();
  const payloadHash = createHash("sha256").update(input.rawBody).digest("hex");
  await admin.from("shopify_compliance_requests").upsert(
    {
      webhook_id: input.webhookId,
      topic: input.topic,
      shop_domain: input.shop || null,
      payload_hash: payloadHash,
      status: input.topic === "shop/redact" || input.topic === "customers/redact" ? "PENDING_REVIEW" : "RECEIVED",
      notes:
        input.topic === "shop/redact" || input.topic === "customers/redact"
          ? "Shared SaaS organization deletion is blocked pending legal retention rules. Public-app tokens are revoked on uninstall. GDPR processing is not complete."
          : null,
    },
    { onConflict: "webhook_id" }
  );
}

async function installationForShop(shop: string) {
  if (!shop) return null;
  const { data } = await createAdminClient()
    .from("shopify_app_installations")
    .select("id, organization_id, status")
    .eq("shop_domain", shop)
    .eq("app_client_id", env.shopifyPublicAppClientId)
    .maybeSingle();
  return (data ?? null) as { id: string; organization_id: string; status: string } | null;
}

/**
 * Imports the order inline through the same path as the dashboard (GraphQL re-read, then upsert).
 * Errors propagate so the delivery is not marked SUCCEEDED and Shopify retries it.
 */
async function importAppOrderWebhook(input: { topic: string; shop: string; rawBody: string; webhookId: string }) {
  const installation = await installationForShop(input.shop);
  if (!installation) return { ignored: true, reason: "missing_install" };
  if (installation.status === "DISCONNECTED") return { ignored: true, reason: "disconnected" };

  let remote: Record<string, unknown>;
  try {
    remote = JSON.parse(input.rawBody) as Record<string, unknown>;
  } catch {
    return { ignored: true, reason: "invalid_json" };
  }

  // Lazy: the order module is large and most deliveries to this route are other topics.
  const { importShopifyWebhookOrder } = await import("@/modules/shopify/orders");
  try {
    const result = await importShopifyWebhookOrder(createAdminClient(), {
      organizationId: installation.organization_id,
      shopDomain: input.shop,
      topic: input.topic,
      remote,
    });
    logInfo("shopify_app.webhook.order", {
      topic: input.topic,
      shop: input.shop,
      imported: result.imported,
      updated: result.updated,
      skipped: result.skipped,
    });
    return { ignored: false as const };
  } catch (error) {
    logError("shopify_app.webhook.order_failed", {
      topic: input.topic,
      shop: input.shop,
      webhookId: input.webhookId,
      message: error instanceof Error ? error.message : "unknown",
    });
    throw error;
  }
}

async function updateGrantedScopes(shop: string, rawBody: string) {
  const installation = await installationForShop(shop);
  if (!installation) return;
  let current: unknown;
  try {
    current = (JSON.parse(rawBody) as { current?: unknown }).current;
  } catch {
    return;
  }
  if (!Array.isArray(current)) return;
  await createAdminClient()
    .from("shopify_app_installations")
    .update({ granted_scopes: current.map(String).join(",") })
    .eq("id", installation.id)
    .eq("organization_id", installation.organization_id);
}

function hashBody(raw: string) {
  return createHash("sha256").update(raw).digest("hex");
}
