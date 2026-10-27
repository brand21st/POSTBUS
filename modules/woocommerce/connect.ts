import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import type { TenantContext } from "@/lib/api/context";
import { env } from "@/lib/env";
import { encryptSecret, decryptSecret, randomToken } from "@/lib/security/crypto";
import { assertPublicHttpsUrl, storeHostOf, storeOriginOf } from "@/lib/security/outbound-url";
import { sharedRateLimit } from "@/lib/security/shared-rate-limit";
import {
  createWooWebhook,
  deleteWooWebhook,
  getWooProductSettings,
  verifyWooRead,
  WooCommerceRequestError,
  type WooCredentials,
  type WooTransport,
} from "@/modules/woocommerce/client";
import { measurementUnitsFromSettings, wooSettings, type WooConnectionRow } from "@/modules/woocommerce/orders";

export const WOO_ORDER_TOPICS = ["order.created", "order.updated", "order.deleted"] as const;

const AUTH_TTL_MS = 15 * 60 * 1000;

export function decideWooAuthCallback(input: {
  permissions: string;
  stateFound: boolean;
  expired: boolean;
  alreadyUsed: boolean;
}) {
  if (!input.stateFound) return { ok: false as const, reason: "rejected" as const };
  if (input.expired) return { ok: false as const, reason: "expired" as const };
  if (input.alreadyUsed) return { ok: true as const, duplicate: true as const };
  if (input.permissions !== "read_write") return { ok: false as const, reason: "permissions" as const };
  return { ok: true as const, duplicate: false as const };
}

export function publicWooConnection(row: WooConnectionRow | null, ordersImported = 0) {
  const settings = wooSettings(row);
  return {
    status: row?.status ?? "NOT_CONNECTED",
    storeUrl: row?.store_url ?? "",
    storeHost: row?.store_host ?? "",
    syncEnabled: row?.sync_enabled !== false,
    lastSyncAt: row?.last_sync_at ?? null,
    lastSuccessfulSyncAt: row?.last_successful_sync_at ?? null,
    lastWebhookAt: row?.last_webhook_at ?? null,
    lastError: row?.last_error ?? null,
    weightUnit: row?.weight_unit ?? null,
    dimensionUnit: row?.dimension_unit ?? null,
    ordersImported,
    hasCredentials: Boolean(row?.encrypted_consumer_key && row?.encrypted_consumer_secret),
    webhookIds: settings.webhookIds ?? [],
    settings: {
      eligibleStatuses: settings.eligibleStatuses ?? ["processing", "on-hold"],
      importDays: settings.importDays ?? 30,
      customAfter: settings.customAfter ?? null,
      customBefore: settings.customBefore ?? null,
      addTrackingNote: settings.addTrackingNote === true,
      updateOrderStatus: settings.updateOrderStatus === true,
      statusMap: settings.statusMap ?? {},
    },
  };
}

export function credentialsFromConnection(row: WooConnectionRow | null): WooCredentials | null {
  if (!row?.encrypted_consumer_key || !row.encrypted_consumer_secret || !row.store_url) return null;
  if (row.status !== "CONNECTED" && row.status !== "ERROR") return null;
  return {
    storeUrl: row.store_url,
    consumerKey: decryptSecret(row.encrypted_consumer_key),
    consumerSecret: decryptSecret(row.encrypted_consumer_secret),
  };
}

export async function loadWooConnection(supabase: SupabaseClient, organizationId: string) {
  const { data, error } = await supabase
    .from("woocommerce_connections")
    .select("*")
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error) return null;
  return (data as WooConnectionRow | null) ?? null;
}

function webhookDeliveryUrl(connectionId: string) {
  return `${env.appUrl.replace(/\/+$/, "")}/api/v1/webhooks/woocommerce/${connectionId}`;
}

function authCallbackUrl() {
  return `${env.appUrl.replace(/\/+$/, "")}/api/v1/webhooks/woocommerce/auth`;
}

export function wooAuthorizeUrl(storeUrl: string, state: string) {
  const url = new URL("/wc-auth/v1/authorize", `${storeUrl.replace(/\/+$/, "")}/`);
  url.searchParams.set("app_name", "PostBus");
  url.searchParams.set("scope", "read_write");
  url.searchParams.set("user_id", state);
  url.searchParams.set("return_url", `${env.appUrl.replace(/\/+$/, "")}/dashboard/integrations/woocommerce`);
  url.searchParams.set("callback_url", authCallbackUrl());
  return url.toString();
}

async function assertConnectRate(organizationId: string) {
  const limited = await sharedRateLimit(`woo-connect:${organizationId}`, 10, 60_000);
  if (!limited.ok) {
    throw new AppError(ERROR_CODES.RATE_LIMITED, "Too many connection attempts. Try again shortly.");
  }
}

async function rejectSecondStore(existing: WooConnectionRow | null, host: string) {
  if (existing && existing.status === "CONNECTED" && existing.store_host && existing.store_host !== host) {
    throw new AppError(
      ERROR_CODES.CONFLICT,
      "Disconnect the current WooCommerce store before connecting a different one."
    );
  }
}

export async function startWooAuthorization(
  supabase: SupabaseClient,
  ctx: TenantContext,
  storeUrl: string
) {
  await assertConnectRate(ctx.organizationId);
  const checked = await assertPublicHttpsUrl(storeUrl);
  const host = storeHostOf(checked.url);
  const origin = storeOriginOf(checked.url);
  const existing = await loadWooConnection(supabase, ctx.organizationId);
  await rejectSecondStore(existing, host);
  const state = randomToken(24);
  const payload = {
    organization_id: ctx.organizationId,
    store_url: origin,
    store_host: host,
    status: existing?.status === "CONNECTED" ? existing.status : "PENDING",
    auth_state: state,
    auth_state_expires_at: new Date(Date.now() + AUTH_TTL_MS).toISOString(),
    auth_state_used_at: null,
    last_error: null,
  };
  const query = existing
    ? supabase.from("woocommerce_connections").update(payload).eq("id", existing.id)
    : supabase.from("woocommerce_connections").insert(payload);
  const { error } = await query;
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Could not start the WooCommerce connection.");
  await supabase.from("audit_logs").insert({
    organization_id: ctx.organizationId,
    actor_id: ctx.userId,
    action: "woocommerce.auth_started",
    entity_type: "woocommerce_connection",
    entity_id: existing?.id ?? null,
  });
  return { authorizeUrl: wooAuthorizeUrl(origin, state) };
}

export async function connectWooManual(
  supabase: SupabaseClient,
  ctx: TenantContext,
  input: { storeUrl: string; consumerKey: string; consumerSecret: string },
  transport?: WooTransport
) {
  await assertConnectRate(ctx.organizationId);
  const consumerKey = input.consumerKey.trim();
  const consumerSecret = input.consumerSecret.trim();
  if (!consumerKey || !consumerSecret) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Enter the consumer key and consumer secret.");
  }
  const checked = await assertPublicHttpsUrl(input.storeUrl);
  const host = storeHostOf(checked.url);
  const origin = storeOriginOf(checked.url);
  const existing = await loadWooConnection(supabase, ctx.organizationId);
  await rejectSecondStore(existing, host);
  const creds = { storeUrl: origin, consumerKey, consumerSecret };
  try {
    await verifyWooRead(creds, transport);
  } catch (error) {
    throw new AppError(
      ERROR_CODES.VALIDATION_ERROR,
      error instanceof WooCommerceRequestError ? error.message : "PostBus could not verify that WooCommerce store."
    );
  }
  const saved = await persistConnected(supabase, ctx.organizationId, existing, {
    storeUrl: origin,
    storeHost: host,
    consumerKey,
    consumerSecret,
  });
  await finishConnect(supabase, saved, creds, ctx.userId, transport);
  return publicWooConnection(await loadWooConnection(supabase, ctx.organizationId));
}

export async function testWooConnection(
  supabase: SupabaseClient,
  ctx: TenantContext,
  input: { storeUrl?: string; consumerKey?: string; consumerSecret?: string },
  transport?: WooTransport
) {
  await assertConnectRate(ctx.organizationId);
  const consumerKey = (input.consumerKey ?? "").trim();
  const consumerSecret = (input.consumerSecret ?? "").trim();
  const storeUrl = (input.storeUrl ?? "").trim();
  let creds: WooCredentials | null = null;
  if (consumerKey || consumerSecret || storeUrl) {
    if (!consumerKey || !consumerSecret) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Enter the consumer key and consumer secret.");
    }
    const checked = await assertPublicHttpsUrl(storeUrl);
    creds = { storeUrl: storeOriginOf(checked.url), consumerKey, consumerSecret };
  } else {
    creds = credentialsFromConnection(await loadWooConnection(supabase, ctx.organizationId));
  }
  if (!creds) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Enter the store URL and a Read/Write REST API key.");
  }
  try {
    await verifyWooRead(creds, transport);
  } catch (error) {
    throw new AppError(
      ERROR_CODES.VALIDATION_ERROR,
      error instanceof WooCommerceRequestError ? error.message : "PostBus could not verify that WooCommerce store."
    );
  }
  return { ok: true as const, storeHost: storeHostOf(new URL(creds.storeUrl)) };
}

export async function registerWooWebhooks(
  supabase: SupabaseClient,
  ctx: TenantContext,
  transport?: WooTransport
) {
  await assertConnectRate(ctx.organizationId);
  const existing = await loadWooConnection(supabase, ctx.organizationId);
  const creds = credentialsFromConnection(existing);
  if (!existing || !creds) {
    throw new AppError(ERROR_CODES.INTEGRATION_NOT_CONNECTED, "Connect a WooCommerce store first.");
  }
  const secret = await ensureWebhookSecret(supabase, existing);
  const previousIds = wooSettings(existing).webhookIds ?? [];
  for (const id of previousIds) {
    await deleteWooWebhook(creds, id, transport);
  }
  try {
    const webhookIds = await installWooWebhooks(existing.id, creds, secret, transport);
    await supabase
      .from("woocommerce_connections")
      .update({
        settings: { ...wooSettings(existing), webhookIds },
        last_error: null,
      })
      .eq("id", existing.id);
  } catch (error) {
    const message =
      error instanceof WooCommerceRequestError && (error.status === 401 || error.status === 403)
        ? "The API key needs Read/Write permission to register webhooks."
        : "Connected, but webhooks could not be registered. Check that the key is Read/Write, then try again.";
    await supabase.from("woocommerce_connections").update({ last_error: message }).eq("id", existing.id);
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, message);
  }
  await supabase.from("audit_logs").insert({
    organization_id: ctx.organizationId,
    actor_id: ctx.userId,
    action: "woocommerce.webhooks_registered",
    entity_type: "woocommerce_connection",
    entity_id: existing.id,
  });
  return wooStatus(supabase, ctx.organizationId);
}

async function persistConnected(
  supabase: SupabaseClient,
  organizationId: string,
  existing: WooConnectionRow | null,
  input: { storeUrl: string; storeHost: string; consumerKey: string; consumerSecret: string }
) {
  const webhookSecret = randomToken(32);
  const payload = {
    organization_id: organizationId,
    store_url: input.storeUrl,
    store_host: input.storeHost,
    encrypted_consumer_key: encryptSecret(input.consumerKey),
    encrypted_consumer_secret: encryptSecret(input.consumerSecret),
    encrypted_webhook_secret: encryptSecret(webhookSecret),
    status: "CONNECTED",
    sync_enabled: true,
    auth_state: null,
    auth_state_expires_at: null,
    auth_state_used_at: new Date().toISOString(),
    last_error: null,
    installed_at: new Date().toISOString(),
  };
  const query = existing
    ? supabase.from("woocommerce_connections").update(payload).eq("id", existing.id)
    : supabase.from("woocommerce_connections").insert(payload);
  const { data, error } = await query.select("*").single();
  if (error || !data) throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Could not save the WooCommerce connection.");
  return data as WooConnectionRow & { encrypted_webhook_secret: string };
}

async function ensureWebhookSecret(supabase: SupabaseClient, row: WooConnectionRow) {
  if (row.encrypted_webhook_secret) return decryptSecret(row.encrypted_webhook_secret);
  const webhookSecret = randomToken(32);
  const { error } = await supabase
    .from("woocommerce_connections")
    .update({ encrypted_webhook_secret: encryptSecret(webhookSecret) })
    .eq("id", row.id);
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Could not save the WooCommerce webhook secret.");
  return webhookSecret;
}

async function installWooWebhooks(
  connectionId: string,
  creds: WooCredentials,
  secret: string,
  transport?: WooTransport
) {
  const webhookIds: number[] = [];
  for (const topic of WOO_ORDER_TOPICS) {
    const id = await createWooWebhook(
      creds,
      {
        name: `PostBus ${topic}`,
        topic,
        deliveryUrl: webhookDeliveryUrl(connectionId),
        secret,
      },
      transport
    );
    webhookIds.push(id);
  }
  return webhookIds;
}

async function finishConnect(
  supabase: SupabaseClient,
  row: WooConnectionRow & { encrypted_webhook_secret?: string | null },
  creds: WooCredentials,
  userId: string | undefined,
  transport?: WooTransport
) {
  const secret = row.encrypted_webhook_secret ? decryptSecret(row.encrypted_webhook_secret) : "";
  let webhookIds: number[] = [];
  try {
    if (secret) webhookIds = await installWooWebhooks(row.id, creds, secret, transport);
  } catch (error) {
    if (error instanceof WooCommerceRequestError && (error.status === 401 || error.status === 403)) {
      await supabase
        .from("woocommerce_connections")
        .update({
          status: "ERROR",
          encrypted_consumer_key: null,
          encrypted_consumer_secret: null,
          encrypted_webhook_secret: null,
          last_error: "The API key needs Read/Write permission.",
        })
        .eq("id", row.id);
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, "The API key needs Read/Write permission.");
    }
    await supabase
      .from("woocommerce_connections")
      .update({ last_error: "Connected, but webhooks could not be registered. Use Register webhooks, then Sync now." })
      .eq("id", row.id);
  }
  let weightUnit: string | null = null;
  let dimensionUnit: string | null = null;
  try {
    const units = measurementUnitsFromSettings(await getWooProductSettings(creds, transport));
    weightUnit = units.weightUnit;
    dimensionUnit = units.dimensionUnit;
  } catch {
    weightUnit = "kg";
    dimensionUnit = "cm";
  }
  const settings = { ...wooSettings(row), webhookIds };
  await supabase
    .from("woocommerce_connections")
    .update({ weight_unit: weightUnit, dimension_unit: dimensionUnit, settings })
    .eq("id", row.id);
  await supabase.from("audit_logs").insert({
    organization_id: row.organization_id,
    actor_id: userId || null,
    action: "woocommerce.connected",
    entity_type: "woocommerce_connection",
    entity_id: row.id,
  });
  const { enqueueWooCommerceSync } = await import("@/modules/woocommerce/sync-job");
  await enqueueWooCommerceSync(supabase, {
    organizationId: row.organization_id,
    userId,
    force: true,
  }).catch(() => undefined);
}

export async function completeWooAuthorization(
  supabase: SupabaseClient,
  input: {
    userId: string;
    consumerKey: string;
    consumerSecret: string;
    permissions: string;
  },
  transport?: WooTransport
) {
  const { data: row } = await supabase
    .from("woocommerce_connections")
    .select("*")
    .eq("auth_state", input.userId)
    .maybeSingle();
  const connection = (row as WooConnectionRow | null) ?? null;
  const expired = Boolean(
    connection?.auth_state_expires_at && Date.parse(connection.auth_state_expires_at) < Date.now()
  );
  const decision = decideWooAuthCallback({
    permissions: input.permissions,
    stateFound: Boolean(connection),
    expired,
    alreadyUsed: Boolean(connection?.auth_state_used_at),
  });
  if (!decision.ok) {
    const message =
      decision.reason === "permissions"
        ? "The API key needs Read/Write permission."
        : "The WooCommerce authorization was rejected or expired. Start the connection again.";
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, message);
  }
  if (decision.duplicate) return { ok: true, duplicate: true };
  if (!connection) throw new AppError(ERROR_CODES.VALIDATION_ERROR, "The WooCommerce authorization was rejected.");
  const creds = {
    storeUrl: connection.store_url,
    consumerKey: input.consumerKey.trim(),
    consumerSecret: input.consumerSecret.trim(),
  };
  try {
    await verifyWooRead(creds, transport);
  } catch (error) {
    await supabase
      .from("woocommerce_connections")
      .update({
        status: "ERROR",
        auth_state: null,
        last_error: error instanceof WooCommerceRequestError ? error.message : "Could not verify the store.",
      })
      .eq("id", connection.id);
    throw new AppError(
      ERROR_CODES.VALIDATION_ERROR,
      "Your WooCommerce store connection needs attention. Please reconnect your store to continue automatic order synchronization."
    );
  }
  const saved = await persistConnected(supabase, connection.organization_id, connection, {
    storeUrl: connection.store_url,
    storeHost: connection.store_host,
    consumerKey: creds.consumerKey,
    consumerSecret: creds.consumerSecret,
  });
  await finishConnect(supabase, saved, creds, undefined, transport);
  return { ok: true, duplicate: false };
}

export async function disconnectWoo(supabase: SupabaseClient, ctx: TenantContext, transport?: WooTransport) {
  const existing = await loadWooConnection(supabase, ctx.organizationId);
  if (!existing) return publicWooConnection(null);
  const creds = credentialsFromConnection(existing);
  const ids = wooSettings(existing).webhookIds ?? [];
  if (creds) {
    for (const id of ids) {
      await deleteWooWebhook(creds, id, transport);
    }
  }
  const { error } = await supabase
    .from("woocommerce_connections")
    .update({
      status: "DISCONNECTED",
      encrypted_consumer_key: null,
      encrypted_consumer_secret: null,
      encrypted_webhook_secret: null,
      auth_state: null,
      auth_state_expires_at: null,
      sync_enabled: false,
      last_error: null,
    })
    .eq("id", existing.id);
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Could not disconnect the store.");
  await supabase.from("audit_logs").insert({
    organization_id: ctx.organizationId,
    actor_id: ctx.userId,
    action: "woocommerce.disconnected",
    entity_type: "woocommerce_connection",
    entity_id: existing.id,
  });
  return publicWooConnection({ ...existing, status: "DISCONNECTED", encrypted_consumer_key: null, encrypted_consumer_secret: null });
}

export async function wooStatus(supabase: SupabaseClient, organizationId: string) {
  const row = await loadWooConnection(supabase, organizationId);
  const { count } = await supabase
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .eq("source", "WOOCOMMERCE");
  const { data: automation } = await supabase
    .from("automation_settings")
    .select("auto_woocommerce_sync, auto_woocommerce_tracking")
    .eq("organization_id", organizationId)
    .maybeSingle();
  return {
    ...publicWooConnection(row, count ?? 0),
    autoSync: automation?.auto_woocommerce_sync !== false && row?.sync_enabled !== false,
    autoTracking: automation?.auto_woocommerce_tracking === true,
  };
}
