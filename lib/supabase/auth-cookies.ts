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

/** Seconds before JWT expiry when the HTML proxy still calls getUser() to refresh cookies. */
export const PROXY_ACCESS_TOKEN_REFRESH_SKEW_SECONDS = 60;

export function combineAuthCookieValue(
  cookies: Array<{ name: string; value: string }>,
  storageKey: string
) {
  const matching = cookies.filter(
    (cookie) => cookie.name === storageKey || cookie.name.startsWith(`${storageKey}.`)
  );
  if (!matching.length) return null;
  const indexed = matching
    .filter((cookie) => cookie.name.startsWith(`${storageKey}.`))
    .sort(
      (left, right) =>
        Number(left.name.slice(storageKey.length + 1)) - Number(right.name.slice(storageKey.length + 1))
    );
  if (indexed.length) return indexed.map((cookie) => cookie.value).join("");
  return matching.find((cookie) => cookie.name === storageKey)?.value ?? null;
}

function decodeAuthCookiePayload(raw: string) {
  const encoded = raw.startsWith("base64-") ? raw.slice("base64-".length) : raw;
  try {
    const json = Buffer.from(encoded, "base64url").toString("utf8");
    return JSON.parse(json) as { expires_at?: number; access_token?: string };
  } catch {
    try {
      return JSON.parse(raw) as { expires_at?: number; access_token?: string };
    } catch {
      return null;
    }
  }
}

function jwtExpUnix(accessToken: string) {
  const parts = accessToken.split(".");
  if (parts.length < 2) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as { exp?: number };
    return typeof payload.exp === "number" ? payload.exp : null;
  } catch {
    return null;
  }
}

/** Reads expiry from cookie JSON only. Does not verify the JWT and is not an authorization check. */
export function sessionExpiresAtUnixFromCookies(
  cookies: Array<{ name: string; value: string }>,
  storageKey: string
) {
  const combined = combineAuthCookieValue(cookies, storageKey);
  if (!combined) return null;
  const payload = decodeAuthCookiePayload(combined);
  if (!payload) return null;
  if (typeof payload.expires_at === "number" && Number.isFinite(payload.expires_at)) {
    return payload.expires_at;
  }
  if (payload.access_token) return jwtExpUnix(payload.access_token);
  return null;
}

export function accessTokenNeedsServerRefresh(
  cookies: Array<{ name: string; value: string }>,
  storageKey: string,
  nowUnix = Math.floor(Date.now() / 1000)
) {
  const expiresAt = sessionExpiresAtUnixFromCookies(cookies, storageKey);
  if (expiresAt == null) return true;
  return expiresAt <= nowUnix + PROXY_ACCESS_TOKEN_REFRESH_SKEW_SECONDS;
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

let expiredLegacyDomainCookies = false;

export function expireLegacyDomainCookiesInBrowser(storageKey: string) {
  if (typeof document === "undefined") return;
  if (expiredLegacyDomainCookies) return;
  expiredLegacyDomainCookies = true;
  const base = "Max-Age=0; Path=/; SameSite=Lax; Secure";
  for (const name of authCookieNames(storageKey)) {
    document.cookie = `${name}=; ${base}; Domain=${POSTBUS_LEGACY_AUTH_COOKIE_DOMAIN}`;
  }
}

export function resetLegacyDomainCookieExpiryForTests() {
  expiredLegacyDomainCookies = false;
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
