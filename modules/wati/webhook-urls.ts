import { env } from "@/lib/env";

export function watiWebhookUrl(connectionId: string, appUrl = env.appUrl) {
  return `${appUrl.replace(/\/$/, "")}/api/v1/webhooks/wati/${connectionId}`;
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
    const url = new URL(appUrl);
    return url.protocol === "https:" && url.hostname !== "localhost" && !url.hostname.endsWith(".localhost");
  } catch {
    return false;
  }
}
