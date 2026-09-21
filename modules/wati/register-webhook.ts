import type { SupabaseClient } from "@supabase/supabase-js";
import { watiClientFromRow } from "@/modules/wati/client";
import { canRegisterWatiWebhook, watiWebhookUrl } from "@/modules/wati/webhook-urls";
import type { WatiConnectionRow } from "@/modules/wati/service";

export const WATI_WEBHOOK_EVENTS = [
  "message",
  "messageReceived",
  "newContactMessageReceived",
  "templateMessageSent",
  "templateMessageSent_v2",
  "sentMessageDELIVERED",
  "sentMessageDELIVERED_v2",
  "sentMessageREAD",
  "sentMessageREAD_v2",
  "sentMessageREPLIED",
  "sentMessageREPLIED_v2",
  "templateMessageFailed",
  "sessionMessageFailed",
];

type WatiWebhookRecord = {
  id?: string | null;
  url?: string | null;
  status?: string | null;
  eventTypes?: string[] | null;
  event_types?: string[] | null;
};

function asWebhookList(body: unknown): WatiWebhookRecord[] {
  if (Array.isArray(body)) return body as WatiWebhookRecord[];
  if (body && typeof body === "object") {
    const record = body as { webhooks?: WatiWebhookRecord[]; result?: WatiWebhookRecord[] };
    if (Array.isArray(record.webhooks)) return record.webhooks;
    if (Array.isArray(record.result)) return record.result;
  }
  return [];
}

export async function ensureWatiWebhook(supabase: SupabaseClient, row: WatiConnectionRow) {
  if (!row.id) return { registered: false, reason: "missing_connection" as const };
  const url = watiWebhookUrl(row.id);
  if (!canRegisterWatiWebhook()) {
    return { registered: false, reason: "local_host" as const, url };
  }

  const client = watiClientFromRow(row);

  try {
    const existing = asWebhookList(await client.listWebhooks());
    const match =
      existing.find((item) => item.url === url) ??
      existing.find((item) => item.id === row.webhook_id && (!item.url || item.url === url));

    if (match?.id) {
      await client.updateWebhook(match.id, { url, eventTypes: WATI_WEBHOOK_EVENTS, status: "Enabled" });
      await supabase
        .from("wati_connections")
        .update({ webhook_id: match.id, last_webhook_error: null })
        .eq("id", row.id);
      return { registered: true, webhookId: match.id, url };
    }

    if (!row.client_id) {
      await supabase
        .from("wati_connections")
        .update({ last_webhook_error: "Add Client ID to register the Wati webhook automatically." })
        .eq("id", row.id);
      return { registered: false, reason: "missing_client_id" as const, url };
    }

    await client.createWebhooksV2(row.client_id, [
      {
        url,
        eventTypes: WATI_WEBHOOK_EVENTS,
        phoneNumber: row.channel_phone ?? undefined,
        status: 1,
      },
    ]);
    const createdHook =
      asWebhookList(await client.listWebhooks()).find((item) => item.url === url) ?? null;
    await supabase
      .from("wati_connections")
      .update({
        webhook_id: createdHook?.id ?? null,
        last_webhook_error: createdHook?.id ? null : "Wati accepted the webhook URL. Confirm it in Connectors → Webhooks.",
      })
      .eq("id", row.id);
    return { registered: true, webhookId: createdHook?.id ?? null, url };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not register the Wati webhook.";
    await supabase.from("wati_connections").update({ last_webhook_error: message }).eq("id", row.id);
    return { registered: false, reason: "provider_error" as const, url, error: message };
  }
}
