import type { SupabaseClient } from "@supabase/supabase-js";
import { MerchantApiError, MERCHANT_ERROR_CODES } from "@/modules/merchant-api/errors";

export const MERCHANT_RATE_LIMITS = {
  generalPerKey: { limit: 120, windowMs: 60_000 },
  generalPerOrg: { limit: 300, windowMs: 60_000 },
  authFailuresPerIp: { limit: 20, windowMs: 60_000 },
  bulkRowsPerKey: { limit: 100, windowMs: 60_000 },
  bookingPerKey: { limit: 30, windowMs: 60_000 },
} as const;

export const MERCHANT_PAYLOAD_LIMITS = {
  defaultBytes: 256 * 1024,
  bulkBytes: 512 * 1024,
} as const;

export const MERCHANT_BULK_MAX_ROWS = 25;
export const MERCHANT_PAGE_MAX = 100;

function windowStart(windowMs: number) {
  const now = Date.now();
  return new Date(now - (now % windowMs)).toISOString();
}

export async function consumeMerchantRate(
  supabase: SupabaseClient,
  bucketKey: string,
  limit: number,
  windowMs: number
) {
  const start = windowStart(windowMs);
  const { data, error } = await supabase.rpc("merchant_api_consume_rate", {
    p_bucket_key: bucketKey,
    p_window_start: start,
    p_limit: limit,
  });
  if (error) {
    throw new MerchantApiError(
      MERCHANT_ERROR_CODES.UPSTREAM_SERVICE_UNAVAILABLE,
      "Rate limiting is temporarily unavailable."
    );
  }
  const count = Number(data ?? 0);
  if (count > limit) {
    throw new MerchantApiError(
      MERCHANT_ERROR_CODES.RATE_LIMIT_EXCEEDED,
      "Rate limit exceeded.",
      [],
      Math.ceil(windowMs / 1000)
    );
  }
  return { remaining: Math.max(0, limit - count), limit };
}

export function clientIp(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() || "unknown";
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

export function assertPayloadSize(request: Request, maxBytes: number) {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(length) && length > maxBytes) {
    throw new MerchantApiError(
      MERCHANT_ERROR_CODES.VALIDATION_ERROR,
      `Request body exceeds ${maxBytes} bytes.`
    );
  }
}
