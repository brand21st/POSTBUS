import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { decryptSecret } from "@/lib/security/crypto";
import {
  getPlatformVachatConfig,
  isPlatformVachatActive,
  merchantVachatRowReady,
} from "@/modules/vachat/platform-config";

export const SUPPORT_WHATSAPP_MODES = ["postbus_global", "merchant_vachat"] as const;
export type SupportWhatsAppMode = (typeof SUPPORT_WHATSAPP_MODES)[number];
export type SupportChannelKind = SupportWhatsAppMode;

export type SupportMessagingCredentials = {
  mode: SupportWhatsAppMode;
  source: "platform" | "organization";
  apiKey: string;
  apiBaseUrl: string;
  organizationId: string;
  connectionId: string | null;
};

export function isSupportWhatsAppMode(value: unknown): value is SupportWhatsAppMode {
  return value === "postbus_global" || value === "merchant_vachat";
}

export async function isGlobalSupportMessagingEnabled() {
  const platform = await getPlatformVachatConfig();
  return Boolean(isPlatformVachatActive(platform) && platform.supportEnabled);
}

export async function resolveSupportProvider(
  supabase: SupabaseClient,
  organizationId: string
): Promise<SupportMessagingCredentials> {
  const [{ data: org }, { data: connection }] = await Promise.all([
    supabase
      .from("organizations")
      .select("support_center_enabled, support_whatsapp_mode")
      .eq("id", organizationId)
      .maybeSingle(),
    supabase
      .from("vachat_connections")
      .select("id, encrypted_api_key, api_base_url, status")
      .eq("organization_id", organizationId)
      .maybeSingle(),
  ]);
  if (!org?.support_center_enabled) {
    throw new AppError(ERROR_CODES.INTEGRATION_NOT_CONNECTED, "Support Center is turned off for this workspace.");
  }
  const mode: SupportWhatsAppMode = isSupportWhatsAppMode(org.support_whatsapp_mode)
    ? org.support_whatsapp_mode
    : "postbus_global";

  if (mode === "merchant_vachat") {
    if (!merchantVachatRowReady(connection)) {
      throw new AppError(
        ERROR_CODES.INTEGRATION_NOT_CONNECTED,
        "My Vachat API is selected, but the merchant connection is not ready. Reconnect or switch back to PostBus WhatsApp."
      );
    }
    try {
      return {
        mode,
        source: "organization",
        apiKey: decryptSecret(connection!.encrypted_api_key!),
        apiBaseUrl: String(connection?.api_base_url || "https://cloud.vachat.in").replace(/\/$/, ""),
        organizationId,
        connectionId: connection?.id ?? null,
      };
    } catch {
      throw new AppError(ERROR_CODES.INTEGRATION_NOT_CONNECTED, "Merchant Vachat credentials could not be decrypted.");
    }
  }

  const platform = await getPlatformVachatConfig();
  if (!isPlatformVachatActive(platform) || !platform.supportEnabled) {
    throw new AppError(
      ERROR_CODES.INTEGRATION_NOT_CONNECTED,
      "PostBus WhatsApp support messaging is not available. Ask PostBus to enable it, or connect My Vachat API."
    );
  }
  return {
    mode,
    source: "platform",
    apiKey: platform.apiKey,
    apiBaseUrl: platform.apiBaseUrl,
    organizationId,
    connectionId: null,
  };
}

export async function supportInboxAvailable(supabase: SupabaseClient, organizationId: string) {
  const { data: org } = await supabase
    .from("organizations")
    .select("support_center_enabled, support_whatsapp_mode")
    .eq("id", organizationId)
    .maybeSingle();
  if (!org?.support_center_enabled) return false;
  const mode: SupportWhatsAppMode = isSupportWhatsAppMode(org.support_whatsapp_mode)
    ? org.support_whatsapp_mode
    : "postbus_global";
  if (mode === "merchant_vachat") {
    const { data: connection } = await supabase
      .from("vachat_connections")
      .select("encrypted_api_key, status")
      .eq("organization_id", organizationId)
      .maybeSingle();
    return merchantVachatRowReady(connection);
  }
  return isGlobalSupportMessagingEnabled();
}
