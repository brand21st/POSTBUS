import { env } from "@/lib/env";

export const DEFAULT_AFTER_AUTH = "/dashboard";
export const PRODUCTION_APP_ORIGIN = "https://www.postbus.in";

function stripSlash(value: string) {
  return value.replace(/\/$/, "");
}

function isLocalHost(value: string) {
  return /localhost|127\.0\.0\.1/i.test(value);
}

export function publicAppOrigin() {
  const configured = stripSlash(env.appUrl) || "http://localhost:3000";
  if (process.env.NODE_ENV === "production" && isLocalHost(configured)) {
    return PRODUCTION_APP_ORIGIN;
  }
  return configured;
}

export function requestPublicOrigin(request: { nextUrl: URL; headers: Headers }) {
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || "https";
  if (forwardedHost && !isLocalHost(forwardedHost)) {
    return `${forwardedProto}://${forwardedHost}`;
  }

  const host = request.headers.get("host")?.split(",")[0]?.trim();
  if (host && !isLocalHost(host)) {
    const proto = forwardedProto || request.nextUrl.protocol.replace(":", "") || "https";
    return `${proto}://${host}`;
  }

  return publicAppOrigin();
}

export function safeAuthNext(value?: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return DEFAULT_AFTER_AUTH;
  return value;
}

export function authCallbackUrl(next = DEFAULT_AFTER_AUTH) {
  const path = safeAuthNext(next);
  return `${publicAppOrigin()}/auth/callback?next=${encodeURIComponent(path)}`;
}
