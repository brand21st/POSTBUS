import { describe, expect, it } from "vitest";
import {
  accessTokenNeedsServerRefresh,
  appendLegacyDomainExpiryHeaders,
  authStorageKeyFromSupabaseUrl,
  combineAuthCookieValue,
  expireLegacyDomainCookiesInBrowser,
  expireLegacyPostbusDomainCookies,
  POSTBUS_LEGACY_AUTH_COOKIE_DOMAIN,
  resetLegacyDomainCookieExpiryForTests,
  sessionExpiresAtUnixFromCookies,
  supabaseAuthCookieOptions,
} from "@/lib/supabase/auth-cookies";

function encodedSessionCookie(expiresAt: number) {
  const payload = Buffer.from(JSON.stringify({ exp: expiresAt })).toString("base64url");
  const access_token = `eyJhbGciOiJub25lIn0.${payload}.x`;
  const json = JSON.stringify({ access_token, refresh_token: "refresh", expires_at: expiresAt });
  return `base64-${Buffer.from(json).toString("base64url")}`;
}

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

  it("joins chunked cookie values in index order", () => {
    const combined = combineAuthCookieValue(
      [
        { name: "sb-abc123-auth-token.1", value: "two" },
        { name: "sb-abc123-auth-token.0", value: "one" },
      ],
      "sb-abc123-auth-token"
    );
    expect(combined).toBe("onetwo");
  });

  it("reads expiry without treating the cookie JWT as authorization", () => {
    const expiresAt = Math.floor(Date.now() / 1000) + 3600;
    const cookies = [{ name: "sb-abc123-auth-token", value: encodedSessionCookie(expiresAt) }];
    expect(sessionExpiresAtUnixFromCookies(cookies, "sb-abc123-auth-token")).toBe(expiresAt);
    expect(accessTokenNeedsServerRefresh(cookies, "sb-abc123-auth-token", expiresAt - 120)).toBe(false);
    expect(accessTokenNeedsServerRefresh(cookies, "sb-abc123-auth-token", expiresAt - 10)).toBe(true);
  });

  it("expires legacy Domain cookies only once per page", () => {
    resetLegacyDomainCookieExpiryForTests();
    const writes: string[] = [];
    const original = globalThis.document;
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        get cookie() {
          return "";
        },
        set cookie(value: string) {
          writes.push(value);
        },
      },
    });
    expireLegacyDomainCookiesInBrowser("sb-abc123-auth-token");
    expireLegacyDomainCookiesInBrowser("sb-abc123-auth-token");
    expect(writes.length).toBeGreaterThan(0);
    expect(writes.every((value) => value.includes("Domain=.postbus.in"))).toBe(true);
    const first = writes.length;
    expireLegacyDomainCookiesInBrowser("sb-abc123-auth-token");
    expect(writes.length).toBe(first);
    Object.defineProperty(globalThis, "document", { configurable: true, value: original });
    resetLegacyDomainCookieExpiryForTests();
  });
});
