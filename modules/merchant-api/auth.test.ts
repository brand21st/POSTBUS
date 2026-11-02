import { describe, expect, it } from "vitest";
import { hmacSha256 } from "@/lib/security/crypto";
import { authenticateMerchantApiKey, requireMerchantScope } from "@/modules/merchant-api/auth";
import { MerchantApiError } from "@/modules/merchant-api/errors";
import { mintMerchantApiKey } from "@/modules/merchant-api/keys";

function requestWith(key: string) {
  return new Request("https://www.postbus.in/api/merchant/v1/me", {
    headers: { Authorization: `Bearer ${key}` },
  });
}

function supabaseForRow(row: Record<string, unknown> | null, error: unknown = null) {
  return {
    from() {
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        update() {
          return this;
        },
        maybeSingle: async () => ({ data: row, error }),
      };
    },
  };
}

describe("authenticateMerchantApiKey", () => {
  it("accepts hmac-v1 keys with scopes for an ACTIVE org", async () => {
    const minted = mintMerchantApiKey();
    const supabase = supabaseForRow({
      id: "key-1",
      organization_id: "org-a",
      key_prefix: minted.keyPrefix,
      secret_hash: minted.secretHash,
      status: "ACTIVE",
      scopes: ["orders:read"],
      lookup_id: minted.lookupId,
      hash_version: "hmac-v1",
      expires_at: null,
      revoked_at: null,
      created_by: "user-1",
      organizations: { id: "org-a", name: "Alpha", account_status: "ACTIVE" },
    });
    const ctx = await authenticateMerchantApiKey(supabase as never, requestWith(minted.fullKey));
    expect(ctx.organizationId).toBe("org-a");
    expect(ctx.scopes).toEqual(["orders:read"]);
  });

  it("rejects missing, revoked, expired, legacy hash, empty scopes, and blocked orgs", async () => {
    await expect(authenticateMerchantApiKey(supabaseForRow(null) as never, requestWith("nope"))).rejects.toMatchObject({
      code: "INVALID_API_KEY",
    });

    const minted = mintMerchantApiKey();
    const base = {
      id: "key-1",
      organization_id: "org-a",
      key_prefix: minted.keyPrefix,
      secret_hash: minted.secretHash,
      lookup_id: minted.lookupId,
      hash_version: "hmac-v1",
      scopes: ["orders:read"],
      created_by: null,
      organizations: { account_status: "ACTIVE", name: "A" },
    };

    await expect(
      authenticateMerchantApiKey(
        supabaseForRow({ ...base, status: "REVOKED", revoked_at: new Date().toISOString() }) as never,
        requestWith(minted.fullKey)
      )
    ).rejects.toMatchObject({ code: "API_KEY_REVOKED" });

    await expect(
      authenticateMerchantApiKey(
        supabaseForRow({ ...base, expires_at: "2000-01-01T00:00:00.000Z" }) as never,
        requestWith(minted.fullKey)
      )
    ).rejects.toMatchObject({ code: "API_KEY_EXPIRED" });

    await expect(
      authenticateMerchantApiKey(
        supabaseForRow({ ...base, hash_version: null, secret_hash: hmacSha256("x") }) as never,
        requestWith(minted.fullKey)
      )
    ).rejects.toMatchObject({ code: "INVALID_API_KEY" });

    await expect(
      authenticateMerchantApiKey(supabaseForRow({ ...base, scopes: [] }) as never, requestWith(minted.fullKey))
    ).rejects.toMatchObject({ code: "INSUFFICIENT_SCOPE" });

    await expect(
      authenticateMerchantApiKey(
        supabaseForRow({
          ...base,
          organizations: { account_status: "SUSPENDED", name: "A" },
        }) as never,
        requestWith(minted.fullKey)
      )
    ).rejects.toMatchObject({ code: "INVALID_API_KEY" });
  });

  it("does not treat orders:write as booking permission", () => {
    expect(() => requireMerchantScope({ scopes: ["orders:write"] } as never, "shipments:book")).toThrow(
      MerchantApiError
    );
  });
});

describe("hmac mismatch", () => {
  it("rejects a well-formed key whose secret does not match", async () => {
    const minted = mintMerchantApiKey();
    const other = mintMerchantApiKey();
    const supabase = supabaseForRow({
      id: "key-1",
      organization_id: "org-a",
      key_prefix: minted.keyPrefix,
      secret_hash: minted.secretHash,
      status: "ACTIVE",
      scopes: ["orders:read"],
      lookup_id: minted.lookupId,
      hash_version: "hmac-v1",
      expires_at: null,
      revoked_at: null,
      created_by: null,
      organizations: { account_status: "ACTIVE", name: "A" },
    });
    const spoof = `pb_live_${minted.lookupId}_${other.fullKey.split("_").pop()}`;
    await expect(authenticateMerchantApiKey(supabase as never, requestWith(spoof))).rejects.toMatchObject({
      code: "INVALID_API_KEY",
    });
  });
});

