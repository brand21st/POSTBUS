import { PRODUCTION_APP_ORIGIN } from "@/lib/auth/urls";
import { env } from "@/lib/env";

function stripSlash(value: string) {
  return value.replace(/\/$/, "");
}

function hostnameOf(origin: string) {
  try {
    return new URL(origin).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/** CEPT POSTs do not follow apex 308s; Coolify aliases are not the public webhook host. */
export function indiaPostWebhookOrigin(appUrl = env.appUrl) {
  const origin = stripSlash(appUrl) || "http://localhost:3000";
  const host = hostnameOf(origin);
  if (!host || host === "localhost" || host === "127.0.0.1") return origin;
  if (host.includes("staging")) return origin;
  return PRODUCTION_APP_ORIGIN;
}

const CONNECTION_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** India Post customer ID when present; otherwise the connection UUID. */
export function indiaPostWebhookPublicId(connectionId: string, customerId?: string | null) {
  const customer = String(customerId ?? "").replace(/\D/g, "");
  if (customer.length >= 6 && customer.length <= 20) return customer;
  return connectionId;
}

export function isIndiaPostWebhookConnectionUuid(value: string) {
  return CONNECTION_UUID.test(value);
}

export function indiaPostWebhookUrls(
  connectionId: string,
  appUrl = env.appUrl,
  customerId?: string | null
) {
  const base = indiaPostWebhookOrigin(appUrl);
  const publicId = indiaPostWebhookPublicId(connectionId, customerId);
  return {
    bookingWebhookUrl: `${base}/api/v1/webhooks/india-post/${publicId}/booking`,
    eventsWebhookUrl: `${base}/api/v1/webhooks/india-post/${publicId}/events`,
  };
}

export function parseIndiaPostWebhookPath(path: string) {
  const match = path.match(
    /^webhooks\/india-post\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\d{6,20})\/(booking|events)$/i
  );
  if (!match) return null;
  return {
    connectionId: match[1],
    channel: match[2] as "booking" | "events",
  };
}
