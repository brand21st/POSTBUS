import { z } from "zod";
import { encryptSecret } from "@/lib/security/crypto";

export const INDIA_POST_TOKEN_SKEW_MS = 60_000;
/** Live CEPT AUTH02: POST, Authorization Bearer refresh_token, empty body. Do not send a JSON body. */
export const INDIA_POST_REFRESH_PATH = "/access/TokenWithRtoken";

export type IndiaPostSessionTokens = {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  id_token?: string;
  refresh_expires_in?: number;
};

const sessionDataSchema = z
  .object({
    access_token: z.string().min(1),
    expires_in: z.number().finite().positive(),
    refresh_token: z.string().min(1).optional(),
    id_token: z.string().min(1).optional(),
    refresh_expires_in: z.number().finite().positive().optional(),
  })
  .passthrough();

export function parseIndiaPostSessionTokens(json: unknown): IndiaPostSessionTokens | null {
  if (!json || typeof json !== "object") return null;
  const parsed = sessionDataSchema.safeParse((json as { data?: unknown }).data);
  if (!parsed.success) return null;
  return {
    access_token: parsed.data.access_token,
    expires_in: parsed.data.expires_in,
    refresh_token: parsed.data.refresh_token,
    id_token: parsed.data.id_token,
    refresh_expires_in: parsed.data.refresh_expires_in,
  };
}

export function accessTokenStillValid(expiresAt?: string | null, now = Date.now(), skewMs = INDIA_POST_TOKEN_SKEW_MS) {
  if (!expiresAt) return false;
  const ms = new Date(expiresAt).getTime();
  return Number.isFinite(ms) && ms - now > skewMs;
}

/** Missing expiry still allows AUTH02; an elapsed expiry does not. */
export function refreshTokenStillValid(
  refreshExpiresAt?: string | null,
  now = Date.now(),
  skewMs = INDIA_POST_TOKEN_SKEW_MS
) {
  if (!refreshExpiresAt) return true;
  const ms = new Date(refreshExpiresAt).getTime();
  return Number.isFinite(ms) && ms - now > skewMs;
}

export function indiaPostSessionPersistPatch(tokens: IndiaPostSessionTokens) {
  const patch: Record<string, string> = {
    encrypted_access_token: encryptSecret(tokens.access_token),
    expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
    last_refreshed_at: new Date().toISOString(),
  };
  if (tokens.refresh_token) patch.encrypted_refresh_token = encryptSecret(tokens.refresh_token);
  if (tokens.id_token) patch.encrypted_id_token = encryptSecret(tokens.id_token);
  if (tokens.refresh_expires_in != null) {
    patch.refresh_expires_at = new Date(Date.now() + tokens.refresh_expires_in * 1000).toISOString();
  }
  return patch;
}
