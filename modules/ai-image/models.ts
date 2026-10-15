export const DEFAULT_OPENROUTER_IMAGE_MODEL = "google/gemini-2.5-flash-image";

export const OPENROUTER_IMAGE_MODELS = [
  { id: "google/gemini-2.5-flash-image", name: "Gemini 2.5 Flash Image" },
  { id: "google/gemini-2.5-flash-image-preview", name: "Gemini 2.5 Flash Image Preview" },
  { id: "openai/gpt-image-1", name: "GPT Image 1" },
  { id: "openai/gpt-image-1-mini", name: "GPT Image 1 Mini" },
] as const;

const ALLOWED = new Set(OPENROUTER_IMAGE_MODELS.map((item) => item.id));

export function isOpenRouterImageModel(id: string) {
  const model = id.trim();
  if (ALLOWED.has(model as (typeof OPENROUTER_IMAGE_MODELS)[number]["id"])) return true;
  return /\/(gemini-.+-image|gpt-image|flux|seedream|imagen)/i.test(model) && model.length <= 80;
}

export function sanitizeOpenRouterImageModel(value?: string | null) {
  const model = String(value ?? "").trim();
  if (isOpenRouterImageModel(model)) return model;
  return DEFAULT_OPENROUTER_IMAGE_MODEL;
}
