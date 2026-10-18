import { createHash } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, ERROR_CODES } from "@/lib/api/errors";

/** Keep completed print idempotency rows for 24 hours. No production cleanup job in P0. */
export const MANUAL_PRINT_IDEMPOTENCY_MS = 24 * 60 * 60 * 1000;

const PREFIX = "print:manual:";

function uniqueViolation(error: { code?: string; message?: string } | null) {
  const code = String(error?.code || "");
  const message = String(error?.message || "");
  return code === "23505" || /duplicate|unique/i.test(message);
}

export function printRequestFingerprint(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value ?? {})).digest("hex");
}

export function requirePrintIdempotencyKey(raw: string | null | undefined) {
  const trimmed = raw?.trim() ?? "";
  if (!trimmed) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "This print request is missing an idempotency key.");
  }
  if (trimmed.length > 128) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "The print request key is too long.");
  }
  return trimmed;
}

export async function claimManualPrintKey<T>(
  supabase: SupabaseClient,
  organizationId: string,
  rawKey: string,
  fingerprint: string
): Promise<{ key: string; cached: T | null }> {
  const key = `${PREFIX}${rawKey.trim()}`;
  const { data: existing } = await supabase
    .from("idempotency_keys")
    .select("response, request_hash, created_at")
    .eq("organization_id", organizationId)
    .eq("key", key)
    .maybeSingle();
  if (existing) {
    const created = existing.created_at ? new Date(String(existing.created_at)).getTime() : 0;
    const fresh = created && Date.now() - created <= MANUAL_PRINT_IDEMPOTENCY_MS;
    if (existing.request_hash && existing.request_hash !== fingerprint) {
      throw new AppError(ERROR_CODES.CONFLICT, "That print request key was already used with different details.");
    }
    if (fresh && existing.response) return { key, cached: existing.response as T };
    if (fresh) throw new AppError(ERROR_CODES.CONFLICT, "This print request is already being processed.");
    throw new AppError(ERROR_CODES.CONFLICT, "That print request key expired. Start a new print.");
  }
  const { error } = await supabase.from("idempotency_keys").insert({
    organization_id: organizationId,
    key,
    request_hash: fingerprint,
  });
  if (error && uniqueViolation(error)) {
    const { data: raced } = await supabase
      .from("idempotency_keys")
      .select("response, request_hash, created_at")
      .eq("organization_id", organizationId)
      .eq("key", key)
      .maybeSingle();
    if (raced?.request_hash && raced.request_hash !== fingerprint) {
      throw new AppError(ERROR_CODES.CONFLICT, "That print request key was already used with different details.");
    }
    if (raced?.response) return { key, cached: raced.response as T };
    throw new AppError(ERROR_CODES.CONFLICT, "This print request is already being processed.");
  }
  if (error) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message || "Could not start a print request.");
  }
  return { key, cached: null };
}

export async function storeManualPrintKey<T>(
  supabase: SupabaseClient,
  organizationId: string,
  key: string,
  response: T
) {
  await supabase.from("idempotency_keys").update({ response }).eq("organization_id", organizationId).eq("key", key);
}

export async function releaseManualPrintKey(supabase: SupabaseClient, organizationId: string, key: string) {
  await supabase.from("idempotency_keys").delete().eq("organization_id", organizationId).eq("key", key);
}
