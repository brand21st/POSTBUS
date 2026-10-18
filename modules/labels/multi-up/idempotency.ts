import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, ERROR_CODES } from "@/lib/api/errors";

const WINDOW_MS = 2 * 60 * 1000;

export type MultiSheetPrintResult = {
  labelId: string;
  job: { id: string; status: string; source: string; paperSize: string };
  connected: boolean;
  message: string;
};

function printKey(raw: string) {
  return `multi-sheet-print:${raw.trim()}`;
}

function uniqueViolation(error: { code?: string; message?: string } | null) {
  const code = String(error?.code || "");
  const message = String(error?.message || "");
  return code === "23505" || /duplicate|unique/i.test(message);
}

export async function claimMultiSheetPrintKey(
  supabase: SupabaseClient,
  organizationId: string,
  rawKey: string | null | undefined
): Promise<{ key: string; cached: MultiSheetPrintResult | null } | null> {
  const trimmed = rawKey?.trim();
  if (!trimmed) return null;
  const key = printKey(trimmed);
  const { data: existing } = await supabase
    .from("idempotency_keys")
    .select("response, created_at")
    .eq("organization_id", organizationId)
    .eq("key", key)
    .maybeSingle();
  if (existing) {
    const created = existing.created_at ? new Date(String(existing.created_at)).getTime() : 0;
    if (created && Date.now() - created <= WINDOW_MS && existing.response) {
      return { key, cached: existing.response as MultiSheetPrintResult };
    }
    throw new AppError(ERROR_CODES.CONFLICT, "This print request is already being processed.");
  }
  const { error } = await supabase.from("idempotency_keys").insert({
    organization_id: organizationId,
    key,
  });
  if (error && uniqueViolation(error)) {
    const { data: raced } = await supabase
      .from("idempotency_keys")
      .select("response, created_at")
      .eq("organization_id", organizationId)
      .eq("key", key)
      .maybeSingle();
    if (raced?.response) return { key, cached: raced.response as MultiSheetPrintResult };
    throw new AppError(ERROR_CODES.CONFLICT, "This print request is already being processed.");
  }
  if (error) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message || "Could not start a print request.");
  }
  return { key, cached: null };
}

export async function storeMultiSheetPrintKey(
  supabase: SupabaseClient,
  organizationId: string,
  key: string,
  response: MultiSheetPrintResult
) {
  await supabase
    .from("idempotency_keys")
    .update({ response })
    .eq("organization_id", organizationId)
    .eq("key", key);
}

export async function releaseMultiSheetPrintKey(
  supabase: SupabaseClient,
  organizationId: string,
  key: string
) {
  await supabase.from("idempotency_keys").delete().eq("organization_id", organizationId).eq("key", key);
}
