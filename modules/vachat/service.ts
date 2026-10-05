import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { decryptSecret, encryptSecret, maskSecret } from "@/lib/security/crypto";
import { env } from "@/lib/env";
import { parseVachatBaseUrl } from "@/modules/vachat/signature";

export type VachatConnectionRow = {
  id: string;
  organization_id: string;
  encrypted_api_key?: string | null;
  api_base_url?: string | null;
  webhook_secret_encrypted?: string | null;
  status?: string | null;
  last_verified_at?: string | null;
  last_error?: string | null;
  last_webhook_at?: string | null;
  last_webhook_event?: string | null;
  last_webhook_error?: string | null;
};

export function mapVachatConfig(
  row: VachatConnectionRow | null,
  opts?: { platformManaged?: boolean; platformStatus?: string | null; platformError?: string | null }
) {
  if (opts?.platformManaged) {
    return {
      provider: "vachat",
      status: "CONNECTED",
      platformManaged: true,
      apiBaseUrl: row?.api_base_url ?? "https://cloud.vachat.in",
      api_base_url: row?.api_base_url ?? "https://cloud.vachat.in",
      hasApiKey: false,
      has_api_key: false,
      keyMasked: "",
      lastVerifiedAt: null,
      last_verified_at: null,
      lastError: opts.platformError ?? null,
      last_error: opts.platformError ?? null,
      lastWebhookAt: null,
      webhookUrl: `/api/v1/integrations/vachat/webhooks`,
    };
  }
  return {
    provider: "vachat",
    status: row?.status ?? "NOT_CONNECTED",
    platformManaged: false,
    apiBaseUrl: row?.api_base_url ?? "https://cloud.vachat.in",
    api_base_url: row?.api_base_url ?? "https://cloud.vachat.in",
    hasApiKey: Boolean(row?.encrypted_api_key),
    has_api_key: Boolean(row?.encrypted_api_key),
    keyMasked: row?.encrypted_api_key ? maskSecret("vachat-key") : "",
    lastVerifiedAt: row?.last_verified_at ?? null,
    last_verified_at: row?.last_verified_at ?? null,
    lastError: row?.last_error ?? null,
    last_error: row?.last_error ?? null,
    lastWebhookAt: row?.last_webhook_at ?? null,
    webhookUrl: row?.id
      ? `/api/v1/integrations/vachat/webhooks`
      : null,
  };
}

export function vachatHeaders(apiKey: string) {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

export async function probeVachatMe(baseUrl: string, apiKey: string) {
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/v1/me`, {
    headers: vachatHeaders(apiKey),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    throw new AppError(
      ERROR_CODES.INTEGRATION_NOT_CONNECTED,
      `Vachat rejected the API key (${res.status}).`
    );
  }
  return res.json().catch(() => ({}));
}

export async function saveVachatConnection(
  supabase: SupabaseClient,
  organizationId: string,
  input: { apiKey?: unknown; apiBaseUrl?: unknown }
) {
  const { data: existing } = await supabase
    .from("vachat_connections")
    .select("*")
    .eq("organization_id", organizationId)
    .maybeSingle();

  const incomingKey = typeof input.apiKey === "string" ? input.apiKey.trim() : "";
  const encrypted =
    incomingKey && !/^•+$/.test(incomingKey)
      ? encryptSecret(incomingKey)
      : existing?.encrypted_api_key ?? null;
  if (!encrypted) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Paste a Vachat API key.");
  }

  const apiBaseUrl = parseVachatBaseUrl(input.apiBaseUrl ?? existing?.api_base_url);
  const plaintext = decryptSecret(encrypted);
  try {
    await probeVachatMe(apiBaseUrl, plaintext);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Vachat probe failed.";
    const payload = {
      organization_id: organizationId,
      encrypted_api_key: encrypted,
      api_base_url: apiBaseUrl,
      status: "ERROR",
      last_error: message,
    };
    if (existing?.id) {
      await supabase.from("vachat_connections").update(payload).eq("id", existing.id);
    } else {
      await supabase.from("vachat_connections").insert(payload);
    }
    throw error;
  }

  const payload = {
    organization_id: organizationId,
    encrypted_api_key: encrypted,
    api_base_url: apiBaseUrl,
    status: "CONNECTED",
    last_error: null,
    last_verified_at: new Date().toISOString(),
  };

  if (existing?.id) {
    const { data, error } = await supabase
      .from("vachat_connections")
      .update(payload)
      .eq("id", existing.id)
      .select("*")
      .single();
    if (error || !data) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error?.message ?? "Save failed");
    return await attachVachatWebhookSecret(supabase, data as VachatConnectionRow, plaintext, apiBaseUrl);
  }

  const { data, error } = await supabase
    .from("vachat_connections")
    .insert(payload)
    .select("*")
    .single();
  if (error || !data) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error?.message ?? "Save failed");
  return await attachVachatWebhookSecret(supabase, data as VachatConnectionRow, plaintext, apiBaseUrl);
}

async function attachVachatWebhookSecret(
  supabase: SupabaseClient,
  row: VachatConnectionRow,
  apiKey: string,
  apiBaseUrl: string
) {
  if (row.webhook_secret_encrypted) return row;
  const webhookUrl = `${String(env.appUrl || "").replace(/\/$/, "")}/api/v1/integrations/vachat/webhooks`;
  if (!webhookUrl.startsWith("https://")) return row;
  try {
    const res = await fetch(`${apiBaseUrl}/api/v1/webhooks`, {
      method: "POST",
      headers: vachatHeaders(apiKey),
      body: JSON.stringify({
        url: webhookUrl,
        events: ["message.status_updated", "message.received"],
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return row;
    const json = (await res.json().catch(() => null)) as { data?: { secret?: string } } | null;
    const secret = json?.data?.secret;
    if (typeof secret !== "string" || !secret) return row;
    const { data } = await supabase
      .from("vachat_connections")
      .update({ webhook_secret_encrypted: encryptSecret(secret) })
      .eq("id", row.id)
      .select("*")
      .single();
    return (data as VachatConnectionRow) ?? row;
  } catch {
    return row;
  }
}

export async function disconnectVachat(supabase: SupabaseClient, organizationId: string) {
  await supabase.from("vachat_connections").delete().eq("organization_id", organizationId);
  return { disconnected: true };
}

export function decryptVachatKey(row: VachatConnectionRow) {
  if (!row.encrypted_api_key) {
    throw new AppError(ERROR_CODES.INTEGRATION_NOT_CONNECTED, "Vachat is not connected.");
  }
  return decryptSecret(row.encrypted_api_key);
}
