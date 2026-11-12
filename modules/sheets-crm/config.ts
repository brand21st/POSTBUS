import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptSecret, encryptSecret } from "@/lib/security/crypto";
import {
  DEFAULT_SHEETS_CRM_THRESHOLDS,
  type SheetsCrmThresholds,
} from "@/modules/sheets-crm/events";

const CONFIG_COLUMNS =
  "sheets_crm_enabled, sheets_crm_webapp_url, encrypted_sheets_crm_secret, sheets_crm_last_success_at, sheets_crm_last_error, sheets_crm_synced_count, sheets_crm_failed_count, sheets_crm_last_full_sync_at, sheets_crm_abandon_cursor, sheets_crm_no_workspace_hours, sheets_crm_india_post_hours, sheets_crm_onboarding_hours, sheets_crm_inactive_days";

export type SheetsCrmConfig = {
  enabled: boolean;
  webAppUrl: string;
  secret: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  syncedCount: number;
  failedCount: number;
  lastFullSyncAt: string | null;
  abandonCursor: string | null;
  thresholds: SheetsCrmThresholds;
};

type ConfigRow = {
  sheets_crm_enabled?: boolean | null;
  sheets_crm_webapp_url?: string | null;
  encrypted_sheets_crm_secret?: string | null;
  sheets_crm_last_success_at?: string | null;
  sheets_crm_last_error?: string | null;
  sheets_crm_synced_count?: number | null;
  sheets_crm_failed_count?: number | null;
  sheets_crm_last_full_sync_at?: string | null;
  sheets_crm_abandon_cursor?: string | null;
  sheets_crm_no_workspace_hours?: number | null;
  sheets_crm_india_post_hours?: number | null;
  sheets_crm_onboarding_hours?: number | null;
  sheets_crm_inactive_days?: number | null;
};

export function mapSheetsCrmConfig(row: ConfigRow | null | undefined): SheetsCrmConfig {
  let secret: string | null = null;
  if (row?.encrypted_sheets_crm_secret) {
    try {
      secret = decryptSecret(row.encrypted_sheets_crm_secret);
    } catch {
      secret = null;
    }
  }
  return {
    enabled: Boolean(row?.sheets_crm_enabled),
    webAppUrl: row?.sheets_crm_webapp_url?.trim() || "",
    secret,
    lastSuccessAt: row?.sheets_crm_last_success_at ?? null,
    lastError: row?.sheets_crm_last_error ?? null,
    syncedCount: row?.sheets_crm_synced_count ?? 0,
    failedCount: row?.sheets_crm_failed_count ?? 0,
    lastFullSyncAt: row?.sheets_crm_last_full_sync_at ?? null,
    abandonCursor: row?.sheets_crm_abandon_cursor ?? null,
    thresholds: {
      noWorkspaceHours: row?.sheets_crm_no_workspace_hours ?? DEFAULT_SHEETS_CRM_THRESHOLDS.noWorkspaceHours,
      indiaPostHours: row?.sheets_crm_india_post_hours ?? DEFAULT_SHEETS_CRM_THRESHOLDS.indiaPostHours,
      onboardingHours: row?.sheets_crm_onboarding_hours ?? DEFAULT_SHEETS_CRM_THRESHOLDS.onboardingHours,
      inactiveDays: row?.sheets_crm_inactive_days ?? DEFAULT_SHEETS_CRM_THRESHOLDS.inactiveDays,
    },
  };
}

export function sheetsCrmReady(config: SheetsCrmConfig) {
  return Boolean(config.enabled && config.webAppUrl && config.secret);
}

export async function loadSheetsCrmConfig(supabase: SupabaseClient) {
  const { data, error } = await supabase.from("platform_settings").select(CONFIG_COLUMNS).eq("id", 1).maybeSingle();
  if (error) throw new Error(error.message);
  return mapSheetsCrmConfig(data as ConfigRow | null);
}

export function encryptSheetsCrmSecret(secret: string) {
  return encryptSecret(secret);
}

export function publicSheetsCrmSettings(config: SheetsCrmConfig) {
  return {
    enabled: config.enabled,
    webAppUrl: config.webAppUrl,
    secretConfigured: Boolean(config.secret),
    secretMasked: config.secret ? "••••••••" : "",
    lastSuccessAt: config.lastSuccessAt,
    lastError: config.lastError,
    syncedCount: config.syncedCount,
    failedCount: config.failedCount,
    lastFullSyncAt: config.lastFullSyncAt,
    thresholds: config.thresholds,
    ready: sheetsCrmReady(config),
    status: !config.enabled
      ? "disabled"
      : !config.webAppUrl || !config.secret
        ? "not_configured"
        : config.lastError
          ? "error"
          : "connected",
  };
}
