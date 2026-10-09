import type { SupabaseClient } from "@supabase/supabase-js";
import { extractIndiaMobileDigits } from "@/lib/phone/india-whatsapp";
import { parseInboundMessage, flattenInboundPayload } from "@/modules/vachat/inbound";
import { createBackgroundJob } from "@/modules/jobs/service";
import { loadSupportSettings } from "@/modules/support/flag";
import { isSupportWhatsAppMode } from "@/modules/support/provider";
import { ensureSupportChannel, upsertConversation } from "@/modules/support/conversations";
import { attachOrCreateTicket } from "@/modules/support/tickets";
import { shouldApplyMessageStatus } from "@/modules/support/states";
import { serviceWindowExpiresAt, shouldAdvanceCustomerTimestamp } from "@/modules/support/window";
import { logError } from "@/lib/logger";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

export function supportMerchantIdFromPayload(payload: Record<string, unknown>) {
  const data = asRecord(payload.data);
  return firstString(payload.merchant_id, data.merchant_id, payload.organization_id);
}

export async function enqueueSupportIngest(
  supabase: SupabaseClient,
  organizationId: string,
  progress: Record<string, unknown>
) {
  await createBackgroundJob(supabase, {
    organizationId,
    jobType: "support-ingest",
    entityType: "support_ingest",
    entityId: String(progress.envelopeId || crypto.randomUUID()),
    progress,
  });
}

export async function maybeRouteInboundToSupport(
  supabase: SupabaseClient,
  organizationId: string,
  payload: Record<string, unknown>,
  rawBody: string,
  channelKind?: string,
  orderId?: string | null
) {
  const settings = await loadSupportSettings(supabase, organizationId);
  if (!settings.enabled) return { routed: false as const };
  try {
    await enqueueSupportIngest(supabase, organizationId, {
      kind: "inbound",
      organizationId,
      payload,
      rawBody,
      channelKind: channelKind ?? settings.mode,
      orderId: orderId ?? null,
      envelopeId: firstString(payload.id, asRecord(payload.data).id),
    });
  } catch (error) {
    logError("support.ingest.enqueue_failed", {
      organizationId,
      message: error instanceof Error ? error.message : "enqueue",
    });
    await ingestSupportEvent(supabase, organizationId, {
      kind: "inbound",
      payload,
      channelKind: channelKind ?? settings.mode,
      orderId: orderId ?? null,
    });
  }
  return { routed: true as const };
}

export async function ingestSupportEvent(
  supabase: SupabaseClient,
  organizationId: string,
  job: { kind?: string; payload?: Record<string, unknown>; channelKind?: string; orderId?: string | null }
) {
  const payload = asRecord(job.payload);
  const data = flattenInboundPayload(asRecord(payload.data), payload);
  const event = firstString(payload.event).toLowerCase();
  if (event.includes("status")) {
    await applyDeliveryStatus(supabase, organizationId, data);
    return { ingested: true, kind: "status" as const };
  }
  return ingestInbound(supabase, organizationId, data, payload, job.channelKind, job.orderId);
}

async function ingestInbound(
  supabase: SupabaseClient,
  organizationId: string,
  data: Record<string, unknown>,
  envelope: Record<string, unknown>,
  channelKind?: string,
  verifiedOrderId?: string | null
) {
  const parsed = parseInboundMessage(data);
  const phone = extractIndiaMobileDigits(parsed.from);
  if (!phone) return { ingested: false as const, reason: "no_phone" };
  const settings = await loadSupportSettings(supabase, organizationId);
  const kind = isSupportWhatsAppMode(channelKind)
    ? channelKind
    : isSupportWhatsAppMode(settings.mode)
      ? settings.mode
      : "postbus_global";
  const channelId = await ensureSupportChannel(
    supabase,
    organizationId,
    kind,
    kind === "merchant_vachat" ? settings.vachatConnectionId : null
  );
  const conversation = await upsertConversation(supabase, {
    organizationId,
    channelId,
    phoneDigits: phone,
    providerConversationId: parsed.conversationId || null,
  });
  const providerMessageId =
    firstString(data.message_id, data.whatsapp_message_id, envelope.id, parsed.conversationId + parsed.text) ||
    crypto.randomUUID();
  const providerTimestamp = firstString(data.timestamp, data.created_at) || new Date().toISOString();
  const iso =
    /^\d+$/.test(providerTimestamp) && providerTimestamp.length <= 13
      ? new Date(Number(providerTimestamp) * (providerTimestamp.length <= 10 ? 1000 : 1)).toISOString()
      : providerTimestamp;
  const { data: inserted, error } = await supabase
    .from("support_messages")
    .insert({
      organization_id: organizationId,
      conversation_id: conversation.id,
      direction: "inbound",
      body: parsed.text || null,
      content_type: firstString(data.content_type) || "text",
      status: "received",
      provider_message_id: providerMessageId,
      whatsapp_message_id: firstString(data.whatsapp_message_id) || null,
      provider_timestamp: iso,
    })
    .select("id")
    .maybeSingle();
  if (error?.code === "23505") return { ingested: true as const, duplicate: true };
  if (error) {
    logError("support.ingest.insert_failed", { organizationId, message: error.message });
    throw error;
  }
  let orderId = verifiedOrderId || null;
  if (!orderId && kind === "merchant_vachat") {
    const { orderTokensFromText, resolveInOrgOrderFromText } = await import("@/modules/support/identify");
    const resolved = await resolveInOrgOrderFromText(
      supabase,
      organizationId,
      phone,
      parsed.text,
      orderTokensFromText(parsed.text)
    );
    if (resolved.state === "VERIFIED") orderId = resolved.orderId;
  }
  const ticket = await attachOrCreateTicket(supabase, {
    organizationId,
    conversationId: conversation.id,
    text: parsed.text,
    orderId,
  });
  if (inserted?.id) {
    await supabase.from("support_messages").update({ ticket_id: ticket.ticket.id }).eq("id", inserted.id);
    const contentType = firstString(data.content_type).toLowerCase();
    const mediaId = firstString(data.media_id, data.image_id, asRecord(data.image).id);
    const sourceUrl = firstString(data.media_url, data.image_url, asRecord(data.image).url);
    if (mediaId || sourceUrl || contentType.includes("image") || contentType.includes("video") || contentType.includes("document")) {
      await supabase.from("support_message_attachments").insert({
        organization_id: organizationId,
        message_id: inserted.id,
        provider_media_id: mediaId || null,
        source_url: sourceUrl || null,
        mime_type: contentType || null,
      });
    }
  }
  const preview = (parsed.text || contentPreview(data)).slice(0, 180);
  const conversationPatch: Record<string, unknown> = {
    last_message_preview: preview,
    last_message_at: iso,
    unread_count: Number(conversation.unread_count || 0) + 1,
  };
  if (shouldAdvanceCustomerTimestamp(conversation.last_customer_message_at, iso)) {
    conversationPatch.last_customer_message_at = iso;
    conversationPatch.service_window_expires_at = serviceWindowExpiresAt(iso)?.toISOString() ?? null;
  }
  await supabase.from("support_conversations").update(conversationPatch).eq("id", conversation.id);
  await supabase.from("notifications").insert({
    organization_id: organizationId,
    type: "support.message_received",
    title: "New customer message",
    body: preview,
    entity_type: "support_conversation",
    entity_id: conversation.id,
  });
  return { ingested: true as const, duplicate: false, ticketId: ticket.ticket.id };
}

function contentPreview(data: Record<string, unknown>) {
  const type = firstString(data.content_type).toLowerCase();
  if (type.includes("image")) return "Photo";
  if (type.includes("video")) return "Video";
  if (type.includes("document")) return "Document";
  return "Message";
}

async function applyDeliveryStatus(
  supabase: SupabaseClient,
  organizationId: string,
  data: Record<string, unknown>
) {
  const providerMessageId = firstString(data.message_id, data.whatsapp_message_id);
  const next = firstString(data.status).toLowerCase() || "sent";
  if (!providerMessageId) return;
  const { data: row } = await supabase
    .from("support_messages")
    .select("id, status")
    .eq("organization_id", organizationId)
    .eq("provider_message_id", providerMessageId)
    .maybeSingle();
  if (!row) return;
  if (!shouldApplyMessageStatus(row.status, next)) return;
  await supabase.from("support_messages").update({ status: next }).eq("id", row.id);
}

export async function processSupportIngestJob(
  supabase: SupabaseClient,
  organizationId: string,
  progress: Record<string, unknown>
) {
  return ingestSupportEvent(supabase, organizationId, {
    kind: String(progress.kind || "inbound"),
    payload: asRecord(progress.payload),
    channelKind: String(progress.channelKind || ""),
    orderId: typeof progress.orderId === "string" ? progress.orderId : null,
  });
}
