import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { logError, logInfo } from "@/lib/logger";
import { decryptSecret, hashSecret } from "@/lib/security/crypto";
import { verifyVachatSignature } from "@/modules/vachat/signature";
import {
  getPlatformVachatConfig,
  isPlatformVachatActive,
} from "@/modules/vachat/platform-config";

export function vachatWebhookNotification(status: string) {
  const key = status.toLowerCase();
  if (key === "failed") return { type: "vachat.message_failed", title: "Vachat message failed" };
  if (key === "delivered") return { type: "vachat.message_delivered", title: "WhatsApp delivered" };
  if (key === "read") return { type: "vachat.message_read", title: "WhatsApp read" };
  if (key === "sent") return { type: "vachat.message_sent", title: "WhatsApp message sent" };
  return { type: "vachat.event", title: "Vachat webhook" };
}

type ConnectionMatch = {
  id: string;
  organization_id: string;
};

function parseEnvelope(rawBody: string) {
  let body: {
    id?: string;
    event?: string;
    data?: {
      status?: string;
      external_ref?: string;
      notification_type?: string;
      merchant_id?: string;
      message_id?: string;
      whatsapp_message_id?: string;
      from?: string;
      wa_id?: string;
      phone?: string;
      text?: string;
      body?: string;
      message?: unknown;
    };
  } = {};
  try {
    body = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    body = {};
  }
  return body;
}

async function recordAccepted(
  supabase: SupabaseClient,
  matched: ConnectionMatch,
  input: { rawBody: string },
  body: ReturnType<typeof parseEnvelope>
) {
  const envelopeId = String(body.id ?? "").trim();
  if (!envelopeId) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Webhook envelope id is required.");
  }

  const idempotencyKey = `vachat:${matched.id}:${envelopeId}`;
  const { data: existing } = await supabase
    .from("idempotency_keys")
    .select("id")
    .eq("organization_id", matched.organization_id)
    .eq("key", idempotencyKey)
    .maybeSingle();
  if (existing) return { accepted: true, duplicate: true };

  const { error: idempotencyError } = await supabase.from("idempotency_keys").insert({
    organization_id: matched.organization_id,
    key: idempotencyKey,
    request_hash: hashSecret(input.rawBody || envelopeId),
  });
  if (idempotencyError?.code === "23505") return { accepted: true, duplicate: true };

  const status = String(body.data?.status ?? "sent");
  const notice = vachatWebhookNotification(status);
  await supabase.from("notifications").insert({
    organization_id: matched.organization_id,
    type: notice.type,
    title: notice.title,
    body: [body.data?.external_ref, body.data?.notification_type, status]
      .filter(Boolean)
      .join(" · ")
      .slice(0, 240),
    entity_type: "vachat_connection",
    entity_id: matched.id,
  });

  if (matched.id !== "platform") {
    await supabase
      .from("vachat_connections")
      .update({
        last_webhook_at: new Date().toISOString(),
        last_webhook_event: body.event ?? "message.status_updated",
        last_webhook_error: status === "failed" ? "Message failed" : null,
      })
      .eq("id", matched.id);
  }

  logInfo("vachat.webhook.accepted", {
    connectionId: matched.id,
    organizationId: matched.organization_id,
    status,
  });

  const externalRef = String(body.data?.external_ref ?? "").trim();
  if (externalRef) {
    const { updateVachatNotificationLogStatus } = await import("@/modules/vachat/logs");
    await updateVachatNotificationLogStatus(supabase, {
      organizationId: matched.organization_id,
      externalRef,
      status,
      vachatMessageId: body.data?.message_id ?? null,
      whatsappMessageId: body.data?.whatsapp_message_id ?? null,
      error: status === "failed" ? "Message failed" : null,
    });
  }

  const providerMessageId = String(body.data?.message_id ?? body.data?.whatsapp_message_id ?? "").trim();
  if (providerMessageId) {
    const { ingestSupportEvent } = await import("@/modules/support/ingest");
    await ingestSupportEvent(supabase, matched.organization_id, {
      kind: "status",
      payload: { event: "message.status_updated", ...((body as { data?: Record<string, unknown> }).data ?? {}), data: body.data },
    }).catch(() => undefined);
  }

  return { accepted: true, duplicate: false };
}

export function inboundWebhookEnvelopeId(
  body: ReturnType<typeof parseEnvelope>,
  rawBody: string
) {
  const fromBody = String(body.id ?? "").trim();
  if (fromBody) return fromBody;
  const data = body.data ?? {};
  const fromMessage = String(data.whatsapp_message_id ?? data.message_id ?? "").trim();
  if (fromMessage) return fromMessage;
  return `body:${hashSecret(rawBody || "empty")}`;
}

export async function claimVachatInboundEnvelope(
  supabase: SupabaseClient,
  envelopeId: string,
  requestHash: string
) {
  const { data: existing } = await supabase
    .from("vachat_webhook_envelopes")
    .select("envelope_id")
    .eq("envelope_id", envelopeId)
    .maybeSingle();
  if (existing) return { duplicate: true as const };

  const { error } = await supabase.from("vachat_webhook_envelopes").insert({
    envelope_id: envelopeId,
    request_hash: requestHash,
  });
  if (error?.code === "23505") return { duplicate: true as const };
  if (error) {
    logError("vachat.webhook.envelope_failed", { envelopeId, message: error.message });
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  }
  return { duplicate: false as const };
}

async function matchMerchantVachatWebhook(
  supabase: SupabaseClient,
  signatureHeader: string,
  rawBody: string
) {
  const { data: connections, error } = await supabase
    .from("vachat_connections")
    .select("id, organization_id, webhook_secret_encrypted, status")
    .not("webhook_secret_encrypted", "is", null);
  if (error) {
    logError("vachat.webhook.lookup_failed", { message: error.message });
  }
  for (const row of connections ?? []) {
    try {
      const secret = decryptSecret(row.webhook_secret_encrypted as string);
      if (verifyVachatSignature(signatureHeader, rawBody, secret)) return row;
    } catch {
      // try next org
    }
  }
  return null;
}

async function runPlatformAssistant(
  supabase: SupabaseClient,
  inbound: { from: string; text: string }
) {
  const { handleVachatAssistantMessage } = await import("@/modules/vachat/assistant");
  const result = await handleVachatAssistantMessage(supabase, {
    from: inbound.from,
    text: inbound.text,
    skipSend: true,
  });
  const reply = String(result.reply ?? "").trim();
  const organizationId = String(result.organizationId || "");
  if (reply && inbound.from) {
    if (organizationId) {
      const { enqueueVachatSessionText } = await import("@/modules/vachat/send");
      try {
        await enqueueVachatSessionText(supabase, organizationId, {
          to: inbound.from,
          text: reply,
          orderId: result.orderId ?? undefined,
        });
      } catch (error) {
        logError("vachat.webhook.reply_enqueue_failed", {
          organizationId,
          message: error instanceof Error ? error.message : "enqueue failed",
        });
      }
    } else {
      logError("vachat.webhook.reply_missing_org", { hasReply: true });
    }
  }
  return { accepted: true, duplicate: false, assistant: true as const };
}

export async function acceptVachatWebhook(
  supabase: SupabaseClient,
  input: { rawBody: string; signatureHeader: string | null }
) {
  if (!input.signatureHeader) {
    throw new AppError(ERROR_CODES.FORBIDDEN, "Invalid Vachat webhook signature.");
  }

  const platform = await getPlatformVachatConfig();
  const platformSigned =
    isPlatformVachatActive(platform) &&
    Boolean(platform.webhookSecret) &&
    verifyVachatSignature(input.signatureHeader, input.rawBody, platform.webhookSecret);

  if (isPlatformVachatActive(platform) && platformSigned) {
    const body = parseEnvelope(input.rawBody);
    const { isInboundAssistantEvent, resolveInboundSender } = await import("@/modules/vachat/assistant");
    const envelope = body as unknown as Record<string, unknown>;
    const payload = {
      ...(typeof envelope === "object" ? envelope : {}),
      ...((body.data as Record<string, unknown> | undefined) ?? {}),
    };
    if (isInboundAssistantEvent(body.event ?? "", payload)) {
      const envelopeId = inboundWebhookEnvelopeId(body, input.rawBody);
      const claimed = await claimVachatInboundEnvelope(supabase, envelopeId, hashSecret(input.rawBody || envelopeId));
      if (claimed.duplicate) {
        return { accepted: true, duplicate: true, assistant: true };
      }
      const inbound = await resolveInboundSender(payload, envelope);
      logInfo("vachat.webhook.inbound", {
        event: body.event ?? "",
        hasFrom: Boolean(inbound.from),
        hasText: Boolean(inbound.text),
        hasContact: Boolean(inbound.contactId),
      });
      const { identifyGlobalInbound, quarantineInbound } = await import("@/modules/support/identify");
      const identified = await identifyGlobalInbound(supabase, {
        phone: inbound.from,
        text: inbound.text,
        buttonId: inbound.text,
      });
      if (identified.kind === "assigned") {
        const { maybeRouteInboundToSupport } = await import("@/modules/support/ingest");
        const routed = await maybeRouteInboundToSupport(
          supabase,
          identified.organizationId,
          payload,
          input.rawBody,
          "postbus_global",
          identified.orderId
        );
        return { accepted: true, duplicate: false, support: routed.routed };
      }
      await quarantineInbound(supabase, {
        phone: inbound.from,
        text: inbound.text,
        conversationId: inbound.conversationId,
        providerMessageId: String(payload.message_id ?? payload.whatsapp_message_id ?? envelope.id ?? ""),
        state: identified.state,
        evidence: identified.evidence,
      });
      return runPlatformAssistant(supabase, inbound);
    }
    const merchantId = String(body.data?.merchant_id ?? "").trim();
    if (!merchantId) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, "merchant_id is required for global VaChat webhooks.");
    }
    const { data: org } = await supabase.from("organizations").select("id").eq("id", merchantId).maybeSingle();
    if (!org?.id) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Unknown PostBus merchant for VaChat webhook.");
    }
    return recordAccepted(supabase, { id: "platform", organization_id: org.id }, input, body);
  }

  const matched = await matchMerchantVachatWebhook(supabase, input.signatureHeader, input.rawBody);
  if (!matched) {
    throw new AppError(ERROR_CODES.FORBIDDEN, "Invalid Vachat webhook signature.");
  }

  const merchantBody = parseEnvelope(input.rawBody);
  const merchantPayload = {
    ...(merchantBody as unknown as Record<string, unknown>),
    ...((merchantBody.data as Record<string, unknown> | undefined) ?? {}),
  };
  const { isInboundAssistantEvent: isInbound } = await import("@/modules/vachat/inbound");
  if (isInbound(merchantBody.event ?? "", merchantPayload)) {
    const { maybeRouteInboundToSupport } = await import("@/modules/support/ingest");
    const routed = await maybeRouteInboundToSupport(
      supabase,
      matched.organization_id,
      merchantPayload,
      input.rawBody,
      "merchant_vachat"
    );
    if (routed.routed) {
      return { accepted: true, duplicate: false, support: true };
    }
  }
  return recordAccepted(
    supabase,
    { id: matched.id, organization_id: matched.organization_id },
    input,
    merchantBody
  );
}
