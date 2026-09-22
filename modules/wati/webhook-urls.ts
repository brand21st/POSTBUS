import { PRODUCTION_APP_ORIGIN } from "@/lib/auth/urls";
import { env } from "@/lib/env";

function isLocalAppUrl(appUrl: string) {
  try {
    const url = new URL(appUrl);
    return url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname.endsWith(".localhost");
  } catch {
    return true;
  }
}

export function watiPublicAppUrl(appUrl = env.appUrl) {
  if (!isLocalAppUrl(appUrl)) return appUrl.replace(/\/$/, "");
  return PRODUCTION_APP_ORIGIN;
}

export function watiWebhookUrl(connectionId: string, appUrl = env.appUrl) {
  return `${watiPublicAppUrl(appUrl)}/api/v1/webhooks/wati/${connectionId}`;
}

export function parseWatiWebhookPath(path: string) {
  const match = path.match(
    /^webhooks\/wati\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i
  );
  if (!match) return null;
  return { connectionId: match[1] };
}

export function canRegisterWatiWebhook(appUrl = env.appUrl) {
  try {
    const url = new URL(watiPublicAppUrl(appUrl));
    return url.protocol === "https:" && url.hostname !== "localhost" && !url.hostname.endsWith(".localhost");
  } catch {
    return false;
  }
}
