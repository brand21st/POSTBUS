import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { logError, logInfo } from "@/lib/logger";
import { hashSecret } from "@/lib/security/crypto";
import { emitWebhook } from "@/modules/webhooks/outgoing";
import { watiPhoneNumber } from "@/modules/wati/client";

export type WatiWebhookPayload = {
  eventType?: string;
  event_type?: string;
  id?: string;
  localMessageId?: string;
  local_message_id?: string;
  whatsappMessageId?: string;
  waId?: string;
  wa_id?: string;
  templateName?: string;
  template_name?: string;
  statusString?: string;
  status?: string;
  text?: string | null;
  type?: string;
};

function asEventRecord(body: unknown): WatiWebhookPayload {
  if (Array.isArray(body)) return (body[0] ?? {}) as WatiWebhookPayload;
  if (!body || typeof body !== "object") return {};
  const record = body as WatiWebhookPayload & { event?: unknown; data?: unknown };
  if (record.event && typeof record.event === "object") return record.event as WatiWebhookPayload;
  return record;
}

export function parseWatiWebhookEvents(body: unknown) {
  if (Array.isArray(body)) {
    return body.length ? body.map((item) => parseWatiWebhookEvent(item)) : [parseWatiWebhookEvent({})];
  }
  if (body && typeof body === "object" && Array.isArray((body as { events?: unknown }).events)) {
    const events = (body as { events: unknown[] }).events;
    return events.length ? events.map((item) => parseWatiWebhookEvent(item)) : [parseWatiWebhookEvent(body)];
  }
  return [parseWatiWebhookEvent(body)];
}

export function parseWatiWebhookEvent(body: unknown) {
  const record = asEventRecord(body);
  const namedEvent = typeof (record as { event?: unknown }).event === "string" ? (record as { event?: string }).event : "";
  const eventType = String(record.eventType ?? record.event_type ?? namedEvent ?? "unknown").trim() || "unknown";
  const eventId = String(
    record.id ?? record.localMessageId ?? record.local_message_id ?? record.whatsappMessageId ?? ""
  ).trim();
  return {
    eventType,
    eventId: eventId || hashSecret(JSON.stringify(body ?? {})),
    waId: record.waId ?? record.wa_id ?? null,
    templateName: record.templateName ?? record.template_name ?? null,
    status: record.statusString ?? (typeof record.status === "string" ? record.status : null),
    text: typeof record.text === "string" ? record.text : null,
    type: record.type ?? null,
  };
}

export function watiWebhookNotification(eventType: string) {
  const key = eventType.toLowerCase();
  if (key.includes("failed")) {
    return { type: "wati.template_failed", title: "Wati template failed" };
  }
  if (key.includes("replied") || key === "message" || key.includes("received") || key.includes("newcontact")) {
    return { type: "wati.message_received", title: "WhatsApp reply" };
  }
  if (key.includes("delivered")) {
    return { type: "wati.message_delivered", title: "WhatsApp delivered" };
  }
  if (key.includes("sent")) {
    return { type: "wati.message_sent", title: "WhatsApp message sent" };
  }
  return { type: "wati.event", title: "Wati webhook" };
}

export function shouldNotifyWatiEvent(eventType: string) {
  const key = eventType.toLowerCase();
  return (
    key.includes("failed") ||
    key.includes("replied") ||
    key === "message" ||
    key.includes("received") ||
    key.includes("newcontact")
  );
}

export async function acceptWatiWebhook(
  supabase: SupabaseClient,
  input: { connectionId: string; rawBody: string }
) {
  const { data: connection, error } = await supabase
    .from("wati_connections")
    .select("id, organization_id, status")
    .eq("id", input.connectionId)
    .maybeSingle();
  if (error) {
    logError("wati.webhook.lookup_failed", {
      connectionId: input.connectionId,
      message: error.message,
    });
  }
  if (!connection) {
    throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Not found.");
  }

  let body: unknown = {};
  try {
    body = input.rawBody ? JSON.parse(input.rawBody) : {};
  } catch {
    body = { raw: input.rawBody };
  }
  const events = parseWatiWebhookEvents(body);
  let duplicate = true;
  for (const event of events) {
    const stored = await storeWatiWebhookEvent(supabase, connection, event, input.rawBody);
    duplicate = duplicate && stored.duplicate;
  }
  const event = events[events.length - 1];
  return { accepted: true, duplicate, eventType: event?.eventType ?? "unknown" };
}

async function storeWatiWebhookEvent(
  supabase: SupabaseClient,
  connection: { id: string; organization_id: string },
  event: ReturnType<typeof parseWatiWebhookEvent>,
  rawBody: string
) {
  const idempotencyKey = `wati:${connection.id}:${event.eventId}`;
  const { data: existing } = await supabase
    .from("idempotency_keys")
    .select("id")
    .eq("organization_id", connection.organization_id)
    .eq("key", idempotencyKey)
    .maybeSingle();
  if (existing) {
    return { duplicate: true };
  }

  const { error: idempotencyError } = await supabase.from("idempotency_keys").insert({
    organization_id: connection.organization_id,
    key: idempotencyKey,
    request_hash: hashSecret(rawBody || event.eventId),
  });
  if (idempotencyError?.code === "23505") {
    return { duplicate: true };
  }

  await supabase
    .from("wati_connections")
    .update({
      last_webhook_at: new Date().toISOString(),
      last_webhook_event: event.eventType,
      last_webhook_error: event.eventType.toLowerCase().includes("failed")
        ? event.text || event.status || "Wati reported a failed message."
        : null,
    })
    .eq("id", connection.id);

  if (shouldNotifyWatiEvent(event.eventType)) {
    const notice = watiWebhookNotification(event.eventType);
    const phone = watiPhoneNumber(event.waId);
    const { error: noticeError } = await supabase.from("notifications").insert({
      organization_id: connection.organization_id,
      type: notice.type,
      title: notice.title,
      body: [event.templateName, event.status, phone, event.text].filter(Boolean).join(" · ").slice(0, 240),
      entity_type: "wati_connection",
      entity_id: connection.id,
    });
    if (noticeError) {
      logError("wati.webhook.notify_failed", {
        connectionId: connection.id,
        message: noticeError.message,
      });
    }
  }

  try {
    await emitWebhook(supabase, connection.organization_id, "wati.event", {
      eventType: event.eventType,
      eventId: event.eventId,
      waId: event.waId,
      templateName: event.templateName,
      status: event.status,
    });
  } catch (error) {
    logError("wati.webhook.emit_failed", {
      connectionId: connection.id,
      message: error instanceof Error ? error.message : "emit failed",
    });
  }

  logInfo("wati.webhook.accepted", {
    connectionId: connection.id,
    organizationId: connection.organization_id,
    eventType: event.eventType,
  });

  return { duplicate: false };
}
