import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { merchantVachatRowReady } from "@/modules/vachat/platform-config";
import {
  isGlobalSupportMessagingEnabled,
  isSupportWhatsAppMode,
  type SupportWhatsAppMode,
} from "@/modules/support/provider";

export async function loadSupportSettings(supabase: SupabaseClient, organizationId: string) {
  const [{ data: org }, { data: connection }, globalSupport] = await Promise.all([
    supabase
      .from("organizations")
      .select("support_center_enabled, support_whatsapp_mode")
      .eq("id", organizationId)
      .maybeSingle(),
    supabase
      .from("vachat_connections")
      .select("id, status, encrypted_api_key")
      .eq("organization_id", organizationId)
      .maybeSingle(),
    isGlobalSupportMessagingEnabled(),
  ]);
  const mode: SupportWhatsAppMode = isSupportWhatsAppMode(org?.support_whatsapp_mode)
    ? org!.support_whatsapp_mode
    : "postbus_global";
  const vachatReady = merchantVachatRowReady(connection);
  const providerReady = mode === "merchant_vachat" ? vachatReady : globalSupport;
  const flagged = Boolean(org?.support_center_enabled);
  return {
    enabled: flagged && providerReady,
    flagged,
    mode,
    vachatReady,
    globalSupport,
    vachatConnectionId: connection?.id ?? null,
    vachatStatus: connection?.status ?? "NOT_CONNECTED",
  };
}

export function assertSupportCanEnable(
  settings: Awaited<ReturnType<typeof loadSupportSettings>>,
  mode: SupportWhatsAppMode
) {
  if (mode === "merchant_vachat") {
    if (!settings.vachatReady) {
      throw new AppError(
        ERROR_CODES.INTEGRATION_NOT_CONNECTED,
        "Connect a merchant Vachat API key and test it before using My Vachat API."
      );
    }
    return;
  }
  if (!settings.globalSupport) {
    throw new AppError(
      ERROR_CODES.INTEGRATION_NOT_CONNECTED,
      "PostBus WhatsApp support messaging is not enabled. Ask PostBus, or connect My Vachat API."
    );
  }
}

export async function assertSupportCenterEnabled(supabase: SupabaseClient, organizationId: string) {
  const settings = await loadSupportSettings(supabase, organizationId);
  if (!settings.enabled) {
    throw new AppError(
      ERROR_CODES.INTEGRATION_NOT_CONNECTED,
      !settings.flagged
        ? "Support Center is turned off for this workspace."
        : settings.mode === "merchant_vachat"
          ? "Connect Vachat with a merchant API key, or switch to PostBus WhatsApp."
          : "PostBus WhatsApp support messaging is not enabled. Ask PostBus, or connect My Vachat API."
    );
  }
  return settings;
}
