import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { toIndiaWhatsappE164 } from "@/lib/phone/india-whatsapp";
import { createBackgroundJob } from "@/modules/jobs/service";
import { vachatHeaders } from "@/modules/vachat/service";
import { approvedVachatTemplates } from "@/modules/vachat/templates";
import { resolveSupportProvider } from "@/modules/support/provider";
import { logError } from "@/lib/logger";
import { getConversation } from "@/modules/support/conversations";
import { attachOrCreateTicket } from "@/modules/support/tickets";
import { isServiceWindowOpen } from "@/modules/support/window";
import { mapMessage } from "@/modules/support/map";

async function supportCredentials(supabase: SupabaseClient, organizationId: string) {
  return resolveSupportProvider(supabase, organizationId);
}

export async function sendSupportText(
  supabase: SupabaseClient,
  input: {
    organizationId: string;
    conversationId: string;
    actorId: string;
    clientSendId: string;
    text: string;
  }
) {
  const conversation = await getConversation(supabase, input.organizationId, input.conversationId);
  if (!isServiceWindowOpen(conversation.service_window_expires_at)) {
    throw new AppError(
      ERROR_CODES.CONFLICT,
      "The customer service window is closed. Send an approved WhatsApp template."
    );
  }
  const { data: existing } = await supabase
    .from("support_messages")
    .select("id, conversation_id, ticket_id, direction, body, content_type, status, provider_timestamp, created_at, client_send_id")
    .eq("organization_id", input.organizationId)
    .eq("client_send_id", input.clientSendId)
    .maybeSingle();
  if (existing) return mapMessage(existing);

  const ticket = await attachOrCreateTicket(supabase, {
    organizationId: input.organizationId,
    conversationId: conversation.id,
    text: input.text,
  });
  const { data, error } = await supabase
    .from("support_messages")
    .insert({
      organization_id: input.organizationId,
      conversation_id: conversation.id,
      ticket_id: ticket.ticket.id,
      direction: "outbound",
      body: input.text,
      content_type: "text",
      status: "queued",
      client_send_id: input.clientSendId,
      provider_timestamp: new Date().toISOString(),
    })
    .select("id, conversation_id, ticket_id, direction, body, content_type, status, provider_timestamp, created_at, client_send_id")
    .single();
  if (error?.code === "23505") {
    const { data: raced } = await supabase
      .from("support_messages")
      .select("id, conversation_id, ticket_id, direction, body, content_type, status, provider_timestamp, created_at, client_send_id")
      .eq("organization_id", input.organizationId)
      .eq("client_send_id", input.clientSendId)
      .maybeSingle();
    if (raced) return mapMessage(raced);
  }
  if (error || !data) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error?.message || "Could not queue message.");
  await supabase
    .from("support_conversations")
    .update({
      last_message_preview: input.text.slice(0, 180),
      last_message_at: new Date().toISOString(),
    })
    .eq("id", conversation.id);
  await createBackgroundJob(supabase, {
    organizationId: input.organizationId,
    jobType: "vachat-notify",
    entityType: "support_message",
    entityId: data.id,
    userId: input.actorId,
    progress: {
      kind: "session_text",
      source: "support",
      supportMessageId: data.id,
      to: conversation.phone_digits,
      text: input.text,
    },
  });
  return mapMessage(data);
}

export async function sendSupportTemplate(
  supabase: SupabaseClient,
  input: {
    organizationId: string;
    conversationId: string;
    actorId: string;
    clientSendId: string;
    templateName: string;
    language?: string;
    variables?: string[];
  }
) {
  const conversation = await getConversation(supabase, input.organizationId, input.conversationId);
  const creds = await supportCredentials(supabase, input.organizationId);
  const catalogRes = await fetch(`${creds.apiBaseUrl.replace(/\/$/, "")}/api/postbus/templates`, {
    headers: vachatHeaders(creds.apiKey),
    signal: AbortSignal.timeout(15000),
  });
  const catalog = catalogRes.ok ? approvedVachatTemplates(await catalogRes.json().catch(() => null)) : [];
  const approved = catalog.find((row) => row.name === input.templateName);
  if (!approved) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "That template is not approved on this WhatsApp account.");
  }
  const { data: existing } = await supabase
    .from("support_messages")
    .select("id, conversation_id, ticket_id, direction, body, content_type, status, provider_timestamp, created_at, client_send_id")
    .eq("organization_id", input.organizationId)
    .eq("client_send_id", input.clientSendId)
    .maybeSingle();
  if (existing) return mapMessage(existing);
  const ticket = await attachOrCreateTicket(supabase, {
    organizationId: input.organizationId,
    conversationId: conversation.id,
  });
  const preview = `Template: ${input.templateName}`;
  const { data, error } = await supabase
    .from("support_messages")
    .insert({
      organization_id: input.organizationId,
      conversation_id: conversation.id,
      ticket_id: ticket.ticket.id,
      direction: "outbound",
      body: preview,
      content_type: "template",
      status: "queued",
      client_send_id: input.clientSendId,
      provider_timestamp: new Date().toISOString(),
    })
    .select("id, conversation_id, ticket_id, direction, body, content_type, status, provider_timestamp, created_at, client_send_id")
    .single();
  if (error || !data) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error?.message || "Could not queue template.");
  await createBackgroundJob(supabase, {
    organizationId: input.organizationId,
    jobType: "vachat-notify",
    entityType: "support_message",
    entityId: data.id,
    userId: input.actorId,
    progress: {
      kind: "support_template",
      source: "support",
      supportMessageId: data.id,
      to: conversation.phone_digits,
      templateName: approved.name,
      language: input.language || approved.language,
      variables: input.variables ?? [],
    },
  });
  return mapMessage(data);
}

export async function listApprovedSupportTemplates(supabase: SupabaseClient, organizationId: string) {
  const creds = await supportCredentials(supabase, organizationId);
  const res = await fetch(`${creds.apiBaseUrl.replace(/\/$/, "")}/api/postbus/templates`, {
    headers: vachatHeaders(creds.apiKey),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) return [];
  return approvedVachatTemplates(await res.json().catch(() => null));
}

export async function deliverQueuedSupportMessage(
  supabase: SupabaseClient,
  organizationId: string,
  progress: {
    kind?: string;
    supportMessageId?: string;
    to?: string;
    text?: string;
    templateName?: string;
    language?: string;
    variables?: string[];
  }
) {
  const creds = await supportCredentials(supabase, organizationId);
  const recipient = toIndiaWhatsappE164(String(progress.to ?? ""));
  const merchantId = creds.source === "platform" ? organizationId : undefined;
  const body =
    progress.kind === "support_template"
      ? {
          to: recipient,
          type: "template",
          merchant_id: merchantId,
          template: {
            name: progress.templateName,
            language: progress.language || "en",
            params: { body: progress.variables ?? [] },
          },
        }
      : {
          to: recipient,
          text: String(progress.text ?? "").trim(),
          content_text: String(progress.text ?? "").trim(),
          merchant_id: merchantId,
        };
  const res = await fetch(`${creds.apiBaseUrl.replace(/\/$/, "")}/api/v1/messages`, {
    method: "POST",
    headers: vachatHeaders(creds.apiKey),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  const json = (await res.json().catch(() => null)) as {
    data?: { message_id?: string; whatsapp_message_id?: string };
  } | null;
  const status = res.ok ? "sent" : "failed";
  if (!res.ok) {
    logError("support.send.failed", { organizationId, http: res.status });
  }
  if (progress.supportMessageId) {
    await supabase
      .from("support_messages")
      .update({
        status,
        provider_message_id: json?.data?.message_id ?? null,
        whatsapp_message_id: json?.data?.whatsapp_message_id ?? null,
      })
      .eq("id", progress.supportMessageId)
      .eq("organization_id", organizationId);
  }
  if (!res.ok) {
    throw Object.assign(new Error("Vachat support send failed."), { code: "PROVIDER_ERROR" });
  }
  return { sent: true as const };
}
