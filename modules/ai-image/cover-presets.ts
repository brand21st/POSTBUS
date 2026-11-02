export const COVER_TYPES = [
  "homepage_hero",
  "promotional",
  "collection",
  "product_launch",
  "festival_offer",
  "brand_campaign",
  "mobile_hero",
  "custom",
] as const;
export type CoverType = (typeof COVER_TYPES)[number];

export const COVER_TYPE_LABELS: Record<CoverType, string> = {
  homepage_hero: "Homepage hero",
  promotional: "Promotional banner",
  collection: "Collection cover",
  product_launch: "Product launch",
  festival_offer: "Festival offer",
  brand_campaign: "Brand campaign",
  mobile_hero: "Mobile hero",
  custom: "Custom cover",
};

export const COVER_PRESETS = [
  "luxury",
  "launch",
  "flash_sale",
  "minimal",
  "fashion",
  "electronics",
  "beauty",
  "festival",
  "custom",
] as const;
export type CoverPreset = (typeof COVER_PRESETS)[number];

export const COVER_PRESET_LABELS: Record<CoverPreset, string> = {
  luxury: "Luxury eCommerce",
  launch: "Product launch",
  flash_sale: "Flash sale",
  minimal: "Minimal premium",
  fashion: "Fashion campaign",
  electronics: "Electronics",
  beauty: "Beauty & cosmetics",
  festival: "Festival campaign",
  custom: "Custom AI design",
};

export const COVER_FESTIVALS = [
  "onam",
  "diwali",
  "christmas",
  "eid",
  "new_year",
  "valentines",
  "womens_day",
  "independence_day",
  "custom",
] as const;
export type CoverFestival = (typeof COVER_FESTIVALS)[number];

export const COVER_FESTIVAL_LABELS: Record<CoverFestival, string> = {
  onam: "Onam",
  diwali: "Diwali",
  christmas: "Christmas",
  eid: "Eid",
  new_year: "New Year",
  valentines: "Valentine's Day",
  womens_day: "Women's Day",
  independence_day: "Independence Day",
  custom: "Custom occasion",
};

export const COVER_ENHANCE_ACTIONS = [
  "lighting",
  "sharpness",
  "remove_background",
  "replace_background",
  "color_grade",
  "presentation",
  "extend",
  "recompose",
  "remove_objects",
  "premium",
] as const;
export type CoverEnhanceAction = (typeof COVER_ENHANCE_ACTIONS)[number];

export const COVER_ENHANCE_LABELS: Record<CoverEnhanceAction, string> = {
  lighting: "Improve lighting",
  sharpness: "Improve sharpness",
  remove_background: "Remove background",
  replace_background: "Replace background",
  color_grade: "Professional color grading",
  presentation: "Improve product presentation",
  extend: "Extend background",
  recompose: "Adjust composition",
  remove_objects: "Remove distracting objects",
  premium: "Premium commercial look",
};

export const RISKY_ENHANCE_ACTIONS: CoverEnhanceAction[] = [
  "replace_background",
  "extend",
  "remove_objects",
];

const PRESET_DIRECTION: Record<CoverPreset, string> = {
  luxury:
    "Luxury editorial eCommerce campaign. Sophisticated lighting, elegant background, strong product emphasis, minimal clutter.",
  launch:
    "Product-launch hero. Product dominates the frame, clear visual hierarchy, space for a headline and CTA on the left or lower third.",
  flash_sale:
    "High-contrast promotional composition. Product-focused, energetic but not noisy, leave a clean area for offer text.",
  minimal:
    "Minimal premium. Neutral or white backdrop, generous whitespace, editorial calm.",
  fashion:
    "Fashion campaign. Editorial composition, collection storytelling, strong headline space.",
  electronics:
    "Clean technical product framing. Modern lighting, precise edges, no fake UI or invented specs.",
  beauty:
    "Beauty campaign. Soft studio light, elegant gradients, product-focused.",
  festival:
    "Festive campaign photograph. Seasonal styling around the real product. Do not cover logos or labels.",
  custom: "Follow the merchant custom instruction while keeping the real product unchanged.",
};

const FESTIVAL_DIRECTION: Record<CoverFestival, string> = {
  onam: "Onam visual mood: floral pookalam tones, cream and gold, Kerala festive warmth. Decorative only — no religious claims.",
  diwali: "Diwali visual mood: warm lamps, gold accents, festive night glow. Decorative only.",
  christmas: "Christmas visual mood: restrained greens, gold, and soft winter light. No cluttered kitsch.",
  eid: "Eid visual mood: calm moonlight, lanterns, refined festive calm. Decorative only.",
  new_year: "New Year visual mood: elegant sparkle and midnight gold without covering the product.",
  valentines: "Valentine visual mood: romantic colour palette, gift-focused composition.",
  womens_day: "Women's Day visual mood: elegant celebratory campaign colours.",
  independence_day: "Independence Day visual mood: restrained patriotic colour accents. Do not invent official claims.",
  custom: "Use the merchant-described occasion only as visual styling.",
};

const ENHANCE_DIRECTION: Record<CoverEnhanceAction, string> = {
  lighting: "Improve lighting and exposure. Keep product colours true.",
  sharpness: "Improve sharpness and clarity without oversharpening.",
  remove_background: "Remove the background to a clean studio void. Keep the product intact.",
  replace_background: "Replace the background with a premium commercial set. Keep product shape, colour, and logos unchanged.",
  color_grade: "Professional colour grading. Do not shift product packaging colours.",
  presentation: "Improve product presentation and camera angle while keeping identity.",
  extend: "Extend the background for a wider hero crop. Do not invent extra products.",
  recompose: "Adjust composition for a hero banner. Keep the real product.",
  remove_objects: "Remove distracting objects around the product. Do not alter the product.",
  premium: "Create a premium commercial look: lighting, set, and photographic quality only.",
};

export const COVER_IDENTITY_PROMPT =
  "Preserve the actual product's shape, colors, brand logo, packaging, printed labels, proportions, quantity, and visible design details. Improve only the surrounding environment, lighting, photographic quality, and requested composition. Do not invent a different product.";

export const COVER_TEXT_SAFE_PROMPT =
  "Leave a clean, uncluttered area occupying about 40% of the frame for later HTML headline and CTA overlay. Do not render any text, prices, discounts, badges, watermarks, or logos that are not already on the product.";

export function identityRiskForEnhance(action?: CoverEnhanceAction | null) {
  return Boolean(action && RISKY_ENHANCE_ACTIONS.includes(action));
}

export function buildCoverEditPrompt(input: {
  preset: CoverPreset;
  festival?: CoverFestival | null;
  enhance?: CoverEnhanceAction | null;
  customPrompt?: string | null;
  categoryHint?: string | null;
  coverType?: CoverType | null;
  variant?: "desktop" | "mobile";
}): string {
  const parts = [COVER_IDENTITY_PROMPT, COVER_TEXT_SAFE_PROMPT, PRESET_DIRECTION[input.preset]];
  if (input.preset === "festival" || input.coverType === "festival_offer") {
    parts.push(FESTIVAL_DIRECTION[input.festival ?? "custom"]);
  }
  if (input.enhance) parts.push(ENHANCE_DIRECTION[input.enhance]);
  if (input.variant === "mobile") {
    parts.push("Compose for a tall mobile hero. Keep the product in the upper two-thirds so overlay text at the bottom stays readable.");
  } else {
    parts.push("Compose for a wide desktop hero. Keep the product toward the right or centre so overlay text on the left stays readable.");
  }
  if (input.customPrompt?.trim()) {
    parts.push(`Merchant instruction: ${input.customPrompt.trim().slice(0, 500)}`);
  }
  if (input.categoryHint?.trim()) {
    parts.push(`Product category hint (do not change the category): ${input.categoryHint.trim().slice(0, 80)}.`);
  }
  return parts.join("\n");
}
