import type { SupabaseClient } from "@supabase/supabase-js";

export async function writeMerchantApiLog(
  supabase: SupabaseClient,
  input: {
    organizationId: string | null;
    apiKeyId: string | null;
    endpoint: string;
    method: string;
    responseStatus: number;
    durationMs: number;
    requestId: string;
  }
) {
  if (!input.organizationId) return;
  await supabase.from("merchant_api_request_logs").insert({
    organization_id: input.organizationId,
    api_key_id: input.apiKeyId,
    endpoint: input.endpoint,
    method: input.method,
    response_status: input.responseStatus,
    duration_ms: input.durationMs,
    request_id: input.requestId,
  });
}

export async function merchantApiUsage(supabase: SupabaseClient, organizationId: string) {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data } = await supabase
    .from("merchant_api_request_logs")
    .select("response_status, endpoint, method, duration_ms, request_id, created_at, api_key_id")
    .eq("organization_id", organizationId)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(100);

  const rows = data ?? [];
  const total = rows.length;
  const failed = rows.filter((row) => Number(row.response_status) >= 400).length;
  return {
    window: "7d_recent_100",
    total,
    successful: total - failed,
    failed,
    recent: rows.map((row) => ({
      endpoint: row.endpoint,
      method: row.method,
      response_status: row.response_status,
      duration_ms: row.duration_ms,
      request_id: row.request_id,
      created_at: row.created_at,
    })),
  };
}
