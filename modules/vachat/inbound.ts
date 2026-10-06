import { logError, logInfo } from "@/lib/logger";
import { getPlatformVachatConfig, isPlatformVachatActive } from "@/modules/vachat/platform-config";
import { vachatHeaders } from "@/modules/vachat/service";

export type ParsedInboundMessage = {
  from: string;
  text: string;
  contactId: string;
  conversationId: string;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function firstString(value: unknown, depth = 0): string {
  if (depth > 4 || value == null) return "";
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstString(item, depth + 1);
      if (found) return found;
    }
    return "";
  }
  const record = asRecord(value);
  return firstString(
    record.phone ??
      record.wa_id ??
      record.from ??
      record.body ??
      record.text ??
      record.content ??
      record.content_text ??
      record.message,
    depth + 1
  );
}

export function flattenInboundPayload(
  data?: Record<string, unknown> | null,
  envelope?: Record<string, unknown> | null
) {
  return { ...asRecord(envelope), ...asRecord(data) };
}

export function parseInboundMessage(data: Record<string, unknown> | undefined): ParsedInboundMessage {
  const record = asRecord(data);
  const nested = asRecord(record.message);
  const contact = asRecord(record.contact);
  const from = firstString(
    record.from ??
      record.wa_id ??
      record.phone ??
      record.contact_phone ??
      nested.from ??
      nested.wa_id ??
      nested.phone ??
      contact.phone ??
      contact.wa_id
  );
  const text = firstString(
    record.text ??
      record.content_text ??
      record.body ??
      nested.text ??
      nested.content_text ??
      nested.body ??
      (typeof record.message === "string" ? record.message : "")
  );
  return {
    from,
    text,
    contactId: firstString(record.contact_id ?? contact.id),
    conversationId: firstString(record.conversation_id ?? record.conversationId),
  };
}

export function isInboundAssistantEvent(event: string, data?: Record<string, unknown>) {
  const key = event.toLowerCase();
  if (key.includes("status")) return false;
  if (key.includes("inbound") || key.includes("received") || key.includes("conversation")) return true;
  if (key.includes("message") && parseInboundMessage(data).text) return true;
  return Boolean(parseInboundMessage(data).text || parseInboundMessage(data).contactId);
}

async function fetchVachatContactPhone(contactId: string) {
  const platform = await getPlatformVachatConfig();
  if (!isPlatformVachatActive(platform) || !contactId) return "";
  const res = await fetch(`${platform.apiBaseUrl.replace(/\/$/, "")}/api/v1/contacts/${encodeURIComponent(contactId)}`, {
    headers: vachatHeaders(platform.apiKey),
    signal: AbortSignal.timeout(2500),
  });
  if (!res.ok) {
    logError("vachat.inbound.contact_lookup_failed", { status: res.status });
    return "";
  }
  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  const data = asRecord(json?.data ?? json);
  return firstString(data.phone ?? data.wa_id ?? data.whatsapp);
}

export async function resolveInboundSender(
  data?: Record<string, unknown>,
  envelope?: Record<string, unknown>
): Promise<ParsedInboundMessage> {
  const parsed = parseInboundMessage(flattenInboundPayload(data, envelope));
  if (parsed.from) return parsed;
  if (!parsed.contactId) return parsed;
  try {
    const from = await fetchVachatContactPhone(parsed.contactId);
    logInfo("vachat.inbound.contact_resolved", { hasFrom: Boolean(from), hasText: Boolean(parsed.text) });
    return { ...parsed, from };
  } catch (error) {
    logError("vachat.inbound.contact_lookup_failed", {
      message: error instanceof Error ? error.message : "unknown",
    });
    return parsed;
  }
}
