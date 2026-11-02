export const AI_IMAGE_PRESETS = [
  "clean_ecommerce",
  "luxury_studio",
  "lifestyle",
  "minimal_premium",
  "social",
  "marketplace",
  "festival",
  "custom",
] as const;

export type AiImagePreset = (typeof AI_IMAGE_PRESETS)[number];

export const AI_IMAGE_ASPECTS = ["1:1", "4:5", "9:16", "16:9"] as const;
export type AiImageAspect = (typeof AI_IMAGE_ASPECTS)[number];

export const AI_IMAGE_ROLES = ["main", "gallery", "lifestyle", "feature", "offer", "social", "banner"] as const;
export type AiImageRole = (typeof AI_IMAGE_ROLES)[number];

export const FESTIVAL_THEMES = ["onam", "diwali", "christmas", "new_year", "eid", "custom"] as const;
export type FestivalTheme = (typeof FESTIVAL_THEMES)[number];

export const IDENTITY_PROMPT =
  "Preserve the actual product's shape, colors, brand logo, packaging, printed labels, proportions, quantity, and visible design details. Improve only the surrounding environment, lighting, photographic quality, and requested composition. Do not invent a different product.";

const PRESET_DIRECTION: Record<AiImagePreset, string> = {
  clean_ecommerce:
    "Clean eCommerce catalog photo. Remove clutter. Neutral or white backdrop, product centered, natural shadow, balanced lighting, sharp clarity.",
  luxury_studio:
    "Luxury studio photograph. Elegant controlled lighting, premium shadows, optional subtle reflective surface, commercial campaign quality.",
  lifestyle:
    "Lifestyle product photo in a realistic environment suited to the product. Keep usage plausible. Do not invent people using it incorrectly.",
  minimal_premium:
    "Minimal premium composition. Soft neutral background, generous whitespace, few distractions.",
  social:
    "Social-media promotional frame with space for a headline. Attractive background, product still dominant.",
  marketplace:
    "Marketplace-ready product image. Neutral background, clear product, safe margins, no promotional overlay or badges.",
  festival:
    "Festive campaign photograph. Tasteful seasonal styling around the real product. Do not cover logos or labels.",
  custom: "Follow the merchant's custom instruction while keeping the real product unchanged.",
};

const FESTIVAL_DIRECTION: Record<FestivalTheme, string> = {
  onam: "Onam: floral pookalam tones, cream and gold, Kerala festive warmth.",
  diwali: "Diwali: warm lamps, gold accents, deep festive night glow.",
  christmas: "Christmas: restrained greens, gold, and soft winter light. No cluttered kitsch.",
  new_year: "New Year: elegant sparkle and midnight gold without covering the product.",
  eid: "Eid: calm moonlight, lanterns, and refined festive calm.",
  custom: "Use the merchant's described occasion.",
};

export function suggestedPresetForCategory(category?: string | null): AiImagePreset {
  const value = String(category ?? "").toLowerCase();
  if (/jewel|gold|silver|diamond/.test(value)) return "luxury_studio";
  if (/perfume|fragrance|scent/.test(value)) return "luxury_studio";
  if (/cosmetic|beauty|skincare/.test(value)) return "minimal_premium";
  if (/fashion|saree|apparel|cloth|dress/.test(value)) return "lifestyle";
  if (/electronic|phone|gadget/.test(value)) return "minimal_premium";
  if (/furniture|sofa|chair/.test(value)) return "lifestyle";
  if (/food|snack|spice/.test(value)) return "clean_ecommerce";
  return "clean_ecommerce";
}

export function aspectSize(aspect: AiImageAspect): { width: number; height: number } {
  if (aspect === "4:5") return { width: 1024, height: 1280 };
  if (aspect === "9:16") return { width: 768, height: 1365 };
  if (aspect === "16:9") return { width: 1344, height: 756 };
  return { width: 1024, height: 1024 };
}

export function buildEditPrompt(input: {
  preset: AiImagePreset;
  festival?: FestivalTheme | null;
  customPrompt?: string | null;
  categoryHint?: string | null;
  role?: AiImageRole;
}): string {
  const parts = [IDENTITY_PROMPT, PRESET_DIRECTION[input.preset]];
  if (input.preset === "festival") {
    parts.push(FESTIVAL_DIRECTION[input.festival ?? "custom"]);
  }
  if (input.customPrompt?.trim()) {
    parts.push(`Merchant instruction: ${input.customPrompt.trim().slice(0, 500)}`);
  }
  if (input.categoryHint?.trim()) {
    parts.push(`Product category hint (do not change the category): ${input.categoryHint.trim().slice(0, 80)}.`);
  }
  if (input.role === "offer") {
    parts.push(
      "This is a promotional background. Leave the lower third relatively clean for later text overlay. Do not render prices, discounts, ratings, or fake badges."
    );
  }
  return parts.join("\n");
}
