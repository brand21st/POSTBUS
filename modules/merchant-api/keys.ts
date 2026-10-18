import { hmacSha256, randomToken } from "@/lib/security/crypto";
import { MERCHANT_API_SCOPES, normalizeScopes, type MerchantApiScope } from "@/modules/merchant-api/scopes";

export const MERCHANT_KEY_HASH_VERSION = "hmac-v1";
export const MERCHANT_KEY_PREFIX = "pb_live_";

const LOOKUP_BYTES = 8;
const SECRET_BYTES = 24;

export function mintMerchantApiKey() {
  const lookupId = randomToken(LOOKUP_BYTES);
  const secret = randomToken(SECRET_BYTES);
  const fullKey = `${MERCHANT_KEY_PREFIX}${lookupId}_${secret}`;
  return {
    fullKey,
    lookupId,
    keyPrefix: `${MERCHANT_KEY_PREFIX}${lookupId}`,
    secretHash: hmacSha256(fullKey),
    hashVersion: MERCHANT_KEY_HASH_VERSION,
  };
}

export function parseMerchantApiKey(raw: string | null | undefined) {
  const value = (raw ?? "").trim();
  const match = /^pb_live_([a-f0-9]{16})_([a-f0-9]{32,})$/i.exec(value);
  if (!match) return null;
  return { lookupId: match[1].toLowerCase(), fullKey: value };
}

export function allowedScopeList() {
  return [...MERCHANT_API_SCOPES];
}

export function scopesOrThrow(values: unknown): MerchantApiScope[] {
  const scopes = normalizeScopes(values);
  if (!scopes.length) {
    throw new Error("Select at least one API permission.");
  }
  return scopes;
}
