import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptSecret } from "@/lib/security/crypto";
import { logError } from "@/lib/logger";
import { isMerchantWebhooksOpenForOrg } from "@/modules/merchant-api/flags";
import { subscriptionMatches } from "@/modules/webhooks/catalog";
import { webhookSignatureHeader } from "@/modules/webhooks/sign";
import { assertPublicHttpsUrl, type DnsLookup, type ResolvedAddress } from "@/modules/webhooks/ssrf";

const BACKOFF_MS = [60_000, 300_000, 1_800_000, 7_200_000, 28_800_000];
const MAX_ATTEMPTS = 6;

export function nextRetryDelayMs(attemptCount: number) {
  return BACKOFF_MS[Math.max(0, attemptCount - 1)] ?? BACKOFF_MS[BACKOFF_MS.length - 1];
}

export function redactDeliveryExcerpt(value: string) {
  return value.replace(/\s+/g, " ").replace(/pb_live_[a-z0-9_]+/gi, "[redacted]").slice(0, 180);
}

type DeliveryRow = {
  id: string;
  organization_id: string;
  endpoint_id: string;
  event: string;
  payload: Record<string, unknown>;
  status: string;
  attempt_count: number;
  event_id?: string | null;
  next_attempt_at?: string | null;
  webhook_endpoints?: {
    url?: string;
    encrypted_secret?: string | null;
    is_active?: boolean;
  } | null;
};

export type WebhookFetch = (url: string, init: RequestInit & { dispatcher?: unknown }) => Promise<Response>;

async function pinnedFetch(url: URL, _address: ResolvedAddress, init: RequestInit, fetchImpl?: WebhookFetch) {
  const run = fetchImpl ?? fetch;
  return run(url.toString(), { ...init, redirect: "manual" });
}

export async function postSignedWebhook(input: {
  url: string;
  body: string;
  headers: Record<string, string>;
  lookup?: DnsLookup;
  fetchImpl?: WebhookFetch;
}) {
  const checked = await assertPublicHttpsUrl(input.url, input.lookup);
  const response = await pinnedFetch(checked.url, checked.addresses[0], {
    method: "POST",
    headers: input.headers,
    body: input.body,
    signal: AbortSignal.timeout(10_000),
  }, input.fetchImpl);
  return response;
}

export async function fanOutWebhookEvents(supabase: SupabaseClient, organizationId: string) {
  if (!isMerchantWebhooksOpenForOrg(organizationId)) {
    await supabase.from("webhook_events").update({ status: "SKIPPED" }).eq("organization_id", organizationId).eq("status", "PENDING");
    return;
  }
  const { data: events } = await supabase
    .from("webhook_events")
    .select("id, event_type, payload, resource_id")
    .eq("organization_id", organizationId)
    .eq("status", "PENDING")
    .order("created_at", { ascending: true })
    .limit(50);
  if (!events?.length) return;
  const { data: endpoints } = await supabase
    .from("webhook_endpoints")
    .select("id, events, is_active")
    .eq("organization_id", organizationId)
    .eq("is_active", true);
  for (const event of events) {
    const envelope = event.payload as { id?: string };
    for (const endpoint of endpoints ?? []) {
      if (event.event_type === "webhook.test") {
        if (endpoint.id !== event.resource_id) continue;
      } else if (!subscriptionMatches(endpoint.events as string[] | null, event.event_type)) continue;
      await supabase.from("webhook_deliveries").insert({
        organization_id: organizationId,
        endpoint_id: endpoint.id,
        event: event.event_type,
        event_id: envelope.id ?? `evt_${event.id}`,
        payload: event.payload,
        status: "PENDING",
        attempt_count: 0,
      });
    }
    await supabase.from("webhook_events").update({ status: "DISPATCHED" }).eq("id", event.id).eq("status", "PENDING");
  }
}

function due(row: DeliveryRow, now: number) {
  if (row.status !== "PENDING" && row.status !== "RETRYING") return false;
  if (!row.next_attempt_at) return true;
  return new Date(row.next_attempt_at).getTime() <= now;
}

export async function deliverDueWebhooks(
  supabase: SupabaseClient,
  organizationId: string,
  deps?: { lookup?: DnsLookup; fetchImpl?: WebhookFetch; now?: number }
) {
  if (!isMerchantWebhooksOpenForOrg(organizationId)) return;
  const now = deps?.now ?? Date.now();
  const { data } = await supabase
    .from("webhook_deliveries")
    .select("*, webhook_endpoints(*)")
    .eq("organization_id", organizationId)
    .in("status", ["PENDING", "RETRYING"])
    .order("created_at", { ascending: true })
    .limit(20);
  for (const row of (data ?? []) as DeliveryRow[]) {
    if (!due(row, now)) continue;
    const { data: claimed } = await supabase
      .from("webhook_deliveries")
      .update({ status: "PROCESSING" })
      .eq("id", row.id)
      .in("status", ["PENDING", "RETRYING"])
      .select("id")
      .maybeSingle();
    if (!claimed) continue;
    await attemptDelivery(supabase, row, deps);
  }
}

async function attemptDelivery(
  supabase: SupabaseClient,
  row: DeliveryRow,
  deps?: { lookup?: DnsLookup; fetchImpl?: WebhookFetch }
) {
  const endpoint = row.webhook_endpoints;
  if (!endpoint?.is_active) {
    await supabase
      .from("webhook_deliveries")
      .update({ status: "DISABLED", last_error: "Endpoint is disabled." })
      .eq("id", row.id);
    return;
  }
  if (!endpoint.url) {
    await supabase.from("webhook_deliveries").update({ status: "FAILED", last_error: "Endpoint URL is missing." }).eq("id", row.id);
    return;
  }
  const eventId = row.event_id || (typeof row.payload?.id === "string" ? row.payload.id : `evt_${row.id}`);
  const body = JSON.stringify(row.payload ?? {});
  const timestamp = String(Date.now());
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "PostBus-Webhooks/1.0",
    "X-PostBus-Event-Id": eventId,
    "X-PostBus-Event-Type": row.event,
    "X-PostBus-Timestamp": timestamp,
  };
  if (!endpoint.encrypted_secret) {
    await supabase
      .from("webhook_deliveries")
      .update({ status: "FAILED", last_error: "Signing secret is missing. Rotate the endpoint secret.", attempt_count: row.attempt_count + 1 })
      .eq("id", row.id);
    return;
  }
  try {
    const secret = decryptSecret(endpoint.encrypted_secret);
    headers["X-PostBus-Signature"] = webhookSignatureHeader(secret, timestamp, eventId, body);
  } catch (error) {
    await supabase
      .from("webhook_deliveries")
      .update({
        status: "FAILED",
        last_error: error instanceof Error ? error.message : "Could not sign webhook payload.",
        attempt_count: row.attempt_count + 1,
      })
      .eq("id", row.id);
    return;
  }
  try {
    const response = await postSignedWebhook({ url: endpoint.url, body, headers, lookup: deps?.lookup, fetchImpl: deps?.fetchImpl });
    const excerpt = redactDeliveryExcerpt(await response.text().catch(() => ""));
    if (response.status >= 300 && response.status < 400) {
      await markRetry(supabase, row, "Redirects are not followed.", response.status, excerpt);
      return;
    }
    if (response.ok) {
      await supabase
        .from("webhook_deliveries")
        .update({
          status: "DELIVERED",
          response_code: response.status,
          response_excerpt: excerpt,
          last_error: null,
          attempt_count: row.attempt_count + 1,
          next_attempt_at: null,
          event_id: eventId,
        })
        .eq("id", row.id);
      return;
    }
    const retry = response.status === 408 || response.status === 429 || response.status >= 500;
    if (!retry) {
      await supabase
        .from("webhook_deliveries")
        .update({
          status: "FAILED",
          response_code: response.status,
          response_excerpt: excerpt,
          last_error: `HTTP ${response.status}`,
          attempt_count: row.attempt_count + 1,
          event_id: eventId,
        })
        .eq("id", row.id);
      return;
    }
    await markRetry(supabase, row, `HTTP ${response.status}`, response.status, excerpt, eventId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "delivery failed";
    const permanent = /Webhook URL|blocked address|not allowed|HTTPS/i.test(message);
    if (permanent) {
      await supabase
        .from("webhook_deliveries")
        .update({ status: "FAILED", last_error: message, attempt_count: row.attempt_count + 1, event_id: eventId })
        .eq("id", row.id);
      return;
    }
    await markRetry(supabase, row, message, null, null, eventId);
  }
}

async function markRetry(
  supabase: SupabaseClient,
  row: DeliveryRow,
  message: string,
  responseCode: number | null,
  excerpt: string | null,
  eventId?: string
) {
  const attempt = row.attempt_count + 1;
  if (attempt >= MAX_ATTEMPTS) {
    await supabase
      .from("webhook_deliveries")
      .update({
        status: "FAILED",
        last_error: message,
        response_code: responseCode,
        response_excerpt: excerpt,
        attempt_count: attempt,
        event_id: eventId ?? row.event_id,
      })
      .eq("id", row.id);
    return;
  }
  const next = new Date(Date.now() + nextRetryDelayMs(attempt)).toISOString();
  await supabase
    .from("webhook_deliveries")
    .update({
      status: "RETRYING",
      last_error: message,
      response_code: responseCode,
      response_excerpt: excerpt,
      attempt_count: attempt,
      next_attempt_at: next,
      event_id: eventId ?? row.event_id,
    })
    .eq("id", row.id);
}

export async function runWebhookProcessing(
  supabase: SupabaseClient,
  organizationId: string,
  deps?: { lookup?: DnsLookup; fetchImpl?: WebhookFetch }
) {
  try {
    await fanOutWebhookEvents(supabase, organizationId);
    await deliverDueWebhooks(supabase, organizationId, deps);
  } catch (error) {
    logError("webhook.processing_failed", {
      message: error instanceof Error ? error.message : "processing failed",
      organizationId,
    });
    throw error;
  }
}
