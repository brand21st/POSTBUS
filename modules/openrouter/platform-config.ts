import { env } from "@/lib/env";
import { logError } from "@/lib/logger";
import { decryptSecret, maskSecret } from "@/lib/security/crypto";
import { createAdminClient, hasAdminClient } from "@/lib/supabase/admin";
import { sanitizeChatGptOpenRouterModel } from "@/modules/openrouter/chatgpt-models";

export { DEFAULT_OPENROUTER_MODEL } from "@/modules/openrouter/chatgpt-models";
export const OPENROUTER_API_BASE = "https://openrouter.ai/api/v1";

const COLUMNS = "encrypted_openrouter_api_key, openrouter_model, openrouter_enabled";

type SettingsRow = {
  encrypted_openrouter_api_key?: string | null;
  openrouter_model?: string | null;
  openrouter_enabled?: boolean | null;
};

export type PlatformOpenRouterConfig = {
  enabled: boolean;
  flagEnabled: boolean;
  apiKey: string;
  model: string;
  source: "database" | "none";
};

function decryptOptional(payload?: string | null) {
  if (!payload) return "";
  try {
    return decryptSecret(payload);
  } catch (error) {
    logError("openrouter.platform.decrypt_failed", {
      message: error instanceof Error ? error.message : "unknown",
    });
    return "";
  }
}

async function loadSettingsRow(): Promise<SettingsRow | null> {
  if (!hasAdminClient()) return null;
  const supabase = createAdminClient();
  const { data, error } = await supabase.from("platform_settings").select(COLUMNS).eq("id", 1).maybeSingle();
  if (error) {
    logError("openrouter.platform.settings_load_failed", { message: error.message });
    return null;
  }
  return data;
}

export function sanitizeOpenRouterModel(value?: string | null) {
  return sanitizeChatGptOpenRouterModel(value);
}

export async function getPlatformOpenRouterConfig(): Promise<PlatformOpenRouterConfig> {
  const row = await loadSettingsRow();
  const apiKey = decryptOptional(row?.encrypted_openrouter_api_key).trim();
  const flagEnabled = Boolean(row?.openrouter_enabled);
  return {
    flagEnabled,
    enabled: flagEnabled && Boolean(apiKey),
    apiKey,
    model: sanitizeOpenRouterModel(row?.openrouter_model),
    source: apiKey || flagEnabled ? "database" : "none",
  };
}

export function openRouterReferer() {
  return env.appUrl.replace(/\/$/, "") || "https://postbus.in";
}

export function publicOpenRouterStatus(config: PlatformOpenRouterConfig) {
  return {
    enabled: config.flagEnabled,
    connected: config.enabled,
    hasApiKey: Boolean(config.apiKey),
    keyMasked: config.apiKey ? maskSecret(config.apiKey) : "",
    model: config.model,
    source: config.source,
  };
}
