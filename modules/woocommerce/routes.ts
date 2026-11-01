import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import type { TenantContext } from "@/lib/api/context";
import {
  completeWooAuthorization,
  connectWooManual,
  disconnectWoo,
  registerWooWebhooks,
  startWooAuthorization,
  testWooConnection,
  wooStatus,
} from "@/modules/woocommerce/connect";
import { wooSettings } from "@/modules/woocommerce/orders";
import { loadWooConnection } from "@/modules/woocommerce/connect";
import { enqueueWooCommerceSync } from "@/modules/woocommerce/sync-job";

export async function handleWooCommerceIntegrationRoutes(
  request: NextRequest,
  supabase: SupabaseClient,
  ctx: TenantContext,
  key: string
) {
  if (key === "GET integrations/woocommerce") {
    return wooStatus(supabase, ctx.organizationId);
  }

  if (key === "GET integrations/woocommerce/deliveries") {
    const { data, error } = await supabase
      .from("woocommerce_webhook_deliveries")
      .select("id, topic, status, last_error, created_at, processed_at")
      .eq("organization_id", ctx.organizationId)
      .order("created_at", { ascending: false })
      .limit(30);
    if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Could not load sync logs.");
    return { deliveries: data ?? [] };
  }

  if (key === "POST integrations/woocommerce/authorize") {
    const body = await request.json().catch(() => ({}));
    return startWooAuthorization(supabase, ctx, String(body.storeUrl ?? body.store_url ?? ""));
  }

  if (key === "POST integrations/woocommerce/manual") {
    const body = await request.json().catch(() => ({}));
    return connectWooManual(supabase, ctx, {
      storeUrl: String(body.storeUrl ?? body.store_url ?? ""),
      consumerKey: String(body.consumerKey ?? body.consumer_key ?? ""),
      consumerSecret: String(body.consumerSecret ?? body.consumer_secret ?? ""),
    });
  }

  if (key === "POST integrations/woocommerce/test") {
    const body = await request.json().catch(() => ({}));
    return testWooConnection(supabase, ctx, {
      storeUrl: String(body.storeUrl ?? body.store_url ?? ""),
      consumerKey: String(body.consumerKey ?? body.consumer_key ?? ""),
      consumerSecret: String(body.consumerSecret ?? body.consumer_secret ?? ""),
    });
  }

  if (key === "POST integrations/woocommerce/webhooks") {
    return registerWooWebhooks(supabase, ctx);
  }

  if (key === "POST integrations/woocommerce/sync" || key === "POST integrations/woocommerce/retry") {
    const result = await enqueueWooCommerceSync(supabase, {
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      force: true,
    });
    if (!result.connected) {
      throw new AppError(
        ERROR_CODES.INTEGRATION_NOT_CONNECTED,
        "Your WooCommerce store connection needs attention. Please reconnect your store to continue automatic order synchronization."
      );
    }
    return result;
  }

  if (key === "PATCH integrations/woocommerce") {
    const body = await request.json().catch(() => ({}));
    const row = await loadWooConnection(supabase, ctx.organizationId);
    if (!row) throw new AppError(ERROR_CODES.INTEGRATION_NOT_CONNECTED, "Connect a WooCommerce store first.");
    const settings = { ...wooSettings(row) };
    if (Array.isArray(body.eligibleStatuses)) {
      settings.eligibleStatuses = body.eligibleStatuses.map((status: unknown) => String(status));
    }
    if (body.importDays != null) settings.importDays = Number(body.importDays) || 30;
    if ("customAfter" in body) settings.customAfter = body.customAfter ? String(body.customAfter) : null;
    if ("customBefore" in body) settings.customBefore = body.customBefore ? String(body.customBefore) : null;
    if (typeof body.addTrackingNote === "boolean") settings.addTrackingNote = body.addTrackingNote;
    if (typeof body.updateOrderStatus === "boolean") settings.updateOrderStatus = body.updateOrderStatus;
    if (body.statusMap && typeof body.statusMap === "object") settings.statusMap = body.statusMap;
    const patch: Record<string, unknown> = { settings };
    if (typeof body.syncEnabled === "boolean") patch.sync_enabled = body.syncEnabled;
    const { error } = await supabase.from("woocommerce_connections").update(patch).eq("id", row.id);
    if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Could not save WooCommerce settings.");
    const automation: Record<string, boolean> = {};
    if (typeof body.syncEnabled === "boolean") automation.auto_woocommerce_sync = body.syncEnabled;
    if (typeof body.autoSync === "boolean") automation.auto_woocommerce_sync = body.autoSync;
    if (typeof body.autoTracking === "boolean") automation.auto_woocommerce_tracking = body.autoTracking;
    if (Object.keys(automation).length) {
      await supabase.from("automation_settings").update(automation).eq("organization_id", ctx.organizationId);
    }
    await supabase.from("audit_logs").insert({
      organization_id: ctx.organizationId,
      actor_id: ctx.userId,
      action: "woocommerce.settings_updated",
      entity_type: "woocommerce_connection",
      entity_id: row.id,
    });
    return wooStatus(supabase, ctx.organizationId);
  }

  if (key === "DELETE integrations/woocommerce") {
    return disconnectWoo(supabase, ctx);
  }

  return null;
}

export async function acceptWooAuthCallback(request: NextRequest, supabase: SupabaseClient) {
  const contentType = request.headers.get("content-type") || "";
  let userId = "";
  let consumerKey = "";
  let consumerSecret = "";
  let permissions = "";
  if (contentType.includes("application/json")) {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    userId = String(body.user_id ?? "");
    consumerKey = String(body.consumer_key ?? "");
    consumerSecret = String(body.consumer_secret ?? "");
    permissions = String(body.key_permissions ?? "");
  } else {
    const text = await request.text();
    const params = new URLSearchParams(text);
    userId = params.get("user_id") ?? "";
    consumerKey = params.get("consumer_key") ?? "";
    consumerSecret = params.get("consumer_secret") ?? "";
    permissions = params.get("key_permissions") ?? "";
  }
  if (!userId || !consumerKey || !consumerSecret) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "The WooCommerce authorization was rejected or expired. Start the connection again.");
  }
  return completeWooAuthorization(supabase, { userId, consumerKey, consumerSecret, permissions });
}
