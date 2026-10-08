import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { logError } from "@/lib/logger";
import {
  fieldsFromUnknown,
  parseWhatsAppCustomerMessage,
  type WhatsAppCustomerFields,
} from "@/lib/parsers/whatsapp-customer-message";
import { consumeAiCredit, getAiCreditsRemaining } from "@/modules/ai-credits/service";
import {
  OPENROUTER_API_BASE,
  getPlatformOpenRouterConfig,
  openRouterReferer,
  type PlatformOpenRouterConfig,
} from "@/modules/openrouter/platform-config";

export const WHATSAPP_PASTE_MAX_CHARS = 4000;

export const whatsappPasteSchema = z.object({
  text: z.string().trim().min(1, "Paste a WhatsApp message first.").max(WHATSAPP_PASTE_MAX_CHARS),
});

const SYSTEM_PROMPT = `Extract Indian shipping customer details from pasted text. The text may be unstructured, a WhatsApp chat, labeled or unlabeled, or mixed Malayalam and English.
Return a JSON object with keys: name, phone, email, line1, line2, city, state, pincode.
You may also send "address" instead of line1. Use empty strings for unknown keys.
Do not invent a name, phone, email, or pincode. Only use values found in the text.
Aliases: Mob/Mobile/Phone no → phone; Pin/Pincode/Postal code → pincode; Mail/Email → email; Customer/Name → name.
phone must be a 10-digit Indian mobile if present. pincode must be 6 digits if present.
state must be an Indian state name if present. Put landmark or extra address text in line2.`;

export type WhatsAppPasteSource = "ai" | "rules";

export type WhatsAppPasteParseResponse = {
  fields: WhatsAppCustomerFields;
  source: WhatsAppPasteSource;
  creditsRemaining: number;
};

function filledCount(fields: WhatsAppCustomerFields) {
  return Object.values(fields).filter(Boolean).length;
}

export async function extractWhatsAppFieldsWithOpenRouter(
  text: string,
  config: Pick<PlatformOpenRouterConfig, "apiKey" | "model">
): Promise<unknown> {
  const response = await fetch(`${OPENROUTER_API_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": openRouterReferer(),
      "X-Title": "PostBus",
    },
    body: JSON.stringify({
      model: config.model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: text },
      ],
    }),
    signal: AbortSignal.timeout(20000),
  });
  const json = (await response.json().catch(() => ({}))) as {
    choices?: Array<{ message?: { content?: string } }>;
    error?: { message?: string } | string;
  };
  if (!response.ok) {
    const message =
      (typeof json.error === "object" ? json.error?.message : json.error) ||
      `OpenRouter request failed (${response.status}).`;
    throw new Error(message);
  }
  const content = json.choices?.[0]?.message?.content?.trim() || "";
  if (!content) throw new Error("OpenRouter returned an empty extract.");
  return JSON.parse(content) as unknown;
}

export function mergeWhatsAppPasteResult(
  text: string,
  aiJson: unknown | null
): Omit<WhatsAppPasteParseResponse, "creditsRemaining"> {
  const rules = parseWhatsAppCustomerMessage(text);
  if (aiJson == null) return { fields: rules.fields, source: "rules" };
  const ai = fieldsFromUnknown(aiJson, "ai");
  if (filledCount(ai.fields) > 0) return { fields: ai.fields, source: "ai" };
  return { fields: rules.fields, source: "rules" };
}

export async function parseWhatsAppOrderPaste(
  text: string,
  options?: { organizationId?: string; supabase?: SupabaseClient }
): Promise<WhatsAppPasteParseResponse> {
  const trimmed = text.trim().slice(0, WHATSAPP_PASTE_MAX_CHARS);
  const organizationId = options?.organizationId;
  const supabase = options?.supabase;
  const creditsRemaining =
    organizationId && supabase ? await getAiCreditsRemaining(supabase, organizationId) : 0;
  const withCredits = (
    result: Omit<WhatsAppPasteParseResponse, "creditsRemaining">,
    remaining: number
  ): WhatsAppPasteParseResponse => ({ ...result, creditsRemaining: remaining });

  if (organizationId && supabase && creditsRemaining <= 0) {
    return withCredits(mergeWhatsAppPasteResult(trimmed, null), 0);
  }

  const config = await getPlatformOpenRouterConfig();
  if (!config.enabled || !config.apiKey) {
    return withCredits(mergeWhatsAppPasteResult(trimmed, null), creditsRemaining);
  }
  try {
    const json = await extractWhatsAppFieldsWithOpenRouter(trimmed, config);
    const merged = mergeWhatsAppPasteResult(trimmed, json);
    if (merged.source === "ai" && organizationId && supabase) {
      const remaining = await consumeAiCredit(supabase, organizationId);
      return withCredits(merged, remaining ?? creditsRemaining);
    }
    return withCredits(merged, creditsRemaining);
  } catch (error) {
    logError("openrouter.whatsapp_parse_failed", {
      message: error instanceof Error ? error.message : "unknown",
    });
    return withCredits(mergeWhatsAppPasteResult(trimmed, null), creditsRemaining);
  }
}
