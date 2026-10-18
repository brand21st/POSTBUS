import { describe, expect, it } from "vitest";
import { hmacSha256, safeEqual } from "@/lib/security/crypto";
import { mintMerchantApiKey, parseMerchantApiKey } from "@/modules/merchant-api/keys";
import { hasScope, normalizeScopes } from "@/modules/merchant-api/scopes";

describe("merchant API keys", () => {
  it("mints pb_live lookup secrets that parse and hmac-verify", () => {
    const minted = mintMerchantApiKey();
    const parsed = parseMerchantApiKey(minted.fullKey);
    expect(parsed?.lookupId).toBe(minted.lookupId);
    expect(safeEqual(hmacSha256(minted.fullKey), minted.secretHash)).toBe(true);
  });

  it("rejects legacy keys without lookup_id", () => {
    expect(parseMerchantApiKey("pb_live_" + "ab".repeat(24))).toBeNull();
    expect(parseMerchantApiKey("")).toBeNull();
  });

  it("normalizes scopes and denies missing booking permission", () => {
    expect(normalizeScopes(["orders:read", "orders:read", "not-a-scope"])).toEqual(["orders:read"]);
    expect(hasScope(["orders:write"], "shipments:book")).toBe(false);
    expect(hasScope(["shipments:book"], "shipments:book")).toBe(true);
    expect(hasScope(["orders:write"], "webhooks:manage")).toBe(false);
  });
});
