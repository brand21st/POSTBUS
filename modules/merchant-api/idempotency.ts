import { createHash } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { MerchantApiError, MERCHANT_ERROR_CODES } from "@/modules/merchant-api/errors";

export const IDEMPOTENCY_TTL_MS = 72 * 60 * 60 * 1000;

export function fingerprintBody(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value ?? null)).digest("hex");
}

export function idempotencyStorageKey(operation: string, headerValue: string) {
  return `merchant-api:v1:${operation}:${headerValue.trim()}`;
}

export function requireIdempotencyKey(request: Request) {
  const value = request.headers.get("idempotency-key")?.trim();
  if (!value || value.length > 128) {
    throw new MerchantApiError(
      MERCHANT_ERROR_CODES.VALIDATION_ERROR,
      "Idempotency-Key header is required (1–128 characters).",
      [{ field: "Idempotency-Key", message: "Required for this operation." }]
    );
  }
  return value;
}

type Stored = {
  request_hash: string | null;
  response: unknown;
  processing_state: string;
  expires_at: string | null;
};

export async function beginIdempotency(
  supabase: SupabaseClient,
  organizationId: string,
  operation: string,
  headerValue: string,
  requestHash: string
): Promise<{ replay: unknown | null }> {
  const key = idempotencyStorageKey(operation, headerValue);
  const expiresAt = new Date(Date.now() + IDEMPOTENCY_TTL_MS).toISOString();

  const insert = await supabase.from("idempotency_keys").insert({
    organization_id: organizationId,
    key,
    request_hash: requestHash,
    operation,
    processing_state: "processing",
    response: null,
    expires_at: expiresAt,
  });

  if (!insert.error) return { replay: null };

  const existing = await supabase
    .from("idempotency_keys")
    .select("request_hash, response, processing_state, expires_at")
    .eq("organization_id", organizationId)
    .eq("key", key)
    .maybeSingle();

  const row = existing.data as Stored | null;
  if (!row) {
    throw new MerchantApiError(MERCHANT_ERROR_CODES.INTERNAL_ERROR, "Unable to start an idempotent request.");
  }

  if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) {
    await supabase.from("idempotency_keys").delete().eq("organization_id", organizationId).eq("key", key);
    return beginIdempotency(supabase, organizationId, operation, headerValue, requestHash);
  }

  if (row.request_hash && row.request_hash !== requestHash) {
    throw new MerchantApiError(
      MERCHANT_ERROR_CODES.IDEMPOTENCY_CONFLICT,
      "This Idempotency-Key was already used with a different request body."
    );
  }

  if (row.processing_state === "completed") {
    return { replay: row.response };
  }

  if (row.processing_state === "failed") {
    await supabase
      .from("idempotency_keys")
      .update({
        processing_state: "processing",
        request_hash: requestHash,
        expires_at: expiresAt,
        response: null,
      })
      .eq("organization_id", organizationId)
      .eq("key", key);
    return { replay: null };
  }

  throw new MerchantApiError(
    MERCHANT_ERROR_CODES.IDEMPOTENCY_CONFLICT,
    "A request with this Idempotency-Key is already processing.",
    [],
    2
  );
}

export async function completeIdempotency(
  supabase: SupabaseClient,
  organizationId: string,
  operation: string,
  headerValue: string,
  response: unknown
) {
  const key = idempotencyStorageKey(operation, headerValue);
  await supabase
    .from("idempotency_keys")
    .update({ processing_state: "completed", response })
    .eq("organization_id", organizationId)
    .eq("key", key);
}

export async function failIdempotency(
  supabase: SupabaseClient,
  organizationId: string,
  operation: string,
  headerValue: string
) {
  const key = idempotencyStorageKey(operation, headerValue);
  await supabase
    .from("idempotency_keys")
    .update({ processing_state: "failed" })
    .eq("organization_id", organizationId)
    .eq("key", key);
}
