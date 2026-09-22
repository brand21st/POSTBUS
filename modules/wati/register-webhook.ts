import type { SupabaseClient } from "@supabase/supabase-js";
import {
  parseWatiEventTypes,
  sameWatiPhone,
  watiClientFromRow,
  watiErrorMessage,
  watiPhoneNumber,
  type WatiClient,
} from "@/modules/wati/client";
import { canRegisterWatiWebhook, watiWebhookUrl } from "@/modules/wati/webhook-urls";
import type { WatiConnectionRow } from "@/modules/wati/service";

export const WATI_WEBHOOK_EVENTS = [
  "message",
  "messageReceived",
  "newContactMessageReceived",
  "sessionMessageSent",
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

export type WatiWebhookRecord = {
  id?: string | null;
  url?: string | null;
  status?: string | number | null;
  phoneNumber?: string | null;
  phone_number?: string | null;
  channelPhoneNumber?: string | null;
  eventTypes?: string[] | null;
  event_types?: string[] | null;
};

export function asWebhookList(body: unknown): WatiWebhookRecord[] {
  if (Array.isArray(body)) return body as WatiWebhookRecord[];
  if (body && typeof body === "object") {
    const record = body as { webhooks?: WatiWebhookRecord[]; result?: WatiWebhookRecord[]; items?: WatiWebhookRecord[] };
    if (Array.isArray(record.webhooks)) return record.webhooks;
    if (Array.isArray(record.result)) return record.result;
    if (Array.isArray(record.items)) return record.items;
  }
  return [];
}

function webhookUrlKey(value?: string | null) {
  return (value ?? "").trim().replace(/\/+$/, "");
}

function webhookPhone(item: WatiWebhookRecord) {
  return item.phoneNumber ?? item.channelPhoneNumber ?? item.phone_number ?? null;
}

export function findWatiWebhook(
  items: WatiWebhookRecord[],
  input: { url: string; phone?: string | null }
) {
  const url = webhookUrlKey(input.url);
  const byUrl = items.find((item) => webhookUrlKey(item.url) === url);
  if (byUrl) return byUrl;
  if (!input.phone) return null;
  return items.find((item) => sameWatiPhone(webhookPhone(item), input.phone)) ?? null;
}

export function assertWebhookCreated(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return;
  const record = body as { ok?: boolean; message?: string; info?: string; error?: unknown };
  if (record.ok !== false) return;
  const message =
    (typeof record.message === "string" && record.message.trim()) ||
    (typeof record.info === "string" && record.info.trim()) ||
    watiErrorMessage(400, body, "Wati did not create the webhook.");
  throw new Error(message);
}

export async function watiWebhookEventTypes(client: WatiClient) {
  try {
    const available = parseWatiEventTypes(await client.listWebhookEventTypes());
    if (!available.length) return WATI_WEBHOOK_EVENTS;
    const byLower = new Map(available.map((name) => [name.toLowerCase(), name]));
    const selected = WATI_WEBHOOK_EVENTS.map((name) => byLower.get(name.toLowerCase())).filter(
      (name): name is string => Boolean(name)
    );
    return selected.length ? selected : available;
  } catch {
    return WATI_WEBHOOK_EVENTS;
  }
}

export async function ensureWatiWebhook(supabase: SupabaseClient, row: WatiConnectionRow) {
  if (!row.id) return { registered: false, reason: "missing_connection" as const };
  const url = watiWebhookUrl(row.id);
  if (!canRegisterWatiWebhook()) {
    return { registered: false, reason: "local_host" as const, url };
  }

  const client = watiClientFromRow(row);
  const phone = watiPhoneNumber(row.channel_phone);

  try {
    const eventTypes = await watiWebhookEventTypes(client);
    const existing = asWebhookList(await client.listWebhooks());
    let match = findWatiWebhook(existing, { url, phone });

    if (!match) {
      if (!row.client_id) {
        await supabase
          .from("wati_connections")
          .update({ last_webhook_error: "Add Client ID to register the Wati webhook automatically." })
          .eq("id", row.id);
        return { registered: false, reason: "missing_client_id" as const, url };
      }
      if (!phone) {
        await supabase
          .from("wati_connections")
          .update({ last_webhook_error: "Choose the WhatsApp number before registering the webhook." })
          .eq("id", row.id);
        return { registered: false, reason: "missing_phone" as const, url };
      }

      const createdBody = await client.createWebhooksV2(row.client_id, [
        {
          url,
          eventTypes,
          phoneNumber: phone,
          status: 1,
        },
      ]);
      assertWebhookCreated(createdBody);
      match = findWatiWebhook(asWebhookList(createdBody), { url, phone });
    }

    if (match?.id) {
      await client.updateWebhook(match.id, { url, eventTypes, status: "Enabled" });
    } else {
      const listed = asWebhookList(await client.listWebhooks());
      match = findWatiWebhook(listed, { url, phone });
      if (match?.id) {
        await client.updateWebhook(match.id, { url, eventTypes, status: "Enabled" });
      }
    }

    await supabase
      .from("wati_connections")
      .update({
        webhook_id: match?.id ?? null,
        last_webhook_error: match?.id ? null : "Wati accepted the webhook URL. Confirm it in Connectors → Webhooks.",
      })
      .eq("id", row.id);
    return { registered: true, webhookId: match?.id ?? null, url };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not register the Wati webhook.";
    await supabase.from("wati_connections").update({ last_webhook_error: message }).eq("id", row.id);
    return { registered: false, reason: "provider_error" as const, url, error: message };
  }
}
