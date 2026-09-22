import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { decryptSecret } from "@/lib/security/crypto";
import { extractIndiaMobileDigits } from "@/lib/phone/india-whatsapp";

export const WATI_DEFAULT_BASE_URL = "https://live-mt-server.wati.io";

export type WatiChannel = {
  id?: string | null;
  name?: string | null;
  channel?: string | null;
  platform_id?: string | null;
  enabled?: boolean;
};

export type WatiSendResult = {
  success?: boolean;
  broadcast_id?: string;
  error?: string | null;
  recipients?: Array<{ phone_number?: string | null; errors?: string[] | null }>;
};

export type WatiTemplate = {
  id?: string | null;
  name?: string | null;
  status?: string | null;
  category?: string | null;
  language?: string | null;
  body?: string | null;
  customParams?: Array<{ name?: string | null; value?: string | null }> | null;
  custom_params?: Array<{ name?: string | null; value?: string | null }> | null;
};

export type WatiTemplateParam = { name: string; value: string };

export type WatiSendRecipient = {
  phone_number: string;
  custom_params?: WatiTemplateParam[];
};

export function extractWatiClientId(value?: string | null) {
  const raw = (value ?? "").trim();
  if (!raw) return "";
  const asUrl = /^https?:\/\//i.test(raw) ? raw : raw.includes("/") ? `https://${raw}` : "";
  if (asUrl) {
    try {
      const parsed = new URL(asUrl);
      const segment = parsed.pathname
        .split("/")
        .map((part) => part.trim())
        .find((part) => part && !/^api$/i.test(part));
      if (segment && !/^ext$/i.test(segment) && !/^v\d+$/i.test(segment)) return segment;
    } catch {
      /* fall through to a plain id */
    }
  }
  if (/^[a-zA-Z0-9_-]{2,64}$/.test(raw)) return raw;
  return "";
}

export function normalizeWatiClientId(value?: string | null) {
  return extractWatiClientId(value);
}

export function normalizeWatiBaseUrl(value?: string | null) {
  const fallback = WATI_DEFAULT_BASE_URL;
  let url = (value || fallback).trim();
  if (!url) return fallback;
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  try {
    const parsed = new URL(url);
    parsed.pathname = parsed.pathname.replace(/\/+$/, "");
    parsed.pathname = parsed.pathname.replace(/\/api(\/.*)?$/i, "");
    parsed.pathname = parsed.pathname.replace(/\/\d+$/, "");
    parsed.search = "";
    parsed.hash = "";
    const host = parsed.origin + (parsed.pathname === "/" ? "" : parsed.pathname);
    return host.replace(/\/+$/, "") || fallback;
  } catch {
    return fallback;
  }
}

export function watiPhoneNumber(value?: string | null) {
  const national = value ? extractIndiaMobileDigits(value) : null;
  if (national) return `91${national}`;
  const digits = (value ?? "").replace(/\D/g, "");
  if (digits.length >= 10) return digits;
  return null;
}

export function sameWatiPhone(left?: string | null, right?: string | null) {
  const a = watiPhoneNumber(left);
  const b = watiPhoneNumber(right);
  if (a && b) return a === b;
  const digits = (value?: string | null) => (value ?? "").replace(/\D/g, "");
  const rawLeft = digits(left);
  const rawRight = digits(right);
  return Boolean(rawLeft) && rawLeft === rawRight;
}

function readChannelString(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

export function normalizeWatiChannel(input: unknown): WatiChannel {
  const record = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const platform = readChannelString(record, [
    "platform_id",
    "platformId",
    "phoneNumber",
    "phone_number",
    "phone",
    "whatsappNumber",
    "whatsapp_number",
  ]);
  const phone = platform ? watiPhoneNumber(platform) ?? platform.replace(/\D/g, "") : null;
  return {
    id: readChannelString(record, ["id"]),
    name: readChannelString(record, ["name", "channelName", "channel_name"]),
    channel: readChannelString(record, ["channel", "type", "platform"]) ?? "WhatsApp",
    platform_id: phone || null,
    enabled: record.enabled !== false && record.isEnabled !== false && record.is_enabled !== false,
  };
}

export function readWatiChannels(body: unknown): WatiChannel[] {
  const list = Array.isArray(body)
    ? body
    : body && typeof body === "object"
      ? ((body as { channels?: unknown }).channels ??
        (body as { items?: unknown }).items ??
        (body as { result?: unknown }).result ??
        [])
      : [];
  if (!Array.isArray(list)) return [];
  return list.map((item) => normalizeWatiChannel(item));
}

export function isWatiWhatsappChannel(channel: WatiChannel) {
  const kind = (channel.channel ?? "").toLowerCase().replace(/[\s_-]/g, "");
  if (!kind) return true;
  return kind.includes("whatsapp") || kind === "waba" || kind === "wa";
}

export function watiChannelPhone(channel: WatiChannel | null | undefined) {
  return watiPhoneNumber(channel?.platform_id) ?? null;
}

export function watiSendTemplatePayload(input: {
  template_name: string;
  broadcast_name: string;
  recipients: WatiSendRecipient[];
  channel?: string | null;
}) {
  const channel = input.channel ? watiPhoneNumber(input.channel) ?? undefined : undefined;
  return {
    template_name: input.template_name,
    broadcast_name: input.broadcast_name,
    recipients: input.recipients,
    ...(channel ? { channel } : {}),
  };
}

export function watiSendFailure(result: WatiSendResult) {
  const recipientErrors = (result.recipients ?? []).flatMap((item) => item.errors ?? []).filter(Boolean);
  if (recipientErrors.length) return recipientErrors.join(" ");
  if (result.success === false) return result.error?.trim() || "Wati did not accept the template.";
  if (typeof result.error === "string" && result.error.trim()) return result.error.trim();
  return null;
}

export function watiErrorMessage(status: number, body: unknown, fallback: string) {
  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;
    const nested = record.error;
    if (nested && typeof nested === "object") {
      const message = (nested as { message?: unknown }).message;
      if (typeof message === "string" && message.trim()) return message;
    }
    if (typeof record.message === "string" && record.message.trim()) return record.message;
    if (typeof record.info === "string" && record.info.trim()) return record.info;
  }
  if (status === 401) return "Wati rejected the API token.";
  if (status === 403) return "This Wati token does not have permission for that request.";
  if (status === 429) return "Wati rate-limited the request. Try again shortly.";
  return fallback;
}

export class WatiClient {
  constructor(
    private token: string,
    private baseUrl = WATI_DEFAULT_BASE_URL
  ) {}

  private url(path: string, query?: Record<string, string | number | undefined>) {
    const root = normalizeWatiBaseUrl(this.baseUrl);
    const target = new URL(`${root}${path.startsWith("/") ? path : `/${path}`}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value === undefined || value === "") continue;
      target.searchParams.set(key, String(value));
    }
    return target.toString();
  }

  private async request<T>(path: string, init?: RequestInit & { query?: Record<string, string | number | undefined> }) {
    const response = await fetch(this.url(path, init?.query), {
      ...init,
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new AppError(
        response.status === 401 || response.status === 403
          ? ERROR_CODES.INTEGRATION_NOT_CONNECTED
          : ERROR_CODES.PROVIDER_ERROR,
        watiErrorMessage(response.status, body, "Wati request failed."),
        body
      );
    }
    return body as T;
  }

  async listChannels(pageNumber = 1, pageSize = 50) {
    const body = await this.request<unknown>("/api/ext/v3/channels", {
      query: { page_number: pageNumber, page_size: pageSize },
    });
    return { channels: readWatiChannels(body) };
  }

  listTemplates(pageNumber = 1, pageSize = 100, channel?: string) {
    return this.request<{ templates?: WatiTemplate[]; total?: number }>("/api/ext/v3/messageTemplates", {
      query: { page_number: pageNumber, page_size: pageSize, channel },
    });
  }

  async sendTemplateMessages(input: {
    template_name: string;
    broadcast_name: string;
    recipients: WatiSendRecipient[];
    channel?: string | null;
  }) {
    const result = await this.request<WatiSendResult>("/api/ext/v3/messageTemplates/send", {
      method: "POST",
      body: JSON.stringify(watiSendTemplatePayload(input)),
    });
    const failure = watiSendFailure(result);
    if (failure) {
      throw new AppError(ERROR_CODES.PROVIDER_ERROR, failure, result);
    }
    return result;
  }

  listWebhooks() {
    return this.request<unknown>("/api/ext/v3/webhooks");
  }

  listWebhookEventTypes() {
    return this.request<unknown>("/api/ext/v3/webhooks/event-types");
  }

  updateWebhook(
    id: string,
    input: { url: string; eventTypes: string[]; status?: "Enabled" | "Disabled" }
  ) {
    return this.request<unknown>(`/api/ext/v3/webhooks/${id}`, {
      method: "PUT",
      body: JSON.stringify({
        url: input.url,
        eventTypes: input.eventTypes,
        status: input.status ?? "Enabled",
      }),
    });
  }

  createWebhooksV2(
    tenantId: string,
    hooks: Array<{ url: string; eventTypes: string[]; phoneNumber?: string; status?: number }>
  ) {
    return this.request<unknown>(`/${tenantId}/api/v2/webhookEndpoints`, {
      method: "POST",
      body: JSON.stringify(hooks),
    });
  }
}

export function watiClientFromRow(row: {
  encrypted_api_token?: string | null;
  api_base_url?: string | null;
  status?: string | null;
} | null) {
  if (!row?.encrypted_api_token) {
    throw new AppError(ERROR_CODES.INTEGRATION_NOT_CONNECTED, "Wati is not connected.");
  }
  return new WatiClient(decryptSecret(row.encrypted_api_token), row.api_base_url ?? WATI_DEFAULT_BASE_URL);
}

export function pickWhatsappChannel(channels: WatiChannel[] | null | undefined, preferred?: string | null) {
  const items = (channels ?? []).map((item) => normalizeWatiChannel(item)).filter(isWatiWhatsappChannel);
  const preferredPhone = watiPhoneNumber(preferred);
  if (preferredPhone) {
    return items.find((item) => watiChannelPhone(item) === preferredPhone) ?? null;
  }
  return items.find((item) => item.enabled !== false) ?? items[0] ?? null;
}

export function parseWatiEventTypes(body: unknown) {
  const list = Array.isArray(body)
    ? body
    : body && typeof body === "object"
      ? ((body as { eventTypes?: unknown }).eventTypes ??
        (body as { event_types?: unknown }).event_types ??
        (body as { result?: unknown }).result ??
        (body as { items?: unknown }).items ??
        [])
      : [];
  if (!Array.isArray(list)) return [];
  return list.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim());
}
