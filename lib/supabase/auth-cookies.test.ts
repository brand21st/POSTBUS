import { describe, expect, it } from "vitest";
import {
  appendLegacyDomainExpiryHeaders,
  authStorageKeyFromSupabaseUrl,
  expireLegacyPostbusDomainCookies,
  POSTBUS_LEGACY_AUTH_COOKIE_DOMAIN,
  supabaseAuthCookieOptions,
} from "@/lib/supabase/auth-cookies";

describe("auth cookies", () => {
  it("uses host-only cookie options without a Domain", () => {
    const options = supabaseAuthCookieOptions({ secure: true });
    expect(options.domain).toBeUndefined();
    expect(options.path).toBe("/");
    expect(options.sameSite).toBe("lax");
    expect(options.secure).toBe(true);
  });

  it("derives the storage key from the Supabase URL", () => {
    expect(authStorageKeyFromSupabaseUrl("https://abc123.supabase.co")).toBe("sb-abc123-auth-token");
  });

  it("expires legacy .postbus.in chunks without clearing unrelated cookies", () => {
    const expired = expireLegacyPostbusDomainCookies("sb-abc123-auth-token", true);
    expect(expired.every((item) => item.options.domain === POSTBUS_LEGACY_AUTH_COOKIE_DOMAIN)).toBe(
      true
    );
    expect(expired.every((item) => item.options.maxAge === 0)).toBe(true);
    expect(expired.some((item) => item.name === "sb-abc123-auth-token.0")).toBe(true);
  });

  it("appends legacy expiry as extra Set-Cookie headers", () => {
    const headers = new Headers();
    appendLegacyDomainExpiryHeaders(headers, "sb-abc123-auth-token", true);
    const values = headers.getSetCookie();
    expect(values.length).toBeGreaterThan(0);
    expect(values.every((value) => value.includes("Domain=.postbus.in"))).toBe(true);
    expect(values.every((value) => value.includes("Max-Age=0"))).toBe(true);
  });
});
