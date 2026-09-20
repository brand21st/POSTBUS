import { env } from "@/lib/env";

export function indiaPostWebhookUrls(connectionId: string) {
  const base = env.appUrl.replace(/\/$/, "");
  return {
    bookingWebhookUrl: `${base}/api/v1/webhooks/india-post/${connectionId}/booking`,
    eventsWebhookUrl: `${base}/api/v1/webhooks/india-post/${connectionId}/events`,
  };
}

export function parseIndiaPostWebhookPath(path: string) {
  const match = path.match(
    /^webhooks\/india-post\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/(booking|events)$/i
  );
  if (!match) return null;
  return {
    connectionId: match[1],
    channel: match[2] as "booking" | "events",
  };
}
