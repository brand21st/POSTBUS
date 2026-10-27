import { logError } from "@/lib/logger";
import { rateLimit } from "@/lib/security/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";

type HitRow = { allowed: boolean; remaining: number };

/**
 * Rate limit shared across web instances via Postgres (hit_rate_limit). Falls back to the
 * per-process limiter if the database call fails, so an outage never disables limiting.
 */
export async function sharedRateLimit(key: string, limit: number, windowMs = 60_000) {
  try {
    const { data, error } = await createAdminClient().rpc("hit_rate_limit", {
      p_key: key,
      p_limit: limit,
      p_window_seconds: Math.max(1, Math.round(windowMs / 1000)),
    });
    if (error) throw error;
    const row = (Array.isArray(data) ? data[0] : data) as HitRow | null;
    if (!row) throw new Error("hit_rate_limit returned no row");
    return { ok: row.allowed, remaining: row.remaining };
  } catch (error) {
    logError("rate_limit.shared_unavailable", {
      message: error instanceof Error ? error.message : "unknown",
    });
    return rateLimit(key, limit, windowMs);
  }
}
