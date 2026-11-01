import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { decryptSecret, hashSecret } from "@/lib/security/crypto";
import { getWooOrder } from "@/modules/woocommerce/client";
import { credentialsFromConnection } from "@/modules/woocommerce/connect";
import {
  loadWooProductMeasures,
  markWooOrderDeleted,
  upsertWooCommerceOrder,
  wooSettings,
  type WooConnectionRow,
} from "@/modules/woocommerce/orders";
import { isPostbusEchoUpdate, shouldApplyWooOrder, verifyWooWebhookSignature } from "@/modules/woocommerce/signature";
import { enqueueWooWebhookJob } from "@/modules/woocommerce/sync-job";

export function parseWooWebhookPath(path: string) {
  if (path === "webhooks/woocommerce/auth") return { kind: "auth" as const };
  const match = path.match(/^webhooks\/woocommerce\/([0-9a-f-]{36})$/i);
  if (!match) return null;
  return { kind: "delivery" as const, connectionId: match[1] };
}

export async function acceptWooWebhook(
  supabase: SupabaseClient,
  input: { connectionId: string; rawBody: string; signature: string | null; topic: string; deliveryId: string | null }
) {
  const { data } = await supabase
    .from("woocommerce_connections")
    .select("*")
    .eq("id", input.connectionId)
    .maybeSingle();
  const connection = data as WooConnectionRow | null;
  if (!connection?.encrypted_webhook_secret || connection.status !== "CONNECTED") {
    throw new AppError(ERROR_CODES.AUTH_REQUIRED, "Invalid WooCommerce webhook signature.");
  }
  const secret = decryptSecret(connection.encrypted_webhook_secret);
  if (!verifyWooWebhookSignature(secret, input.rawBody, input.signature)) {
    throw new AppError(ERROR_CODES.AUTH_REQUIRED, "Invalid WooCommerce webhook signature.");
  }
  const deliveryId = input.deliveryId || hashSecret(input.rawBody);
  const { error } = await supabase.from("woocommerce_webhook_deliveries").insert({
    id: deliveryId,
    organization_id: connection.organization_id,
    connection_id: connection.id,
    topic: input.topic || "unknown",
    status: "QUEUED",
  });
  if (error?.code === "23505") return { accepted: true, duplicate: true };
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Could not record the webhook.");
  const idempotency = await supabase.from("idempotency_keys").insert({
    organization_id: connection.organization_id,
    key: `woocommerce:${deliveryId}`,
    request_hash: hashSecret(input.rawBody),
  });
  if (idempotency.error?.code === "23505") return { accepted: true, duplicate: true };

  await supabase
    .from("woocommerce_connections")
    .update({ last_webhook_at: new Date().toISOString() })
    .eq("id", connection.id);

  if (input.topic.includes("ping")) {
    await supabase.from("woocommerce_webhook_deliveries").update({ status: "IGNORED", processed_at: new Date().toISOString() }).eq("id", deliveryId);
    return { accepted: true, duplicate: false, ignored: true };
  }

  let orderId = "";
  try {
    const payload = JSON.parse(input.rawBody) as { id?: number | string };
    orderId = String(payload.id ?? "");
  } catch {
    orderId = "";
  }
  if (!orderId) {
    await supabase.from("woocommerce_webhook_deliveries").update({ status: "FAILED", last_error: "Missing order id" }).eq("id", deliveryId);
    return { accepted: true, duplicate: false };
  }
  await enqueueWooWebhookJob(supabase, {
    organizationId: connection.organization_id,
    connectionId: connection.id,
    deliveryId,
    topic: input.topic,
    orderId,
  });
  return { accepted: true, duplicate: false, queued: true };
}

export async function processWooWebhookJob(
  supabase: SupabaseClient,
  input: { organizationId: string; connectionId: string; topic: string; orderId: string; deliveryId?: string }
) {
  const connection = await loadConnected(supabase, input.connectionId, input.organizationId);
  if (!connection || connection.sync_enabled === false) {
    await finishDelivery(supabase, input.deliveryId, "IGNORED");
    return { skipped: true };
  }
  const creds = credentialsFromConnection(connection);
  if (!creds) return { skipped: true };
  if (input.topic === "order.deleted") {
    const result = await markWooOrderDeleted(supabase, input.organizationId, input.orderId);
    await finishDelivery(supabase, input.deliveryId, "PROCESSED");
    return result;
  }
  const remote = await getWooOrder(creds, input.orderId);
  const { data: existing } = await supabase
    .from("external_order_references")
    .select("order_id")
    .eq("organization_id", input.organizationId)
    .eq("source", "WOOCOMMERCE")
    .eq("source_order_id", String(remote.id ?? input.orderId))
    .maybeSingle();
  let previous: { status?: string; total?: string } | null = null;
  if (existing?.order_id) {
    const { data: order } = await supabase
      .from("orders")
      .select("metadata")
      .eq("id", existing.order_id)
      .maybeSingle();
    const snap = (order?.metadata as { woocommerce?: { status?: string; total?: string; dateModified?: string } } | null)
      ?.woocommerce;
    previous = { status: snap?.status, total: snap?.total };
    if (
      !shouldApplyWooOrder({
        topic: input.topic,
        incomingModified: remote.date_modified,
        storedModified: snap?.dateModified,
      })
    ) {
      await finishDelivery(supabase, input.deliveryId, "IGNORED");
      return { skipped: true, reason: "stale" };
    }
  }
  const echo = isPostbusEchoUpdate({
    previousStatus: previous?.status,
    nextStatus: remote.status,
    previousTotal: previous?.total,
    nextTotal: remote.total,
    meta: remote.meta_data,
  });
  const measures = await loadWooProductMeasures(creds, [remote]);
  const result = await upsertWooCommerceOrder(supabase, {
    organizationId: input.organizationId,
    storeHost: connection.store_host,
    remote,
    eligibleStatuses: wooSettings(connection).eligibleStatuses,
    weightUnit: connection.weight_unit,
    dimensionUnit: connection.dimension_unit,
    measures,
    applyAutomation: !echo,
  });
  await finishDelivery(supabase, input.deliveryId, "PROCESSED");
  return result;
}

async function loadConnected(supabase: SupabaseClient, connectionId: string, organizationId: string) {
  const { data } = await supabase
    .from("woocommerce_connections")
    .select("*")
    .eq("id", connectionId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  return (data as WooConnectionRow | null) ?? null;
}

async function finishDelivery(supabase: SupabaseClient, deliveryId: string | undefined, status: string) {
  if (!deliveryId) return;
  await supabase
    .from("woocommerce_webhook_deliveries")
    .update({ status, processed_at: new Date().toISOString() })
    .eq("id", deliveryId);
}
