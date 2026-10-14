import type { CookieOptions } from "@supabase/ssr";

export const POSTBUS_LEGACY_AUTH_COOKIE_DOMAIN = ".postbus.in";
export const AUTH_COOKIE_CHUNK_INDEXES = [0, 1, 2, 3, 4, 5] as const;

export function supabaseAuthCookieOptions(input?: { secure?: boolean }): CookieOptions {
  return {
    path: "/",
    sameSite: "lax",
    httpOnly: false,
    ...(input?.secure ? { secure: true } : {}),
  };
}

export function authStorageKeyFromSupabaseUrl(supabaseUrl: string) {
  try {
    const host = new URL(supabaseUrl).hostname;
    const ref = host.split(".")[0]?.trim();
    if (ref) return `sb-${ref}-auth-token`;
  } catch {
    // fall through
  }
  return "sb-auth-token";
}

export function authCookieNames(storageKey: string) {
  return [storageKey, ...AUTH_COOKIE_CHUNK_INDEXES.map((index) => `${storageKey}.${index}`)];
}

export function isSupabaseAuthCookieName(name: string) {
  return /(^|-)auth-token(\.\d+)?$/.test(name) || name.includes("-auth-token");
}

export function requestHasAuthCookie(cookies: Array<{ name: string }>) {
  return cookies.some((cookie) => isSupabaseAuthCookieName(cookie.name));
}

export type CookieToSet = {
  name: string;
  value: string;
  options: CookieOptions;
};

export function expireLegacyPostbusDomainCookies(storageKey: string, secure = true): CookieToSet[] {
  const options: CookieOptions = {
    ...supabaseAuthCookieOptions({ secure }),
    domain: POSTBUS_LEGACY_AUTH_COOKIE_DOMAIN,
    maxAge: 0,
  };
  return authCookieNames(storageKey).map((name) => ({
    name,
    value: "",
    options,
  }));
}

export function expireLegacyDomainCookiesInBrowser(storageKey: string) {
  if (typeof document === "undefined") return;
  const base = "Max-Age=0; Path=/; SameSite=Lax; Secure";
  for (const name of authCookieNames(storageKey)) {
    document.cookie = `${name}=; ${base}; Domain=${POSTBUS_LEGACY_AUTH_COOKIE_DOMAIN}`;
  }
}

function serializeExpireCookie(item: CookieToSet) {
  const parts = [
    `${item.name}=`,
    "Max-Age=0",
    `Path=${item.options.path ?? "/"}`,
    item.options.domain ? `Domain=${item.options.domain}` : "",
    "SameSite=Lax",
    item.options.secure ? "Secure" : "",
  ].filter(Boolean);
  return parts.join("; ");
}

/** Append Domain-scoped expiries as extra Set-Cookie headers so they do not overwrite host-only session cookies in Next's name-keyed cookie jar. */
export function appendLegacyDomainExpiryHeaders(headers: Headers, storageKey: string, secure = true) {
  for (const item of expireLegacyPostbusDomainCookies(storageKey, secure)) {
    headers.append("set-cookie", serializeExpireCookie(item));
  }
}
