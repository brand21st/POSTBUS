import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { decryptSecret, encryptSecret, maskSecret } from "@/lib/security/crypto";
import {
  WATI_DEFAULT_BASE_URL,
  WatiClient,
  normalizeWatiBaseUrl,
  normalizeWatiClientId,
  isWatiWhatsappChannel,
  pickWhatsappChannel,
  watiChannelPhone,
  watiClientFromRow,
  watiPhoneNumber,
  type WatiChannel,
  type WatiTemplate,
} from "@/modules/wati/client";
import { isApprovedWatiUtilityTemplate } from "@/modules/wati/notify";
import { canRegisterWatiWebhook, watiWebhookUrl } from "@/modules/wati/webhook-urls";
import type { WatiConfig } from "@/types/api";

export type WatiConnectionRow = {
  id?: string;
  organization_id: string;
  encrypted_api_token?: string | null;
  api_base_url?: string | null;
  client_id?: string | null;
  channel_id?: string | null;
  channel_name?: string | null;
  channel_phone?: string | null;
  order_confirmation_template_name?: string | null;
  processing_template_name?: string | null;
  booked_template_name?: string | null;
  in_transit_template_name?: string | null;
  delivered_template_name?: string | null;
  status?: string | null;
  last_verified_at?: string | null;
  last_error?: string | null;
  webhook_id?: string | null;
  last_webhook_at?: string | null;
  last_webhook_event?: string | null;
  last_webhook_error?: string | null;
};

export function mapWatiConfig(row: WatiConnectionRow | null): WatiConfig {
  return {
    status: row?.status ?? "NOT_CONNECTED",
    apiBaseUrl: row?.api_base_url ?? WATI_DEFAULT_BASE_URL,
    api_base_url: row?.api_base_url ?? WATI_DEFAULT_BASE_URL,
    clientId: row?.client_id ?? null,
    client_id: row?.client_id ?? null,
    tokenMasked: row?.encrypted_api_token ? maskSecret("wati-token") : "",
    token_masked: row?.encrypted_api_token ? maskSecret("wati-token") : "",
    hasToken: Boolean(row?.encrypted_api_token),
    has_token: Boolean(row?.encrypted_api_token),
    channelId: row?.channel_id ?? null,
    channel_id: row?.channel_id ?? null,
    channelName: row?.channel_name ?? null,
    channel_name: row?.channel_name ?? null,
    channelPhone: row?.channel_phone ?? null,
    channel_phone: row?.channel_phone ?? null,
    orderConfirmationTemplateName: row?.order_confirmation_template_name ?? null,
    order_confirmation_template_name: row?.order_confirmation_template_name ?? null,
    processingTemplateName: row?.processing_template_name ?? null,
    processing_template_name: row?.processing_template_name ?? null,
    bookedTemplateName: row?.booked_template_name ?? null,
    booked_template_name: row?.booked_template_name ?? null,
    inTransitTemplateName: row?.in_transit_template_name ?? null,
    in_transit_template_name: row?.in_transit_template_name ?? null,
    deliveredTemplateName: row?.delivered_template_name ?? null,
    delivered_template_name: row?.delivered_template_name ?? null,
    lastVerifiedAt: row?.last_verified_at ?? null,
    last_verified_at: row?.last_verified_at ?? null,
    lastError: row?.last_error ?? null,
    last_error: row?.last_error ?? null,
    webhookId: row?.webhook_id ?? null,
    webhook_id: row?.webhook_id ?? null,
    webhookUrl: row?.id ? watiWebhookUrl(row.id) : null,
    webhook_url: row?.id ? watiWebhookUrl(row.id) : null,
    lastWebhookAt: row?.last_webhook_at ?? null,
    last_webhook_at: row?.last_webhook_at ?? null,
    lastWebhookEvent: row?.last_webhook_event ?? null,
    last_webhook_event: row?.last_webhook_event ?? null,
    lastWebhookError: row?.last_webhook_error ?? null,
    last_webhook_error: row?.last_webhook_error ?? null,
    canRegisterWebhook: canRegisterWatiWebhook(),
    can_register_webhook: canRegisterWatiWebhook(),
  };
}

export async function verifyWatiToken(token: string, baseUrl?: string | null) {
  const client = new WatiClient(token, normalizeWatiBaseUrl(baseUrl));
  const result = await client.listChannels(1, 50);
  const channel = pickWhatsappChannel(result.channels);
  return { channels: result.channels ?? [], channel };
}

function templateLanguage(template: WatiTemplate) {
  const option = (template as WatiTemplate & { language_option?: { value?: string | null; text?: string | null } })
    .language_option;
  return option?.value ?? option?.text ?? null;
}

function templateParamNames(template: WatiTemplate) {
  const names = template.custom_params ?? template.customParams ?? [];
  return names
    .map((param) => ({ name: param.name?.trim() || null }))
    .filter((param) => param.name);
}

export async function listWatiChannels(row: WatiConnectionRow | null) {
  const client = watiClientFromRow(row);
  const result = await client.listChannels(1, 100);
  return (result.channels ?? []).filter((channel) => isWatiWhatsappChannel(channel));
}

function selectedWatiChannel(
  channels: WatiChannel[],
  preferred: string | null | undefined,
  provided: boolean,
  existing?: WatiConnectionRow | null
) {
  const detected = watiChannelPhone(pickWhatsappChannel(channels));
  const phone = provided
    ? watiPhoneNumber(preferred) || detected || null
    : watiPhoneNumber(existing?.channel_phone) || detected || null;
  const channel = pickWhatsappChannel(channels, phone);
  const fallback = channels.find((item) => isWatiWhatsappChannel(item));
  const sameExisting = Boolean(phone) && watiPhoneNumber(existing?.channel_phone) === phone;
  return {
    channel_id: channel?.id ?? (sameExisting ? existing?.channel_id ?? null : fallback?.id ?? null),
    channel_name: channel?.name ?? fallback?.name ?? (phone ? "WhatsApp" : null),
    channel_phone: phone,
  };
}

export async function listWatiTemplates(row: WatiConnectionRow | null) {
  const client = watiClientFromRow(row);
  const channel = row?.channel_id ? watiPhoneNumber(row.channel_phone) ?? undefined : undefined;
  const result = await client.listTemplates(1, 100, channel);
  return (result.templates ?? [])
    .filter(
      (template) =>
        isApprovedWatiUtilityTemplate(template.status, template.category) && template.name?.trim()
    )
    .map((template) => ({
      id: template.id ?? null,
      name: template.name ?? "",
      status: template.status ?? null,
      category: template.category ?? null,
      language: template.language ?? templateLanguage(template),
      body: template.body ?? null,
      customParams: templateParamNames(template),
    })) satisfies WatiTemplate[];
}

export async function saveWatiConnection(
  supabase: SupabaseClient,
  organizationId: string,
  input: {
    apiToken?: string;
    apiBaseUrl?: string;
    clientId?: string | null;
    channelPhone?: string | null;
    orderConfirmationTemplateName?: string | null;
    processingTemplateName?: string | null;
    bookedTemplateName?: string | null;
    inTransitTemplateName?: string | null;
    deliveredTemplateName?: string | null;
  }
) {
  const { data: existing } = await supabase
    .from("wati_connections")
    .select("*")
    .eq("organization_id", organizationId)
    .maybeSingle();

  const token = input.apiToken?.trim();
  if (!existing?.encrypted_api_token && !token) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Paste your Wati API token.");
  }

  const payload: Record<string, unknown> = {
    organization_id: organizationId,
    api_base_url: normalizeWatiBaseUrl(input.apiBaseUrl ?? existing?.api_base_url),
    client_id:
      normalizeWatiClientId(input.clientId) ||
      normalizeWatiClientId(input.apiBaseUrl) ||
      (input.clientId === undefined ? existing?.client_id ?? null : null),
    order_confirmation_template_name:
      input.orderConfirmationTemplateName ?? existing?.order_confirmation_template_name ?? null,
    processing_template_name: input.processingTemplateName ?? existing?.processing_template_name ?? null,
    booked_template_name: input.bookedTemplateName ?? existing?.booked_template_name ?? null,
    in_transit_template_name: input.inTransitTemplateName ?? existing?.in_transit_template_name ?? null,
    delivered_template_name: input.deliveredTemplateName ?? existing?.delivered_template_name ?? null,
    status: "PENDING",
    last_error: null,
  };
  if (token) payload.encrypted_api_token = encryptSecret(token);

  const query = existing
    ? supabase.from("wati_connections").update(payload).eq("id", existing.id)
    : supabase.from("wati_connections").insert(payload);
  const { data, error } = await query.select().single();
  if (error || !data) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, error?.message || "Could not save Wati.");
  }

  try {
    const verified = await verifyWatiToken(
      token || decryptWatiToken(data as WatiConnectionRow),
      data.api_base_url
    );
    const channel = selectedWatiChannel(
      verified.channels,
      input.channelPhone,
      input.channelPhone !== undefined,
      existing as WatiConnectionRow | null
    );
    const { data: connected, error: connectError } = await supabase
      .from("wati_connections")
      .update({
        status: "CONNECTED",
        last_verified_at: new Date().toISOString(),
        last_error: null,
        ...channel,
      })
      .eq("id", data.id)
      .select()
      .single();
    if (connectError) throw new AppError(ERROR_CODES.VALIDATION_ERROR, connectError.message);
    const connectedRow = connected as WatiConnectionRow;
    return { row: await registerWatiWebhookQuietly(supabase, connectedRow), channels: verified.channels };
  } catch (error) {
    const raw = error instanceof Error ? error.message : "Wati verification failed.";
    const message = /unable to authenticate data|unsupported state/i.test(raw)
      ? "The saved Wati token could not be read. Click Replace and paste the API token again."
      : raw;
    await supabase
      .from("wati_connections")
      .update({ status: "PENDING", last_error: message })
      .eq("id", data.id);
    throw error instanceof AppError
      ? error
      : new AppError(ERROR_CODES.INTEGRATION_NOT_CONNECTED, message);
  }
}

function decryptWatiToken(row: WatiConnectionRow) {
  if (!row.encrypted_api_token) {
    throw new AppError(ERROR_CODES.INTEGRATION_NOT_CONNECTED, "Wati is not connected.");
  }
  return decryptSecret(row.encrypted_api_token);
}

export async function reconnectWati(supabase: SupabaseClient, row: WatiConnectionRow) {
  const verified = await verifyWatiToken(decryptWatiToken(row), row.api_base_url);
  const channel = selectedWatiChannel(verified.channels, row.channel_phone, false, row);
  const { data, error } = await supabase
    .from("wati_connections")
    .update({
      status: "CONNECTED",
      last_verified_at: new Date().toISOString(),
      last_error: null,
      ...channel,
    })
    .eq("organization_id", row.organization_id)
    .select()
    .single();
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  const connectedRow = data as WatiConnectionRow;
  return { row: await registerWatiWebhookQuietly(supabase, connectedRow), channels: verified.channels as WatiChannel[] };
}

export async function registerWatiWebhook(supabase: SupabaseClient, row: WatiConnectionRow) {
  const { ensureWatiWebhook } = await import("@/modules/wati/register-webhook");
  const result = await ensureWatiWebhook(supabase, row);
  if (!result.registered) {
    const message =
      result.reason === "local_host"
        ? "Webhook URL is ready. Register it after this app is on a public HTTPS host, or paste the URL in Wati."
        : result.reason === "missing_client_id"
          ? "Add Client ID to register the Wati webhook automatically."
          : result.reason === "missing_phone"
            ? "Choose the WhatsApp number before registering the webhook."
            : result.error ?? "Could not register the Wati webhook.";
    throw new AppError(
      result.reason === "local_host" || result.reason === "missing_client_id" || result.reason === "missing_phone"
        ? ERROR_CODES.VALIDATION_ERROR
        : ERROR_CODES.PROVIDER_ERROR,
      message
    );
  }
  return refreshWatiRow(supabase, row.id!, row);
}

async function registerWatiWebhookQuietly(supabase: SupabaseClient, row: WatiConnectionRow) {
  try {
    const { ensureWatiWebhook } = await import("@/modules/wati/register-webhook");
    await ensureWatiWebhook(supabase, row);
  } catch {
    // Connect still succeeds if Wati webhook registration is delayed.
  }
  return refreshWatiRow(supabase, row.id, row);
}

async function refreshWatiRow(supabase: SupabaseClient, id: string | undefined, fallback: WatiConnectionRow) {
  if (!id) return fallback;
  const { data } = await supabase.from("wati_connections").select("*").eq("id", id).maybeSingle();
  return (data ?? fallback) as WatiConnectionRow;
}
