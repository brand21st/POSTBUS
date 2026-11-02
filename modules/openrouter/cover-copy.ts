import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { logError } from "@/lib/logger";
import { AI_CREDIT_REASON_PRODUCT_COPY, ZERO_AI_CREDITS_MESSAGE } from "@/modules/ai-credits/constants";
import { consumeAiCredit, getAiCreditsRemaining } from "@/modules/ai-credits/service";
import {
  OPENROUTER_API_BASE,
  getPlatformOpenRouterConfig,
  openRouterReferer,
} from "@/modules/openrouter/platform-config";

export const COVER_COPY_ACTIONS = [
  "generate",
  "more",
  "rewrite",
  "shorter",
  "premium",
  "emotional",
  "direct",
  "translate",
] as const;

export const coverCopySchema = z.object({
  action: z.enum(COVER_COPY_ACTIONS).default("generate"),
  productName: z.string().trim().max(80).optional().nullable(),
  category: z.string().trim().max(80).optional().nullable(),
  audience: z.string().trim().max(80).optional().nullable(),
  tone: z.enum(["premium", "friendly", "direct", "festive"]).optional(),
  sellingPoints: z.string().trim().max(400).optional().nullable(),
  price: z.string().trim().max(40).optional().nullable(),
  offer: z.string().trim().max(80).optional().nullable(),
  objective: z.string().trim().max(120).optional().nullable(),
  language: z.string().trim().max(40).optional().nullable(),
  currentHeadline: z.string().trim().max(80).optional().nullable(),
  idempotencyKey: z.string().uuid().optional(),
});

const resultSchema = z.object({
  headlines: z
    .array(
      z.object({
        text: z.string().trim().min(2).max(80),
        category: z.string().trim().max(40),
      })
    )
    .min(1)
    .max(8),
  subheadline: z.string().trim().max(160).optional().default(""),
  hook: z.string().trim().max(120).optional().default(""),
  cta: z.string().trim().max(40).optional().default("Shop now"),
});

const SYSTEM_PROMPT = `You write conversion-focused cover headlines for Indian D2C WhatsApp storefronts (PostBus).
Return JSON: {"headlines":[{"text":"","category":""}],"subheadline":"","hook":"","cta":""}.
Headline categories: Premium, Emotional, Benefit-Focused, Problem/Solution, Offer-Focused, Curiosity, Festival, New Arrival, Bestseller, Limited-Time Campaign.
Rules:
- Use only facts the merchant provided. Do not invent claims, reviews, certifications, scarcity, stock counts, or discounts.
- If an offer or price is missing, do not mention a discount or price.
- Headlines under 48 characters. CTA under 24 characters.
- Match the requested language. Default to clear English.
- Never mention AI.`;

function parseMessage(content: string) {
  const trimmed = content.trim();
  const tryParse = (raw: string) => {
    const parsed = resultSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) throw new AppError(ERROR_CODES.PROVIDER_ERROR, "AI did not return usable cover copy.");
    return parsed.data;
  };
  try {
    return tryParse(trimmed);
  } catch (error) {
    if (error instanceof AppError) throw error;
  }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) return tryParse(trimmed.slice(start, end + 1));
  throw new AppError(ERROR_CODES.PROVIDER_ERROR, "AI did not return usable cover copy.");
}

export async function generateCoverCopy(
  input: z.infer<typeof coverCopySchema>,
  options: { organizationId: string; supabase: SupabaseClient }
) {
  const remaining = await getAiCreditsRemaining(options.supabase, options.organizationId);
  if (remaining <= 0) throw new AppError(ERROR_CODES.CONFLICT, ZERO_AI_CREDITS_MESSAGE);
  const config = await getPlatformOpenRouterConfig();
  if (!config.enabled || !config.apiKey) {
    throw new AppError(
      ERROR_CODES.INTEGRATION_NOT_CONNECTED,
      "Cover copy is not configured. Ask PostBus support to enable OpenRouter."
    );
  }
  const notes = [
    `Action: ${input.action}`,
    input.productName ? `Product: ${input.productName}` : null,
    input.category ? `Category: ${input.category}` : null,
    input.audience ? `Audience: ${input.audience}` : null,
    input.tone ? `Tone: ${input.tone}` : null,
    input.sellingPoints ? `Selling points: ${input.sellingPoints}` : null,
    input.price ? `Price (merchant-provided): ${input.price}` : null,
    input.offer ? `Offer (merchant-provided): ${input.offer}` : null,
    input.objective ? `Objective: ${input.objective}` : null,
    input.language ? `Language: ${input.language}` : null,
    input.currentHeadline ? `Current headline: ${input.currentHeadline}` : null,
    "Do not invent discounts, reviews, or stock urgency.",
  ]
    .filter(Boolean)
    .join("\n");

  try {
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
        temperature: 0.5,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: notes },
        ],
      }),
      signal: AbortSignal.timeout(30000),
    });
    const json = (await response.json().catch(() => ({}))) as {
      choices?: Array<{ message?: { content?: string } }>;
      error?: { message?: string } | string;
    };
    if (!response.ok) {
      throw new Error(
        (typeof json.error === "object" ? json.error?.message : json.error) ||
          `OpenRouter request failed (${response.status}).`
      );
    }
    const content = json.choices?.[0]?.message?.content?.trim() || "";
    if (!content) throw new Error("OpenRouter returned empty cover copy.");
    const copy = parseMessage(content);
    const creditsRemaining = await consumeAiCredit(options.supabase, options.organizationId, {
      reason: AI_CREDIT_REASON_PRODUCT_COPY,
      idempotencyKey: input.idempotencyKey ?? null,
    });
    return { ...copy, creditsRemaining: creditsRemaining ?? remaining - 1 };
  } catch (error) {
    if (error instanceof AppError) throw error;
    logError("openrouter.cover_copy_failed", { message: error instanceof Error ? error.message : "unknown" });
    throw new AppError(ERROR_CODES.PROVIDER_ERROR, "Could not generate cover copy. Try again.");
  }
}

export { parseMessage as parseCoverCopyJson };
