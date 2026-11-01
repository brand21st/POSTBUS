import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { decodeCursor, encodeCursor } from "@/modules/merchant-api/dto";
import { isMerchantWebhooksOpenForOrg } from "@/modules/merchant-api/flags";
import { encryptSecret, hashSecret, randomToken } from "@/lib/security/crypto";
import { normalizeSubscriptionEvents } from "@/modules/webhooks/catalog";
import { recordWebhookEvent } from "@/modules/webhooks/outbox";
import { WebhookUrlError, assertPublicHttpsUrl } from "@/modules/webhooks/ssrf";

const PUBLIC_COLUMNS = "id, url, description, events, is_active, disabled_at, created_at, updated_at, encrypted_secret";

function publicEndpoint(row: {
  id: string;
  url: string;
  description?: string | null;
  events: string[];
  is_active: boolean;
  disabled_at?: string | null;
  created_at: string;
  updated_at?: string;
  encrypted_secret?: string | null;
}) {
  const url = redactUrl(row.url);
  return {
    id: row.id,
    url,
    description: row.description ?? null,
    events: row.events ?? [],
    is_active: row.is_active,
    disabled_at: row.disabled_at ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at ?? row.created_at,
    needsSecretRotation: !row.encrypted_secret,
  };
}

export function redactUrl(value: string) {
  try {
    const url = new URL(value);
    url.search = "";
    url.username = "";
    url.password = "";
    return url.toString();
  } catch {
    return value.split("?")[0] ?? value;
  }
}

async function requireUrl(url: string) {
  try {
    await assertPublicHttpsUrl(url);
  } catch (error) {
    const message = error instanceof WebhookUrlError ? error.message : "Webhook URL is not allowed.";
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, message);
  }
}

export async function listWebhookSubscriptions(supabase: SupabaseClient, organizationId: string) {
  const { data, error } = await supabase
    .from("webhook_endpoints")
    .select(PUBLIC_COLUMNS)
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false });
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  return { items: (data ?? []).map((row) => publicEndpoint(row)) };
}

export async function createWebhookSubscription(
  supabase: SupabaseClient,
  organizationId: string,
  input: { url: string; events?: string[]; description?: string | null }
) {
  await requireUrl(input.url);
  let events: string[];
  try {
    events = normalizeSubscriptionEvents(input.events);
  } catch (error) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, error instanceof Error ? error.message : "Invalid events.");
  }
  const secret = randomToken(24);
  const { data, error } = await supabase
    .from("webhook_endpoints")
    .insert({
      organization_id: organizationId,
      url: input.url.trim(),
      description: input.description?.trim() || null,
      secret_hash: hashSecret(secret),
      encrypted_secret: encryptSecret(secret),
      events,
      is_active: true,
    })
    .select(PUBLIC_COLUMNS)
    .single();
  if (error || !data) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error?.message || "Could not create webhook.");
  return { ...publicEndpoint(data), secret };
}

async function loadOwned(supabase: SupabaseClient, organizationId: string, id: string) {
  const { data } = await supabase
    .from("webhook_endpoints")
    .select(PUBLIC_COLUMNS)
    .eq("organization_id", organizationId)
    .eq("id", id)
    .maybeSingle();
  if (!data) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Webhook subscription was not found.");
  return data;
}

export async function getWebhookSubscription(supabase: SupabaseClient, organizationId: string, id: string) {
  return publicEndpoint(await loadOwned(supabase, organizationId, id));
}

export async function updateWebhookSubscription(
  supabase: SupabaseClient,
  organizationId: string,
  id: string,
  input: { url?: string; events?: string[]; description?: string | null; enabled?: boolean }
) {
  await loadOwned(supabase, organizationId, id);
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.url) {
    await requireUrl(input.url);
    patch.url = input.url.trim();
  }
  if (input.events) {
    try {
      patch.events = normalizeSubscriptionEvents(input.events);
    } catch (error) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, error instanceof Error ? error.message : "Invalid events.");
    }
  }
  if (input.description !== undefined) patch.description = input.description?.trim() || null;
  if (input.enabled === true) {
    patch.is_active = true;
    patch.disabled_at = null;
  }
  if (input.enabled === false) {
    patch.is_active = false;
    patch.disabled_at = new Date().toISOString();
  }
  const { data, error } = await supabase
    .from("webhook_endpoints")
    .update(patch)
    .eq("organization_id", organizationId)
    .eq("id", id)
    .select(PUBLIC_COLUMNS)
    .single();
  if (error || !data) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error?.message || "Could not update webhook.");
  return publicEndpoint(data);
}

export async function disableWebhookSubscription(supabase: SupabaseClient, organizationId: string, id: string) {
  return updateWebhookSubscription(supabase, organizationId, id, { enabled: false });
}

export async function rotateWebhookSecret(supabase: SupabaseClient, organizationId: string, id: string) {
  await loadOwned(supabase, organizationId, id);
  const secret = randomToken(24);
  const { data, error } = await supabase
    .from("webhook_endpoints")
    .update({
      secret_hash: hashSecret(secret),
      encrypted_secret: encryptSecret(secret),
      updated_at: new Date().toISOString(),
    })
    .eq("organization_id", organizationId)
    .eq("id", id)
    .select(PUBLIC_COLUMNS)
    .single();
  if (error || !data) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error?.message || "Could not rotate secret.");
  return { ...publicEndpoint(data), secret };
}

export async function listWebhookDeliveries(
  supabase: SupabaseClient,
  organizationId: string,
  endpointId: string,
  cursor?: string | null,
  limit = 20
) {
  await loadOwned(supabase, organizationId, endpointId);
  const page = Math.min(Math.max(limit, 1), 100);
  let query = supabase
    .from("webhook_deliveries")
    .select("id, event_id, event, status, attempt_count, response_code, last_error, next_attempt_at, created_at")
    .eq("organization_id", organizationId)
    .eq("endpoint_id", endpointId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(page + 1);
  const decoded = decodeCursor(cursor ?? undefined);
  if (decoded) query = query.lt("created_at", decoded.u);
  const { data, error } = await query;
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  const rows = data ?? [];
  const pageRows = rows.slice(0, page);
  const last = pageRows.at(-1);
  return {
    items: pageRows.map((row) => ({
      id: row.id,
      event_id: row.event_id,
      event: row.event,
      status: row.status,
      attempt_count: row.attempt_count,
      response_code: row.response_code,
      last_error: row.last_error,
      next_attempt_at: row.next_attempt_at,
      created_at: row.created_at,
    })),
    next_cursor: rows.length > page && last ? encodeCursor(last.created_at, last.id) : null,
  };
}

export async function retryWebhookDelivery(
  supabase: SupabaseClient,
  organizationId: string,
  endpointId: string,
  deliveryId: string
) {
  await loadOwned(supabase, organizationId, endpointId);
  const { data } = await supabase
    .from("webhook_deliveries")
    .select("id, status")
    .eq("organization_id", organizationId)
    .eq("endpoint_id", endpointId)
    .eq("id", deliveryId)
    .maybeSingle();
  if (!data) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Delivery was not found.");
  const { error } = await supabase
    .from("webhook_deliveries")
    .update({ status: "PENDING", next_attempt_at: null, last_error: null })
    .eq("id", deliveryId)
    .eq("organization_id", organizationId);
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  const { createBackgroundJob } = await import("@/modules/jobs/service");
  await createBackgroundJob(supabase, {
    organizationId,
    jobType: "webhook-processing",
    entityType: "webhook_endpoint",
    entityId: endpointId,
  }).catch(() => undefined);
  return { id: deliveryId, status: "PENDING" };
}

export async function sendWebhookTest(supabase: SupabaseClient, organizationId: string, endpointId: string) {
  if (!isMerchantWebhooksOpenForOrg(organizationId)) {
    throw new AppError(ERROR_CODES.FORBIDDEN, "Webhooks are not enabled for this workspace.");
  }
  const endpoint = await loadOwned(supabase, organizationId, endpointId);
  if (!endpoint.is_active) throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Enable the endpoint before sending a test.");
  const stamp = new Date().toISOString();
  const recorded = await recordWebhookEvent(supabase, {
    organizationId,
    type: "webhook.test",
    resourceType: "webhook_endpoint",
    resourceId: endpointId,
    dedupeKey: `webhook.test:${organizationId}:${endpointId}:${stamp}`,
    data: { status: "test" },
  });
  if (!recorded.recorded) throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Test event was not recorded.");
  return { event_id: recorded.id, type: "webhook.test" };
}

export async function listRecentWebhookDeliveries(supabase: SupabaseClient, organizationId: string) {
  const { data, error } = await supabase
    .from("webhook_deliveries")
    .select("id, endpoint_id, event_id, event, status, attempt_count, response_code, last_error, next_attempt_at, created_at, webhook_endpoints(url)")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  return {
    items: (data ?? []).map((row) => {
      const endpoint = row.webhook_endpoints as { url?: string } | { url?: string }[] | null;
      const url = Array.isArray(endpoint) ? endpoint[0]?.url : endpoint?.url;
      return {
        id: row.id,
        endpoint_id: row.endpoint_id,
        event_id: row.event_id,
        event: row.event,
        destination: url ? redactUrl(url) : null,
        status: row.status,
        attempt_count: row.attempt_count,
        response_code: row.response_code,
        last_error: row.last_error,
        next_attempt_at: row.next_attempt_at,
        created_at: row.created_at,
      };
    }),
  };
}
