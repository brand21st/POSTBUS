import { logError } from "@/lib/logger";
import { createAdminClient, hasAdminClient } from "@/lib/supabase/admin";
import { DEFAULT_AI_IMAGE_CREDIT_COST } from "@/modules/ai-credits/constants";
import { DEFAULT_OPENROUTER_IMAGE_MODEL, sanitizeOpenRouterImageModel } from "@/modules/ai-image/models";
import { getPlatformOpenRouterConfig } from "@/modules/openrouter/platform-config";

export type ImageStudioConfig = {
  enabled: boolean;
  flagEnabled: boolean;
  apiKey: string;
  model: string;
  creditCost: number;
  coverCreditCost: number;
  maxVariations: number;
};

export async function getImageStudioConfig(): Promise<ImageStudioConfig> {
  const openrouter = await getPlatformOpenRouterConfig();
  let studioEnabled = false;
  let model = DEFAULT_OPENROUTER_IMAGE_MODEL;
  let creditCost = DEFAULT_AI_IMAGE_CREDIT_COST;
  let coverCreditCost = DEFAULT_AI_IMAGE_CREDIT_COST;
  let maxVariations = 3;
  if (hasAdminClient()) {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("platform_settings")
      .select("ai_image_studio_enabled, openrouter_image_model, ai_image_credit_cost, ai_cover_credit_cost, ai_image_max_variations")
      .eq("id", 1)
      .maybeSingle();
    if (error) {
      logError("ai_image.settings_load_failed", { message: error.message });
    } else if (data) {
      studioEnabled = Boolean(data.ai_image_studio_enabled);
      model = sanitizeOpenRouterImageModel(data.openrouter_image_model);
      creditCost = Math.min(500, Math.max(1, Math.floor(Number(data.ai_image_credit_cost) || DEFAULT_AI_IMAGE_CREDIT_COST)));
      coverCreditCost = Math.min(
        500,
        Math.max(1, Math.floor(Number(data.ai_cover_credit_cost) || creditCost || DEFAULT_AI_IMAGE_CREDIT_COST))
      );
      maxVariations = Math.min(3, Math.max(1, Math.floor(Number(data.ai_image_max_variations) || 3)));
    }
  }
  return {
    enabled: studioEnabled && openrouter.enabled,
    flagEnabled: studioEnabled,
    apiKey: openrouter.apiKey,
    model,
    creditCost,
    coverCreditCost,
    maxVariations,
  };
}
