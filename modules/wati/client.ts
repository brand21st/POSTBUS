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

export type WatiTemplate = {
  id?: string | null;
  name?: string | null;
  status?: string | null;
  category?: string | null;
  language?: string | null;
  body?: string | null;
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

  listChannels(pageNumber = 1, pageSize = 50) {
    return this.request<{ channels?: WatiChannel[] }>("/api/ext/v3/channels", {
      query: { page_number: pageNumber, page_size: pageSize },
    });
  }

  listTemplates(pageNumber = 1, pageSize = 100, channel?: string) {
    return this.request<{ templates?: WatiTemplate[]; total?: number }>("/api/ext/v3/messageTemplates", {
      query: { page_number: pageNumber, page_size: pageSize, channel },
    });
  }

  sendTemplateMessages(input: {
    template_name: string;
    broadcast_name: string;
    recipients: WatiSendRecipient[];
    channel_number?: string;
  }) {
    return this.request<{ success?: boolean; broadcast_id?: string }>("/api/ext/v3/messageTemplates/send", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  listWebhooks() {
    return this.request<unknown>("/api/ext/v3/webhooks");
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

export function pickWhatsappChannel(channels: WatiChannel[] | null | undefined) {
  const items = channels ?? [];
  return (
    items.find((item) => (item.channel ?? "").toLowerCase() === "whatsapp" && item.enabled !== false) ??
    items.find((item) => (item.channel ?? "").toLowerCase() === "whatsapp") ??
    items[0] ??
    null
  );
}
