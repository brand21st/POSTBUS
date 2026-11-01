import type { SupabaseClient } from "@supabase/supabase-js";
import { hmacSha256, safeEqual } from "@/lib/security/crypto";
import { MerchantApiError, MERCHANT_ERROR_CODES } from "@/modules/merchant-api/errors";
import { parseMerchantApiKey, MERCHANT_KEY_HASH_VERSION } from "@/modules/merchant-api/keys";
import { hasScope, normalizeScopes, type MerchantApiScope } from "@/modules/merchant-api/scopes";

const BLOCKED_ACCOUNT_STATUSES = new Set(["SUSPENDED", "DISABLED", "BLOCKED", "HOLD"]);

export type MerchantApiKeyContext = {
  apiKeyId: string;
  organizationId: string;
  organizationName: string;
  accountStatus: string;
  scopes: MerchantApiScope[];
  keyPrefix: string;
  createdBy: string | null;
};

function bearerToken(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(\S+)/i.exec(header);
  return match?.[1] ?? null;
}

export async function authenticateMerchantApiKey(
  supabase: SupabaseClient,
  request: Request
): Promise<MerchantApiKeyContext> {
  const token = bearerToken(request);
  const parsed = parseMerchantApiKey(token);
  if (!parsed) {
    throw new MerchantApiError(MERCHANT_ERROR_CODES.INVALID_API_KEY, "Invalid or missing API key.");
  }

  const { data, error } = await supabase
    .from("api_keys")
    .select(
      "id, organization_id, name, key_prefix, secret_hash, status, scopes, lookup_id, hash_version, expires_at, revoked_at, created_by, organizations(id, name, account_status)"
    )
    .eq("lookup_id", parsed.lookupId)
    .maybeSingle();

  if (error || !data) {
    throw new MerchantApiError(MERCHANT_ERROR_CODES.INVALID_API_KEY, "Invalid or missing API key.");
  }

  if (data.hash_version !== MERCHANT_KEY_HASH_VERSION || !data.secret_hash) {
    throw new MerchantApiError(MERCHANT_ERROR_CODES.INVALID_API_KEY, "Invalid or missing API key.");
  }

  const expected = hmacSha256(parsed.fullKey);
  if (!safeEqual(expected, String(data.secret_hash))) {
    throw new MerchantApiError(MERCHANT_ERROR_CODES.INVALID_API_KEY, "Invalid or missing API key.");
  }

  if (data.revoked_at || String(data.status ?? "").toUpperCase() === "REVOKED") {
    throw new MerchantApiError(MERCHANT_ERROR_CODES.API_KEY_REVOKED, "This API key has been revoked.");
  }

  if (data.expires_at && new Date(data.expires_at).getTime() <= Date.now()) {
    throw new MerchantApiError(MERCHANT_ERROR_CODES.API_KEY_EXPIRED, "This API key has expired.");
  }

  const scopes = normalizeScopes(data.scopes);
  if (!scopes.length) {
    throw new MerchantApiError(MERCHANT_ERROR_CODES.INSUFFICIENT_SCOPE, "This API key has no Merchant API scopes.");
  }

  const organization = Array.isArray(data.organizations) ? data.organizations[0] : data.organizations;
  const accountStatus = String(organization?.account_status ?? "ACTIVE").toUpperCase();
  if (BLOCKED_ACCOUNT_STATUSES.has(accountStatus)) {
    throw new MerchantApiError(MERCHANT_ERROR_CODES.INVALID_API_KEY, "This workspace cannot use the Merchant API.");
  }

  void supabase
    .from("api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", data.id)
    .eq("organization_id", data.organization_id);

  return {
    apiKeyId: String(data.id),
    organizationId: String(data.organization_id),
    organizationName: organization?.name ?? "Workspace",
    accountStatus,
    scopes,
    keyPrefix: String(data.key_prefix ?? ""),
    createdBy: data.created_by ? String(data.created_by) : null,
  };
}

export function requireMerchantScope(ctx: MerchantApiKeyContext, scope: MerchantApiScope) {
  if (!hasScope(ctx.scopes, scope)) {
    throw new MerchantApiError(
      MERCHANT_ERROR_CODES.INSUFFICIENT_SCOPE,
      `This API key does not include ${scope}.`
    );
  }
}
