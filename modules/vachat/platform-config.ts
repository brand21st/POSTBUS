import { env } from "@/lib/env";
import { logError } from "@/lib/logger";
import { decryptSecret, maskSecret } from "@/lib/security/crypto";
import { createAdminClient, hasAdminClient } from "@/lib/supabase/admin";
import { parseVachatBaseUrl } from "@/modules/vachat/signature";
import { WATI_NOTIFY_EVENTS, type WatiNotifyEvent } from "@/modules/wati/notify";

export const PLATFORM_VACHAT_COLUMNS =
  "vachat_enabled, vachat_api_base_url, encrypted_vachat_api_key, encrypted_vachat_webhook_secret, vachat_webhook_endpoint_id, vachat_last_verified_at, vachat_last_error, vachat_event_settings, vachat_last_test_phone";

export type VachatEventSettings = Record<WatiNotifyEvent, boolean>;

export function defaultVachatEventSettings(): VachatEventSettings {
  return {
    order_confirmation: false,
    processing: false,
    booked: false,
    in_transit: false,
    shipment_delayed: false,
    delivered: false,
  };
}

export function parseVachatEventSettings(raw: unknown): VachatEventSettings {
  const defaults = defaultVachatEventSettings();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return defaults;
  const o = raw as Record<string, unknown>;
  for (const event of WATI_NOTIFY_EVENTS) {
    if (typeof o[event] === "boolean") defaults[event] = o[event];
  }
  return defaults;
}

export type PlatformVachatConfig = {
  flagEnabled: boolean;
  enabled: boolean;
  apiBaseUrl: string;
  apiKey: string;
  webhookSecret: string;
  webhookEndpointId: string | null;
  lastVerifiedAt: string | null;
  lastError: string | null;
  lastTestPhone: string | null;
  eventSettings: VachatEventSettings;
  source: "database" | "env" | "mixed" | "none";
};

type SettingsRow = {
  vachat_enabled?: boolean | null;
  vachat_api_base_url?: string | null;
  encrypted_vachat_api_key?: string | null;
  encrypted_vachat_webhook_secret?: string | null;
  vachat_webhook_endpoint_id?: string | null;
  vachat_last_verified_at?: string | null;
  vachat_last_error?: string | null;
  vachat_event_settings?: unknown;
  vachat_last_test_phone?: string | null;
};

function decryptOptional(payload?: string | null) {
  if (!payload) return "";
  try {
    return decryptSecret(payload);
  } catch (error) {
    logError("vachat.platform.decrypt_failed", {
      message: error instanceof Error ? error.message : "unknown",
    });
    return "";
  }
}

async function loadSettingsRow(): Promise<SettingsRow | null> {
  if (!hasAdminClient()) return null;
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("platform_settings")
    .select(PLATFORM_VACHAT_COLUMNS)
    .eq("id", 1)
    .maybeSingle();
  if (error) {
    logError("vachat.platform.settings_load_failed", { message: error.message });
    const fallback = await supabase.from("platform_settings").select("*").eq("id", 1).maybeSingle();
    if (fallback.error || !fallback.data) return null;
    return fallback.data as SettingsRow;
  }
  return data;
}

export function vachatStatusWebhookUrl() {
  return `${env.appUrl.replace(/\/$/, "")}/api/v1/integrations/vachat/webhooks`;
}

export function vachatMcpUrl() {
  return `${env.appUrl.replace(/\/$/, "")}/api/v1/vachat/mcp`;
}

export async function getPlatformVachatConfig(): Promise<PlatformVachatConfig> {
  const row = await loadSettingsRow();
  const dbKey = decryptOptional(row?.encrypted_vachat_api_key);
  const dbSecret = decryptOptional(row?.encrypted_vachat_webhook_secret);
  const dbUrl = row?.vachat_api_base_url?.trim() || "";
  const envKey = env.vachatApiKey;
  const envUrl = env.vachatApiBaseUrl;
  const envSecret = env.vachatWebhookSecret;
  const apiKey = (dbKey || envKey).trim();
  const webhookSecret = (dbSecret || envSecret).trim();
  let apiBaseUrl = "https://cloud.vachat.in";
  try {
    apiBaseUrl = parseVachatBaseUrl(dbUrl || envUrl || apiBaseUrl);
  } catch {
    apiBaseUrl = "https://cloud.vachat.in";
  }
  const hasDb = Boolean(dbKey || dbUrl || dbSecret || row?.vachat_enabled);
  const hasEnv = Boolean(envKey || envUrl || envSecret);
  const source: PlatformVachatConfig["source"] =
    !apiKey && !webhookSecret && !row?.vachat_enabled
      ? "none"
      : hasDb && hasEnv && !dbKey
        ? "mixed"
        : hasDb
          ? "database"
          : "env";
  return {
    flagEnabled: Boolean(row?.vachat_enabled),
    enabled: Boolean(row?.vachat_enabled && apiKey),
    apiBaseUrl,
    apiKey,
    webhookSecret,
    webhookEndpointId: row?.vachat_webhook_endpoint_id?.trim() || null,
    lastVerifiedAt: row?.vachat_last_verified_at ?? null,
    lastError: row?.vachat_last_error ?? null,
    lastTestPhone: row?.vachat_last_test_phone?.trim() || null,
    eventSettings: parseVachatEventSettings(row?.vachat_event_settings),
    source,
  };
}

export function isPlatformVachatActive(config: PlatformVachatConfig) {
  return Boolean(config.enabled && config.apiKey);
}

export function isPlatformVachatEventEnabled(
  config: PlatformVachatConfig,
  event: WatiNotifyEvent
) {
  return isPlatformVachatActive(config) && Boolean(config.eventSettings[event]);
}

export function publicPlatformVachatStatus(config: PlatformVachatConfig) {
  const connected = isPlatformVachatActive(config);
  return {
    enabled: config.flagEnabled,
    connected,
    status: connected ? "CONNECTED" : config.apiKey ? "NOT_CONNECTED" : "NOT_CONNECTED",
    apiBaseUrl: config.apiBaseUrl,
    hasApiKey: Boolean(config.apiKey),
    keyMasked: config.apiKey ? maskSecret(config.apiKey) : "",
    webhookSecretConfigured: Boolean(config.webhookSecret),
    webhookEndpointId: config.webhookEndpointId,
    webhookUrl: vachatStatusWebhookUrl(),
    mcpUrl: vachatMcpUrl(),
    mcpAccount: "post@post.com",
    lastVerifiedAt: config.lastVerifiedAt,
    lastError: config.lastError,
    lastTestPhone: config.lastTestPhone,
    eventSettings: config.eventSettings,
    source: config.source,
    platformManaged: connected,
  };
}

export async function isPlatformVachatEnabled() {
  return isPlatformVachatActive(await getPlatformVachatConfig());
}

export type ResolvedVachatCredentials = {
  source: "platform" | "organization";
  apiKey: string;
  apiBaseUrl: string;
  webhookSecret?: string;
  connectionId?: string | null;
};

export function merchantVachatRowReady(
  orgRow?: {
    encrypted_api_key?: string | null;
    status?: string | null;
  } | null
) {
  return Boolean(orgRow?.encrypted_api_key) && (orgRow?.status ?? "").toUpperCase() === "CONNECTED";
}

export async function resolveVachatSendCredentials(
  _organizationId: string,
  orgRow?: {
    encrypted_api_key?: string | null;
    api_base_url?: string | null;
    status?: string | null;
    id?: string;
  } | null
): Promise<ResolvedVachatCredentials | null> {
  if (merchantVachatRowReady(orgRow)) {
    try {
      return {
        source: "organization",
        apiKey: decryptSecret(orgRow!.encrypted_api_key!),
        apiBaseUrl: String(orgRow?.api_base_url || "https://cloud.vachat.in").replace(/\/$/, ""),
        connectionId: orgRow?.id ?? null,
      };
    } catch {
      return null;
    }
  }
  const platform = await getPlatformVachatConfig();
  if (isPlatformVachatActive(platform)) {
    return {
      source: "platform",
      apiKey: platform.apiKey,
      apiBaseUrl: platform.apiBaseUrl,
      webhookSecret: platform.webhookSecret,
    };
  }
  return null;
}
