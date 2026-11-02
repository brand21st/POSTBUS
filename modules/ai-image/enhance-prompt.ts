import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { logError } from "@/lib/logger";
import { AI_CREDIT_REASON_PROMPT_ENHANCE, ZERO_AI_CREDITS_MESSAGE } from "@/modules/ai-credits/constants";
import { consumeAiCredit, getAiCreditsRemaining } from "@/modules/ai-credits/service";
import {
  AI_IMAGE_ASPECTS,
  AI_IMAGE_PRESETS,
  AI_IMAGE_ROLES,
  FESTIVAL_THEMES,
} from "@/modules/ai-image/presets";
import {
  OPENROUTER_API_BASE,
  getPlatformOpenRouterConfig,
  openRouterReferer,
} from "@/modules/openrouter/platform-config";

export const STUDIO_PROMPT_MAX = 500;

export const enhanceStudioPromptSchema = z.object({
  prompt: z.string().trim().max(STUDIO_PROMPT_MAX).optional().default(""),
  preset: z.enum(AI_IMAGE_PRESETS).optional(),
  festival: z.enum(FESTIVAL_THEMES).optional().nullable(),
  aspect: z.enum(AI_IMAGE_ASPECTS).optional(),
  role: z.enum(AI_IMAGE_ROLES).optional(),
  productName: z.string().trim().max(80).optional().nullable(),
  categoryHint: z.string().trim().max(80).optional().nullable(),
  idempotencyKey: z.string().uuid().optional(),
});

const resultSchema = z.object({
  prompt: z.string().trim().min(8).max(STUDIO_PROMPT_MAX),
});

const SYSTEM_PROMPT = `You rewrite a merchant's notes into a concise product-photo edit prompt for an image model.
Return JSON: {"prompt":"..."}.
Rules:
- Keep the real product unchanged (shape, colour, logos, labels, quantity).
- Improve lighting, backdrop, composition, and camera feel only.
- Expand short notes into a clear studio instruction. If notes are empty, write from the product name, category, and selected style.
- Match the language of the merchant notes. If mixed or empty, use clear English.
- No prices, discounts, fake badges, extra products, or invented brand marks.
- Do not mention AI, prompts, or that you rewrote anything.
- One paragraph, under 450 characters.`;

export function parseEnhancedStudioPrompt(raw: unknown): string {
  const parsed = resultSchema.safeParse(raw);
  if (!parsed.success) {
    throw new AppError(ERROR_CODES.PROVIDER_ERROR, "AI did not return a usable prompt.");
  }
  return parsed.data.prompt.slice(0, STUDIO_PROMPT_MAX);
}

function parseMessageContent(content: string) {
  const trimmed = content.trim();
  try {
    return parseEnhancedStudioPrompt(JSON.parse(trimmed));
  } catch (error) {
    if (error instanceof AppError) throw error;
  }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return parseEnhancedStudioPrompt(JSON.parse(trimmed.slice(start, end + 1)));
    } catch (error) {
      if (error instanceof AppError) throw error;
    }
  }
  throw new AppError(ERROR_CODES.PROVIDER_ERROR, "AI did not return a usable prompt.");
}

async function rewriteWithOpenRouter(
  input: z.infer<typeof enhanceStudioPromptSchema>,
  apiKey: string,
  model: string
) {
  const user = [
    input.productName?.trim() ? `Product: ${input.productName.trim()}` : null,
    input.categoryHint?.trim() ? `Category: ${input.categoryHint.trim()}` : null,
    input.preset ? `Style preset: ${input.preset.replaceAll("_", " ")}` : null,
    input.festival ? `Festival: ${input.festival.replaceAll("_", " ")}` : null,
    input.aspect ? `Aspect: ${input.aspect}` : null,
    input.role ? `Use as: ${input.role}` : null,
    input.prompt.trim()
      ? `Merchant notes:\n${input.prompt.trim()}`
      : "No merchant notes. Write a strong photo-edit instruction from the product and style only.",
  ]
    .filter(Boolean)
    .join("\n");

  const response = await fetch(`${OPENROUTER_API_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": openRouterReferer(),
      "X-Title": "PostBus",
    },
    body: JSON.stringify({
      model,
      temperature: 0.4,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: user },
      ],
    }),
    signal: AbortSignal.timeout(30000),
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
  if (!content) throw new Error("OpenRouter returned an empty prompt.");
  return parseMessageContent(content);
}

export async function enhanceStudioPrompt(
  input: z.infer<typeof enhanceStudioPromptSchema>,
  options: { organizationId: string; supabase: SupabaseClient }
) {
  const creditsRemaining = await getAiCreditsRemaining(options.supabase, options.organizationId);
  if (creditsRemaining <= 0) {
    throw new AppError(ERROR_CODES.CONFLICT, ZERO_AI_CREDITS_MESSAGE);
  }
  const config = await getPlatformOpenRouterConfig();
  if (!config.enabled || !config.apiKey) {
    throw new AppError(
      ERROR_CODES.INTEGRATION_NOT_CONNECTED,
      "Prompt enhance is not configured. Ask PostBus support to enable OpenRouter."
    );
  }
  try {
    const prompt = await rewriteWithOpenRouter(input, config.apiKey, config.model);
    const remaining = await consumeAiCredit(options.supabase, options.organizationId, {
      reason: AI_CREDIT_REASON_PROMPT_ENHANCE,
      idempotencyKey: input.idempotencyKey ?? null,
    });
    return { prompt, creditsRemaining: remaining ?? creditsRemaining - 1 };
  } catch (error) {
    if (error instanceof AppError) throw error;
    logError("openrouter.studio_prompt_enhance_failed", {
      message: error instanceof Error ? error.message : "unknown",
    });
    throw new AppError(ERROR_CODES.PROVIDER_ERROR, "Could not enhance the prompt. Try again.");
  }
}
