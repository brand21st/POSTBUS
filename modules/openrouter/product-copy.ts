import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { logError } from "@/lib/logger";
import { AI_CREDIT_REASON_PRODUCT_COPY, ZERO_AI_CREDITS_MESSAGE } from "@/modules/ai-credits/constants";
import { consumeAiCredit, getAiCreditsRemaining } from "@/modules/ai-credits/service";
import {
  DEFAULT_OPENROUTER_MODEL,
  OPENROUTER_API_BASE,
  getPlatformOpenRouterConfig,
  openRouterReferer,
  type PlatformOpenRouterConfig,
} from "@/modules/openrouter/platform-config";

export const PRODUCT_AI_PROMPT_MAX = 500;
export const PRODUCT_AI_IMAGE_MAX = 3;
export const PRODUCT_AI_IMAGE_BYTES_MAX = 400 * 1024;

const DATA_IMAGE_RE = /^data:image\/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/i;

export const productAiCopySchema = z
  .object({
    prompt: z.string().trim().max(PRODUCT_AI_PROMPT_MAX).optional().default(""),
    images: z.array(z.string()).max(PRODUCT_AI_IMAGE_MAX).optional().default([]),
    idempotencyKey: z.string().uuid().optional(),
  })
  .superRefine((value, ctx) => {
    const prompt = value.prompt.trim();
    if (!prompt && value.images.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Add a short product description or at least one photo.",
        path: ["prompt"],
      });
    }
    value.images.forEach((image, index) => {
      const parsed = parseDataImage(image);
      if (!parsed.ok) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: parsed.message,
          path: ["images", index],
        });
      }
    });
  });

const copyResultSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(4000),
});

const SYSTEM_PROMPT = `You write conversion-rate optimized product copy for Indian D2C merchants selling on a WhatsApp storefront (PostBus).
Return a JSON object with keys: title, description.
Rules:
- title: benefit-led SEO product name, under 70 characters, natural keywords, no ALL CAPS, no clickbait.
- description: 2–4 short paragraphs. Lead with who it is for and the main benefit. Include material, size, use-case, or care only if present in the prompt or visible in photos. End with a calm shop-now style close, not hype.
- Use keywords from the merchant prompt and what is clearly visible in photos. Do not invent a brand, origin, certification, discount, or review unless the prompt states it.
- No fake social proof, medical claims, or “#1 / best in India / guaranteed”.
- Match the language of the prompt. If the prompt is empty or mixed, write in clear English.
- Never mention that you analyzed an image or that you are an AI.`;

export type ProductAiCopyResponse = {
  title: string;
  description: string;
  creditsRemaining: number;
};

export function parseDataImage(value: string): { ok: true } | { ok: false; message: string } {
  const trimmed = value.trim();
  if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith("blob:")) {
    return { ok: false, message: "Send photos as compressed data URLs, not remote links." };
  }
  const match = DATA_IMAGE_RE.exec(trimmed);
  if (!match) {
    return { ok: false, message: "Each photo must be a JPEG, PNG, or WebP data URL." };
  }
  const bytes = Buffer.from(match[2], "base64");
  if (!bytes.length) return { ok: false, message: "Photo data is empty." };
  if (bytes.length > PRODUCT_AI_IMAGE_BYTES_MAX) {
    return { ok: false, message: "Each photo must be under 400 KB after compression." };
  }
  return { ok: true };
}

export function visionSafeOpenRouterModel(model: string, hasImages: boolean) {
  if (!hasImages) return model;
  if (/\/o[134]|nano/i.test(model)) return DEFAULT_OPENROUTER_MODEL;
  return model;
}

export function parseProductCopyJson(raw: unknown): { title: string; description: string } {
  const parsed = copyResultSchema.safeParse(raw);
  if (!parsed.success) {
    throw new AppError(ERROR_CODES.PROVIDER_ERROR, "AI did not return a usable title and description.");
  }
  return parsed.data;
}

function parseMessageContent(content: string) {
  const trimmed = content.trim();
  try {
    return parseProductCopyJson(JSON.parse(trimmed));
  } catch (error) {
    if (error instanceof AppError) throw error;
  }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return parseProductCopyJson(JSON.parse(trimmed.slice(start, end + 1)));
    } catch (error) {
      if (error instanceof AppError) throw error;
    }
  }
  throw new AppError(ERROR_CODES.PROVIDER_ERROR, "AI did not return a usable title and description.");
}

type UserContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export async function extractProductCopyWithOpenRouter(
  prompt: string,
  images: string[],
  config: Pick<PlatformOpenRouterConfig, "apiKey" | "model">
): Promise<{ title: string; description: string }> {
  const model = visionSafeOpenRouterModel(config.model, images.length > 0);
  const userContent: UserContentPart[] = [
    {
      type: "text",
      text: prompt.trim()
        ? `Merchant notes:\n${prompt.trim()}`
        : "No merchant notes. Write title and description from the product photos only.",
    },
    ...images.map((url) => ({ type: "image_url" as const, image_url: { url } })),
  ];
  const response = await fetch(`${OPENROUTER_API_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
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
        { role: "user", content: userContent },
      ],
    }),
    signal: AbortSignal.timeout(45000),
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
  if (!content) throw new Error("OpenRouter returned empty product copy.");
  return parseMessageContent(content);
}

export async function generateProductCopy(
  input: z.infer<typeof productAiCopySchema>,
  options: { organizationId: string; supabase: SupabaseClient }
): Promise<ProductAiCopyResponse> {
  const prompt = input.prompt.trim();
  const images = input.images.map((image) => image.trim()).filter(Boolean).slice(0, PRODUCT_AI_IMAGE_MAX);
  const creditsRemaining = await getAiCreditsRemaining(options.supabase, options.organizationId);
  if (creditsRemaining <= 0) {
    throw new AppError(ERROR_CODES.CONFLICT, ZERO_AI_CREDITS_MESSAGE);
  }

  const config = await getPlatformOpenRouterConfig();
  if (!config.enabled || !config.apiKey) {
    throw new AppError(
      ERROR_CODES.INTEGRATION_NOT_CONNECTED,
      "AI copy is not configured. Ask PostBus support to enable OpenRouter."
    );
  }

  try {
    const copy = await extractProductCopyWithOpenRouter(prompt, images, config);
    const remaining = await consumeAiCredit(options.supabase, options.organizationId, {
      reason: AI_CREDIT_REASON_PRODUCT_COPY,
      idempotencyKey: input.idempotencyKey ?? null,
    });
    return {
      title: copy.title,
      description: copy.description,
      creditsRemaining: remaining ?? creditsRemaining - 1,
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    logError("openrouter.product_copy_failed", {
      message: error instanceof Error ? error.message : "unknown",
    });
    throw new AppError(ERROR_CODES.PROVIDER_ERROR, "Could not generate title and description. Try again.");
  }
}
